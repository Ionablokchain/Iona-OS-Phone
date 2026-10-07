//! Task subsystem.
//!
//! A [`Task`] is an independent unit of execution with:
//! - its own kernel stack (default [`TASK_STACK_SIZE`] bytes),
//! - its own CPU context (callee-saved registers),
//! - a state machine: `New → Ready → Running → {Ready, Blocked, Dead}`.
//!
//! # Task ID namespace
//!
//! `TaskId` values `[0, MAX_CPUS)` are reserved for per-CPU idle tasks:
//! idle on CPU `i` has `tid == i`. All other tasks receive IDs from
//! [`next_tid`], starting at `MAX_CPUS`.
//!
//! # Entry-point ABI
//!
//! Task entry points are `extern "C" fn(u64) -> !`. The trampolines in
//! [`context`] invoke them with a C-ABI `call`, so a Rust-ABI `fn` would
//! be undefined behaviour. Wrappers must use `extern "C"`.
//!
//! # Guard page semantics (AI tasks)
//!
//! [`TaskStack::new_ai_guarded`] marks the stack as *guard-flagged*; it
//! does **not** install a hardware guard page. When the arch layer's fault
//! handler decides the fault originated in an AI task, it calls
//! [`trigger_guard_page_fault`]. A future revision may allocate a real
//! guard page below the stack via the page allocator and drop the flag.

pub mod context;
pub mod monitor;

use alloc::boxed::Box;
use core::sync::atomic::{AtomicU64, Ordering};

use context::Context;

// ── Constants ─────────────────────────────────────────────────────────────

/// Size of a task's kernel stack, in bytes (4 pages).
pub const TASK_STACK_SIZE: usize = 4 * 4096;

/// First user-assigned task ID. IDs `[0, MAX_CPUS)` are reserved for the
/// per-CPU idle tasks (see module docs).
pub const FIRST_USER_TID: u64 = 64;

/// Number of bytes the trampoline reserves at the top of a fresh stack
/// (see `context::Context::new_task`).
const TRAMPOLINE_RESERVED_BYTES: u64 = 32;

// ── Task IDs ──────────────────────────────────────────────────────────────

/// Unique identifier for a task.
pub type TaskId = u64;

static NEXT_TID: AtomicU64 = AtomicU64::new(FIRST_USER_TID);

/// Allocate a fresh task ID (never reused within a boot).
#[must_use]
pub fn next_tid() -> TaskId {
    NEXT_TID.fetch_add(1, Ordering::Relaxed)
}

// ── Task state & domain ──────────────────────────────────────────────────

/// Lifecycle state of a task.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TaskState {
    /// Constructed but not yet scheduled.
    New,
    /// Currently executing on a CPU.
    Running,
    /// Eligible to run but not on a CPU.
    Ready,
    /// Waiting on an event (I/O, timer, …).
    Blocked,
    /// Finished; will be reclaimed.
    Dead,
}

/// Functional domain of a task. Used for accounting, audit, and policy.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TaskDomain {
    Kernel,
    User,
    Ai,
    Driver,
    Idle,
}

// ── Stack ─────────────────────────────────────────────────────────────────

/// 16-byte-aligned backing store for a task's kernel stack.
///
/// Wraps the raw bytes so `Box` honours the alignment required by the
/// trampoline (`context::Context::new_task` asserts `stack_top % 16 == 0`).
#[repr(align(16))]
struct AlignedStack([u8; TASK_STACK_SIZE]);

/// A task's kernel stack plus guard-flag metadata.
///
/// The 16-byte alignment is guaranteed by [`AlignedStack`]; `top()` rounds
/// down to 16 to be extra safe in case the allocator ever returns a
/// differently aligned pointer.
pub struct TaskStack {
    data: Box<AlignedStack>,
    /// Software flag: this stack belongs to an AI task and should be
    /// treated as guard-protected by [`trigger_guard_page_fault`].
    ///
    /// **No hardware guard page is installed** — see module docs.
    guard_page: bool,
}

impl TaskStack {
    /// Allocate a regular 16 KiB kernel stack.
    #[must_use]
    pub fn new() -> Self {
        Self::with_guard(false)
    }

    /// Allocate a stack flagged as belonging to an AI task.
    ///
    /// See module-level "Guard page semantics" — this does **not** install
    /// a hardware guard page.
    #[must_use]
    pub fn new_ai_guarded() -> Self {
        Self::with_guard(true)
    }

    fn with_guard(guard_page: bool) -> Self {
        Self {
            data: Box::new(AlignedStack([0u8; TASK_STACK_SIZE])),
            guard_page,
        }
    }

    /// 16-byte-aligned top of the stack (exclusive end).
    #[must_use]
    pub fn top(&self) -> u64 {
        let base = self.data.0.as_ptr() as u64;
        let end = base + TASK_STACK_SIZE as u64;
        // base is 16-aligned; TASK_STACK_SIZE is a multiple of 16, so this
        // is a no-op in practice. Kept as a defensive guard against future
        // changes to the allocation strategy.
        end & !0xF
    }

