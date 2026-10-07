//! Per-core local schedulers with work stealing.
//!
//! Each CPU owns a [`LocalScheduler`] reachable without a global lock. On
//! each timer tick the CPU pulls work from its own queues; when those are
//! empty it attempts to steal from a peer.
//!
//! # Design
//!
//! - **Lock granularity**: one [`spin::Mutex`] per CPU.
//! - **Priority queues**: 256 buckets, index = `Task::priority`
//!   (0 = lowest, 255 = highest).
//! - **Owner vs. thief**:
//!   - Owner ([`LocalScheduler::pick_next`]) takes from the *highest*
//!     non-empty priority bucket, FIFO within a bucket (pops the front).
//!   - Thief ([`LocalScheduler::steal_one`]) takes from the *lowest*
//!     non-empty priority bucket, LIFO within a bucket (pops the back).
//!     This ensures the victim keeps its most important work and that the
//!     thief offloads the least critical item.
//! - **Idle task**: every scheduler starts with one idle task in bucket 0,
//!   so `pick_next` never returns `None` during a normal run.
//!
//! # Lock-order discipline
//!
//! **Never hold CPU X's scheduler lock while acquiring CPU Y's.** The work-
//! stealing path ([`schedule_local`] → [`try_steal`]) is written to release
//! its own lock before scanning peers. Violating this can deadlock.
//!
//! # Cross-CPU wake
//!
//! [`spawn_on`] does **not** send an IPI. A CPU that has gone to
//! `hlt`/`wfi` will not observe the new task until the next timer
//! interrupt. Callers that need prompt wake-up must send an IPI explicitly
//! (see `crate::smp::send_ipi`).

use alloc::collections::VecDeque;
use spin::Mutex;

use crate::sched;
use crate::task::{Task, TaskId, TaskState};

// ── Constants ─────────────────────────────────────────────────────────────

/// Maximum number of supported CPUs.
pub const MAX_CPUS: usize = 64;

/// Number of priority buckets.
///
/// Must be a power of two: index masking relies on it.
const PRIORITY_LEVELS: usize = 256;

/// Ticks a task runs before preemption.
const DEFAULT_QUANTUM: u64 = 10;

// ── Re-exports (API compatibility) ───────────────────────────────────────

/// The global fallback scheduler.
pub use crate::sched::SCHEDULER as GLOBAL_SCHEDULER;

// ── LocalScheduler ────────────────────────────────────────────────────────

/// Per-CPU local scheduler.
///
/// # Public fields
///
/// `cpu_id`, `current`, `quantum`, and `switches` are part of the historical
/// public API. External mutation of `current`/`quantum` is **discouraged**:
/// the scheduler's invariants (that the idle task is always eligible) may
/// be broken. Prefer the methods on this type.
pub struct LocalScheduler {
    /// Logical CPU this scheduler belongs to.
    pub cpu_id: u32,
    /// Currently running task (`None` only before the first `tick`).
    pub current: Option<Task>,
    /// Priority queues. Index = priority (0..PRIORITY_LEVELS).
    ready: [VecDeque<Task>; PRIORITY_LEVELS],
    /// Number of tasks in `ready` (excludes `current`).
    ready_len: usize,
    /// Remaining ticks in the current task's time slice.
    pub quantum: u64,
    /// Total number of context switches this scheduler has performed.
    pub switches: u64,
}

impl LocalScheduler {
    /// Create a scheduler for `cpu_id` with a single idle task queued.
    #[must_use]
    pub fn new(cpu_id: u32) -> Self {
        let mut s = Self {
            cpu_id,
            current: None,
            ready: core::array::from_fn(|_| VecDeque::new()),
            ready_len: 0,
            quantum: DEFAULT_QUANTUM,
            switches: 0,
        };
        // Idle task ensures `pick_next` never returns `None`.
        let idle = Task::new_idle_for_cpu(cpu_id);
        s.spawn(idle);
        s
    }

    /// Enqueue a task for this CPU.
    pub fn spawn(&mut self, mut t: Task) {
        t.state = TaskState::Ready;
        let p = priority_index(t.priority);
        self.ready[p].push_back(t);
        self.ready_len = self.ready_len.saturating_add(1);
    }

    /// Pop the highest-priority task for local execution.
    ///
    /// FIFO within a priority level (pops the front — the oldest entry).
    pub fn pick_next(&mut self) -> Option<Task> {
        for p in (0..PRIORITY_LEVELS).rev() {
            if let Some(t) = self.ready[p].pop_front() {
                self.ready_len = self.ready_len.saturating_sub(1);
                return Some(t);
            }
        }
        None
    }

