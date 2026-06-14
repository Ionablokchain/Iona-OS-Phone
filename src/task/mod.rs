
//! Task subsystem
//!
//! Un task = o unitate de executie independenta cu:
//! - propriul stack kernel (4 pages = 16KB)
//! - propriul context CPU (registers callee-saved)
//! - state: New, Running, Ready, Blocked, Dead

pub mod context;
pub mod monitor;

use alloc::boxed::Box;
use core::sync::atomic::{AtomicU64, Ordering};
use context::Context;

static NEXT_TID: AtomicU64 = AtomicU64::new(1);
pub type TaskId = u64;

pub fn next_tid() -> TaskId { NEXT_TID.fetch_add(1, Ordering::Relaxed) }

pub const TASK_STACK_SIZE: usize = 4 * 4096;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TaskState { New, Running, Ready, Blocked, Dead }

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TaskDomain { Kernel, User, Ai, Driver, Idle }

#[repr(C, align(16))]
pub struct TaskStack { data: Box<[u8; TASK_STACK_SIZE]>, guard_page: bool }

impl TaskStack {
    pub fn new() -> Self { Self { data: Box::new([0u8; TASK_STACK_SIZE]), guard_page: false } }
    pub fn new_ai_guarded() -> Self { Self { data: Box::new([0u8; TASK_STACK_SIZE]), guard_page: true } }
    pub fn top(&self) -> u64 {
        let ptr = self.data.as_ptr() as u64;
        (ptr + TASK_STACK_SIZE as u64) & !0xF
    }
}

pub struct Task {
    pub sleep_until:   Option<u64>,
    pub wait_event:    Option<crate::sched::WaitEvent>,
    pub tid:           TaskId,
    pub name:          &'static str,
    pub state:         TaskState,
    pub context:       Context,
    _stack:            TaskStack,
    pub priority:      u8,
    pub ticks:         u64,
    pub stolen_at_ms:  u64,
    pub domain:        TaskDomain,
}

impl Task {
    pub fn new(name: &'static str, entry: fn(u64) -> !, arg: u64, priority: u8) -> Self {
        Self::new_in_domain(name, entry, arg, priority, TaskDomain::Kernel)
    }

    pub fn new_in_domain(name: &'static str, entry: fn(u64) -> !, arg: u64, priority: u8, domain: TaskDomain) -> Self {
        let stack = if domain == TaskDomain::Ai { TaskStack::new_ai_guarded() } else { TaskStack::new() };
        let stack_top = stack.top();
        let context = Context::new_task(stack_top, entry as u64, arg);
        let tid = next_tid();
        crate::serial_println!("  [TASK] created '{}' tid={} stack_top=0x{:x} domain={:?} guard={}", name, tid, stack_top, domain, stack.guard_page);
        Task {
            tid, name, state: TaskState::New, context, _stack: stack, priority, ticks: 0,
            sleep_until: None, wait_event: None, stolen_at_ms: 0, domain,
        }
    }

    pub fn new_with_stack(name: &'static str, tid: TaskId, stack_ptr: u64) -> Self {
        let stack = TaskStack::new();
        let context = Context::empty();
        crate::serial_println!("  [TASK] created '{}' tid={} sp=0x{:x}", name, tid, stack_ptr);
        Task {
            tid, name, state: TaskState::New, context, _stack: stack, priority: 1, ticks: 0,
            sleep_until: None, wait_event: None, stolen_at_ms: 0, domain: TaskDomain::User,
        }
    }

    pub fn mark_ai(&mut self) { self.domain = TaskDomain::Ai; }

    pub fn new_idle() -> Self {
        let stack = TaskStack::new();
        let stack_top = stack.top();
        let context = Context::new_task(stack_top, idle_task as *const () as u64, 0);
        Task {
            tid: 0, name: "idle", state: TaskState::Ready, context, _stack: stack,
            priority: 0, ticks: 0, sleep_until: None, wait_event: None, stolen_at_ms: 0, domain: TaskDomain::Idle,
        }
    }
}

fn idle_task(_arg: u64) -> ! { loop { crate::arch::cpu_halt(); } }


impl Task {
    pub fn has_guard_page(&self) -> bool { self._stack.guard_page }
}


pub fn trigger_guard_page_fault(task: &Task) -> ! {
    crate::io::audit_log::append_event(
        "task.guard_page_fault",
        alloc::format!("tid={} name={} domain={:?}", task.tid, task.name, task.domain).as_bytes()
    );
    if task.domain == TaskDomain::Ai {
        crate::arch::handle_ai_guard_fault(task.tid, task.name);
    }
    panic!("guard page fault for task {}", task.name);
}