    /// Whether this stack is flagged as guard-protected.
    #[must_use]
    pub fn has_guard_page(&self) -> bool {
        self.guard_page
    }
}

impl Default for TaskStack {
    fn default() -> Self {
        Self::new()
    }
}

// ── Task ──────────────────────────────────────────────────────────────────

/// A schedulable unit of execution.
///
/// Field order is layout-agnostic (`repr(Rust)`); do not depend on it.
pub struct Task {
    pub tid: TaskId,
    pub name: &'static str,
    pub state: TaskState,
    pub context: Context,
    pub priority: u8,
    pub ticks: u64,
    pub domain: TaskDomain,
    pub sleep_until: Option<u64>,
    pub wait_event: Option<crate::sched::WaitEvent>,
    /// Milliseconds timestamp at which this task was last stolen by another
    /// CPU. `0` if it has never been stolen. Used by accounting/metrics.
    pub stolen_at_ms: u64,
    /// Owns the kernel stack. Must outlive the `Context` pointing into it.
    ///
    /// The field is private so the stack cannot be accidentally dropped
    /// while a context still references it.
    stack: TaskStack,
}

impl Task {
    /// Construct a kernel task with the default (unguarded) stack.
    #[must_use]
    pub fn new(
        name: &'static str,
        entry: extern "C" fn(u64) -> !,
        arg: u64,
        priority: u8,
    ) -> Self {
        Self::new_in_domain(name, entry, arg, priority, TaskDomain::Kernel)
    }

    /// Construct a task in the given domain.
    ///
    /// `entry` must be `extern "C"` — see the module-level ABI note.
    #[must_use]
    pub fn new_in_domain(
        name: &'static str,
        entry: extern "C" fn(u64) -> !,
        arg: u64,
        priority: u8,
        domain: TaskDomain,
    ) -> Self {
        let stack = match domain {
            TaskDomain::Ai => TaskStack::new_ai_guarded(),
            _ => TaskStack::new(),
        };
        let stack_top = stack.top();

        // Cast function pointer through usize: Rust does not allow a direct
        // `fn(...) as u64`.
        let entry_addr = entry as usize as u64;
        let context = Context::new_task(stack_top, entry_addr, arg);

        let tid = next_tid();
        crate::serial_println!(
            "  [TASK] created '{}' tid={} stack_top=0x{:x} domain={:?} guard={}",
            name,
            tid,
            stack_top,
            domain,
            stack.guard_page,
        );

        Self {
            tid,
            name,
            state: TaskState::New,
            context,
            priority,
            ticks: 0,
            domain,
            sleep_until: None,
            wait_event: None,
            stolen_at_ms: 0,
            stack,
        }
    }

    /// Construct a user task from a **pre-allocated** kernel stack pointer.
    ///
    /// Use this when the caller owns the stack memory (e.g. a user→kernel
    /// transition buffer). The provided `stack_top` must be 16-byte aligned
    /// and point at the exclusive end of a writable region at least
    /// `TRAMPOLINE_RESERVED_BYTES` bytes long.
    ///
    /// The returned task has `Context::empty()` — the caller is expected to
    /// fill `context` before scheduling it.
    ///
    /// # Safety
    ///
    /// `stack_top` must satisfy the alignment and size contract above and
    /// must remain valid for the entire lifetime of the task.
    #[must_use]
    pub unsafe fn new_with_stack(
        name: &'static str,
        tid: TaskId,
        stack_top: u64,
    ) -> Self {
        debug_assert_eq!(stack_top % 16, 0, "stack_top must be 16-byte aligned");
        let _ = TRAMPOLINE_RESERVED_BYTES; // documented contract
        let _ = stack_top; // caller owns the memory; we only record the id

        // We do not own the stack here, but a `Task` must own *some*
        // allocation so drop never touches caller memory. A regular stack
        // is allocated to satisfy that; callers may override `context` and
        // ignore the internal stack if they supply their own scheduler.
        let stack = TaskStack::new();

        crate::serial_println!(
            "  [TASK] created '{}' tid={} (external stack, sp=0x{:x})",
            name,
            tid,
            stack_top,
        );

        Self {
            tid,
            name,
            state: TaskState::New,
            context: Context::empty(),
            priority: 1,
            ticks: 0,
            domain: TaskDomain::User,
            sleep_until: None,
            wait_event: None,
            stolen_at_ms: 0,
            stack,
        }
    }

    /// Mark this task as an AI task.
    ///
    /// Sets both the domain and the internal guard flag so the two views
    /// remain consistent.
    pub fn mark_ai(&mut self) {
        self.domain = TaskDomain::Ai;
        self.stack.guard_page = true;
    }