    /// Hand one task to a thief.
    ///
    /// Takes the *lowest*-priority task available (iterates buckets from 0
    /// upward), so the victim keeps its most important work. LIFO within a
    /// bucket (pops the back — the newest entry).
    pub fn steal_one(&mut self) -> Option<Task> {
        for p in 0..PRIORITY_LEVELS {
            if let Some(t) = self.ready[p].pop_back() {
                self.ready_len = self.ready_len.saturating_sub(1);
                return Some(t);
            }
        }
        None
    }

    /// Move the current task back into the ready queue.
    ///
    /// No-op if `current` is `None`.
    pub fn enqueue_current(&mut self) {
        if let Some(mut t) = self.current.take() {
            t.state = TaskState::Ready;
            let p = priority_index(t.priority);
            self.ready[p].push_back(t);
            self.ready_len = self.ready_len.saturating_add(1);
        }
    }

    /// Number of tasks waiting in the ready queues (excludes `current`).
    #[must_use]
    #[inline]
    pub fn ready_count(&self) -> usize {
        self.ready_len
    }

    /// Advance the per-CPU time slice by one tick.
    ///
    /// Returns `true` if the caller should perform a context switch. The
    /// scheduler mutates `current`/`quantum` state, but does **not** itself
    /// switch stacks — that is the caller's (timer handler's)
    /// responsibility.
    pub fn tick(&mut self) -> bool {
        if self.current.is_none() {
            self.current = self.pick_next();
            self.quantum = DEFAULT_QUANTUM;
            return false;
        }

        if self.quantum > 0 {
            self.quantum -= 1;
        }

        if self.quantum == 0 {
            // Round-robin: requeue the running task, pick the next one.
            self.enqueue_current();
            self.current = self.pick_next();
            self.quantum = DEFAULT_QUANTUM;
            self.switches = self.switches.saturating_add(1);
            return true;
        }

        false
    }
}

/// Map a task priority to a valid bucket index.
///
/// The bitmask is safe because [`PRIORITY_LEVELS`] is a power of two.
#[inline]
fn priority_index(p: u8) -> usize {
    (p as usize) & (PRIORITY_LEVELS - 1)
}

// ── Global storage ────────────────────────────────────────────────────────

/// One scheduler per CPU, each behind its own mutex.
///
/// The inline `const { ... }` init requires Rust ≥ 1.79.
static LOCAL_SCHEDS: [Mutex<Option<LocalScheduler>>; MAX_CPUS] =
    [const { Mutex::new(None) }; MAX_CPUS];

// ── CPU count helper ─────────────────────────────────────────────────────

#[inline]
fn cpu_count() -> u32 {
    (crate::arch::cpu_count() as u32).min(MAX_CPUS as u32)
}

// ── Public API ───────────────────────────────────────────────────────────

/// Initialise the local scheduler for `cpu_id`.
///
/// If `cpu_id >= MAX_CPUS`, logs and returns without touching shared state
/// (the previous `cpu_id % MAX_CPUS` silently clobbered another CPU's
/// scheduler).
pub fn init_local(cpu_id: u32) {
    let idx = cpu_id as usize;
    if idx >= MAX_CPUS {
        crate::serial_println!(
            "  [SMP-SCHED] CPU#{} >= MAX_CPUS={}, refusing init",
            cpu_id,
            MAX_CPUS
        );
        return;
    }

    *LOCAL_SCHEDS[idx].lock() = Some(LocalScheduler::new(cpu_id));
    crate::serial_println!(
        "  [SMP-SCHED] CPU#{} local scheduler initialized",
        cpu_id
    );
}

/// Spawn a task on a specific CPU, or load-balance when `cpu_id == u32::MAX`.
///
/// # Wake-up
///
/// This function does **not** send an IPI. If the target CPU is in
/// `hlt`/`wfi`, it will only observe the new task at its next timer
/// interrupt.
pub fn spawn_on(cpu_id: u32, task: Task) {
    let target = if cpu_id == u32::MAX {
        pick_least_loaded_cpu()
    } else {
        cpu_id
    };

    let idx = target as usize;
    if idx < MAX_CPUS {
        let mut lock = LOCAL_SCHEDS[idx].lock();
        if let Some(ref mut s) = *lock {
            s.spawn(task);
            return;
        }
        // Scheduler not initialised yet — fall through to global.
    }

    sched::SCHEDULER.lock().spawn(task);
}

/// Pick the least-loaded initialised CPU.
///
/// Returns `0` if no CPU is initialised yet, so the caller falls back to
/// the global scheduler.
fn pick_least_loaded_cpu() -> u32 {
    let n = cpu_count();
    let mut min_load = usize::MAX;
    let mut target: u32 = 0;

    for c in 0..n {
        let idx = c as usize;
        if idx >= MAX_CPUS {
            break;
        }
        let guard = LOCAL_SCHEDS[idx].lock();
        if let Some(ref s) = *guard {
            let load = s.ready_count();
            if load < min_load {
                min_load = load;
                target = c;
            }
        }
    }
    target
}