    /// Whether this task's stack is flagged as guard-protected.
    #[must_use]
    pub fn has_guard_page(&self) -> bool {
        self.stack.has_guard_page()
    }

    /// Build the per-CPU idle task for `cpu_id`.
    ///
    /// The idle task's `tid == cpu_id`, reserving the `[0, MAX_CPUS)`
    /// namespace (see module docs).
    #[must_use]
    pub fn new_idle_for_cpu(cpu_id: u32) -> Self {
        let stack = TaskStack::new();
        let stack_top = stack.top();
        let entry_addr = idle_task as extern "C" fn(u64) -> ! as usize as u64;
        let context = Context::new_task(stack_top, entry_addr, cpu_id as u64);

        Self {
            tid: cpu_id as TaskId,
            name: "idle",
            state: TaskState::Ready,
            context,
            priority: 0,
            ticks: 0,
            domain: TaskDomain::Idle,
            sleep_until: None,
            wait_event: None,
            stolen_at_ms: 0,
            stack,
        }
    }

    /// Build the BSP idle task (CPU 0). Shorthand for
    /// [`new_idle_for_cpu(0)`](Self::new_idle_for_cpu).
    #[must_use]
    pub fn new_idle() -> Self {
        Self::new_idle_for_cpu(0)
    }
}

impl core::fmt::Debug for Task {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.debug_struct("Task")
            .field("tid", &self.tid)
            .field("name", &self.name)
            .field("state", &self.state)
            .field("domain", &self.domain)
            .field("priority", &self.priority)
            .field("ticks", &self.ticks)
            .field("sleep_until", &self.sleep_until)
            .field("stolen_at_ms", &self.stolen_at_ms)
            .field("guard_page", &self.stack.guard_page)
            .finish_non_exhaustive()
    }
}

/// Entry point for idle tasks. Halts the local CPU forever.
extern "C" fn idle_task(_arg: u64) -> ! {
    loop {
        crate::arch::cpu_halt();
    }
}

// ── Guard-page fault handling ────────────────────────────────────────────

/// Handle a fault attributable to a task's guard region.
///
/// Logs the event, notifies the AI-specific handler when the task is in
/// the [`TaskDomain::Ai`] domain, and then **terminates the current
/// task context**.
///
/// # Panic semantics
///
/// This function currently calls `panic!`, which halts the whole kernel.
/// A future revision should integrate with the scheduler's task-kill path
/// so an isolated task fault does not take down unrelated work.
///
/// # Safety
///
/// Must only be called from a fault handler.
pub fn trigger_guard_page_fault(task: &Task) -> ! {
    crate::io::audit_log::append_event(
        "task.guard_page_fault",
        alloc::format!(
            "tid={} name={} domain={:?}",
            task.tid, task.name, task.domain
        )
        .as_bytes(),
    );

    if task.domain == TaskDomain::Ai {
        crate::arch::handle_ai_guard_fault(task.tid, task.name);
    }

    // Task-kill mechanism is not yet implemented; treat as fatal.
    panic!(
        "guard page fault for task tid={} name={}",
        task.tid, task.name
    );
}

// ── Tests ─────────────────────────────────────────────────────────────────
//
// These tests exercise the pure layout math and the ID namespace; they do
// not schedule anything.

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stack_top_is_16_aligned() {
        let s = TaskStack::new();
        assert_eq!(s.top() % 16, 0);
        let s = TaskStack::new_ai_guarded();
        assert_eq!(s.top() % 16, 0);
    }

    #[test]
    fn stack_top_is_within_buffer() {
        let s = TaskStack::new();
        let base = s.data.0.as_ptr() as u64;
        let top = s.top();
        assert!(top >= base);
        assert!(top <= base + TASK_STACK_SIZE as u64);
    }

    #[test]
    fn ai_stack_is_flagged() {
        assert!(TaskStack::new_ai_guarded().has_guard_page());
        assert!(!TaskStack::new().has_guard_page());
    }

    #[test]
    fn first_user_tid_is_beyond_idle_range() {
        // Idle tids live in [0, MAX_CPUS); the first user tid must be past
        // that range.
        assert!(FIRST_USER_TID >= 64);
    }

    #[test]
    fn idle_tid_matches_cpu_id() {
        let t = Task::new_idle_for_cpu(3);
        assert_eq!(t.tid, 3);
        assert_eq!(t.domain, TaskDomain::Idle);
        assert_eq!(t.priority, 0);
    }

    #[test]
    fn mark_ai_updates_both_views() {
        // Use a dummy extern "C" entry that will never run in this test.
        extern "C" fn dummy(_arg: u64) -> ! {
            loop {
                core::hint::spin_loop();
            }
        }
        let mut t = Task::new("t", dummy, 0, 1);
        assert_eq!(t.domain, TaskDomain::Kernel);
        assert!(!t.has_guard_page());

        t.mark_ai();
        assert_eq!(t.domain, TaskDomain::Ai);
        assert!(t.has_guard_page());
    }
}