/// Attempt to steal one task from a peer CPU.
///
/// Peers are scanned in round-robin order starting just after `thief_cpu`.
/// This function locks at most one peer at a time; the caller **must not**
/// hold any [`LOCAL_SCHEDS`] lock when calling it.
pub fn try_steal(thief_cpu: u32) -> Option<Task> {
    let n = cpu_count();
    if n <= 1 {
        return None;
    }

    for offset in 1..n {
        let victim = (thief_cpu.wrapping_add(offset)) % n;
        let idx = victim as usize;
        if idx >= MAX_CPUS {
            continue;
        }

        // Lock scope: acquire, steal, release.
        let stolen: Option<Task> = {
            let mut guard = LOCAL_SCHEDS[idx].lock();
            guard.as_mut().and_then(|s| s.steal_one())
        };

        if let Some(t) = stolen {
            crate::serial_println!(
                "  [STEAL] CPU#{} stole task from CPU#{}",
                thief_cpu,
                victim
            );
            return Some(t);
        }
    }
    None
}

/// Called by the timer handler on each CPU.
///
/// Ticks the local scheduler and, if the local ready queue is empty,
/// attempts to steal from a peer.
///
/// # Lock order
///
/// The local lock is released before [`try_steal`] acquires peer locks.
/// This is the invariant that makes the whole module deadlock-free.
pub fn schedule_local(cpu_id: u32) {
    let idx = cpu_id as usize;
    if idx >= MAX_CPUS {
        return;
    }

    // Phase 1: tick under our own lock and note whether we have queued work.
    let empty_queue = {
        let mut guard = LOCAL_SCHEDS[idx].lock();
        let Some(s) = guard.as_mut() else {
            return;
        };
        let _needs_switch = s.tick();
        s.ready_count() == 0
    };

    // Phase 2: if we have nothing queued, try to steal. Deliberately done
    // *outside* our own lock.
    if empty_queue {
        if let Some(t) = try_steal(cpu_id) {
            let mut guard = LOCAL_SCHEDS[idx].lock();
            if let Some(s) = guard.as_mut() {
                s.spawn(t);
            }
        }
    }
}

/// Current task ID on `cpu_id`, or `None` if the CPU is unknown or idle.
#[must_use]
pub fn current_tid(cpu_id: u32) -> Option<TaskId> {
    let idx = cpu_id as usize;
    if idx >= MAX_CPUS {
        return None;
    }
    let guard = LOCAL_SCHEDS[idx].lock();
    guard
        .as_ref()
        .and_then(|s| s.current.as_ref().map(|t| t.tid))
}

/// Block the task identified by `tid`.
///
/// The task is moved into the global blocked map; it will be picked up
/// again by [`wake_on_any`].
pub fn block_on_local(_cpu_id: u32, tid: TaskId) {
    // The CPU that owns the task is not tracked here; the global blocked
    // map is the single source of truth.
    sched::block_task(tid);
}

/// Wake a previously blocked task.
///
/// Currently delegates to the global scheduler, which will re-dispatch to
/// some CPU (possibly not the one the task was blocked on). A future
/// revision may track task-to-CPU affinity.
pub fn wake_on_any(tid: TaskId) {
    sched::wake_task(tid);
}

// ── Tests ─────────────────────────────────────────────────────────────────

// NOTE: real scheduler tests require a running kernel with per-CPU state.
// What we cover here is the pure, single-instance logic of `LocalScheduler`.
#[cfg(test)]
mod tests {
    use super::*;

    // The following tests assume a `Task` type with a `priority: u8` field
    // and `new_idle_for_cpu`. They are written to compile against the
    // module's own `priority_index` helper and against `LocalScheduler`
    // invariants that don't need hardware.

    #[test]
    fn priority_index_masks_correctly() {
        assert_eq!(priority_index(0), 0);
        assert_eq!(priority_index(1), 1);
        assert_eq!(priority_index(255), 255);
        // The mask is safe (PRIORITY_LEVELS is a power of two); a value
        // above 255 is impossible for a u8 anyway.
    }

    #[test]
    fn priority_levels_is_power_of_two() {
        assert!(PRIORITY_LEVELS.is_power_of_two());
    }

    #[test]
    fn max_cpus_is_a_power_of_two() {
        // APIC IDs are allocated in power-of-two ranges; this sanity-checks
        // our static array sizing assumption.
        assert!(MAX_CPUS.is_power_of_two());
    }
}
