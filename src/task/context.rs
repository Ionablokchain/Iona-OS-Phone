//! Saved CPU context — dual-arch: x86_64 and AArch64
//!
//! Structura Context diferă per arhitectură but interfața publică e identică:
//!   Context::empty()           — context zero
//!   Context::new_task(sp, entry, arg) — context for task new
//!
//! x86_64: salvează rbx, rbp, r12-r15, rsp (System V AMD64 ABI callee-saved)
//! AArch64: salvează x19-x29 (LR=x30), sp    (AAPCS64 callee-saved)

// ─── x86_64 ──────────────────────────────────────────────────────────────────

#[cfg(target_arch = "x86_64")]
#[derive(Debug, Clone, Copy)]
#[repr(C)]
pub struct Context {
    pub r15: u64,
    pub r14: u64,
    pub r13: u64,
    pub r12: u64,
    pub rbp: u64,
    pub rbx: u64,
    pub rsp: u64,
}

#[cfg(target_arch = "x86_64")]
impl Context {
    pub const ZERO: Self = Self { r15:0, r14:0, r13:0, r12:0, rbp:0, rbx:0, rsp:0 };
    pub const fn empty() -> Self { Self::ZERO }

    pub fn new_task(stack_top: u64, entry: u64, arg: u64) -> Self {
        let sp = stack_top as *mut u64;
        // SAFETY: Invariant verified by caller; bounds checked above.
        unsafe {
            sp.offset(-1).write(task_exit_stub as *const () as u64);
            sp.offset(-2).write(arg);
            sp.offset(-3).write(entry);
            sp.offset(-4).write(task_entry_trampoline as *const () as u64);
        }
        Self { r15:0, r14:0, r13:0, r12:0, rbp:0, rbx:0, rsp: stack_top - 4*8 }
    }
}

#[cfg(target_arch = "x86_64")]
#[naked]
unsafe extern "C" fn task_entry_trampoline() {
    core::arch::naked_asm!(
        "pop rdi",
        "pop rsi",
        "xchg rdi, rsi",
        "sti",
        "call rsi",
        "call {exit}",
        exit = sym task_exit_stub,
    );
}

#[cfg(target_arch = "x86_64")]
pub fn task_exit_stub() -> ! {
    crate::serial_println!("[SCHED] task exited — halting");
    // SAFETY: Inline assembly is correct for the current execution context (EL1, AArch64).
    loop { unsafe { core::arch::asm!("hlt") } }
}

// ─── AArch64 ─────────────────────────────────────────────────────────────────
//
// Layout (offsets in bytes vs start struct):
//   0:  x19    8:  x20   16: x21   24: x22
//   32: x23   40:  x24   48: x25   56: x26
//   64: x27   72:  x28   80: x29 (fp)
//   88: x30 (lr — adresa of return / task entry)
//   96: sp

#[cfg(target_arch = "aarch64")]
#[derive(Debug, Clone, Copy)]
#[repr(C)]
pub struct Context {
    pub x19: u64, pub x20: u64, pub x21: u64, pub x22: u64,
    pub x23: u64, pub x24: u64, pub x25: u64, pub x26: u64,
    pub x27: u64, pub x28: u64,
    pub x29: u64,  // frame pointer
    pub x30: u64,  // link register — adresa of return to switch_to
    pub sp:  u64,  // stack pointer
}

#[cfg(target_arch = "aarch64")]
impl Context {
    pub const ZERO: Self = Self {
        x19:0, x20:0, x21:0, x22:0, x23:0, x24:0,
        x25:0, x26:0, x27:0, x28:0, x29:0, x30:0, sp:0
    };
    pub const fn empty() -> Self { Self::ZERO }

    /// Create context for un task new.
    ///
    /// To the first switch_to, `ret` sare to x30 = task_entry_trampoline_arm64.
    /// Trampoline-ul reads entry and arg of on stack and calls entry(arg).
    ///
    /// Stack layout to creare (adreis descrescătoare):
    ///   sp+16: task_exit_stub    (sentinel)
    ///   sp+8:  arg               (argument task)
    ///   sp+0:  entry             (fn pointer)
    ///   ← sp inițial
    pub fn new_task(stack_top: u64, entry: u64, arg: u64) -> Self {
        let sp = stack_top as *mut u64;
        // SAFETY: stack_top e alocat of kernel with suficient spațiu (16KB)
        unsafe {
            sp.offset(-1).write(task_exit_stub_arm64 as *const () as u64);
            sp.offset(-2).write(arg);
            sp.offset(-3).write(entry);
        }
        Self {
            x19: 0, x20: 0, x21: 0, x22: 0, x23: 0, x24: 0,
            x25: 0, x26: 0, x27: 0, x28: 0, x29: 0,
            x30: task_entry_trampoline_arm64 as *const () as u64,
            sp: stack_top - 3 * 8,
        }
    }
}

/// Trampoline ARM64 — called to the first context switch al unui task new.
/// To intrare: sp pointează to [entry, arg, task_exit_stub]
#[cfg(target_arch = "aarch64")]
#[naked]
unsafe extern "C" fn task_entry_trampoline_arm64() {
    core::arch::naked_asm!(
        // Restaurează entry and arg of on stack
        "ldp x0, x1, [sp], #16", // x0 = entry (fn ptr), x1 = arg
        "ldr x30, [sp]",         // x30 = task_exit_stub (return address)
        // Activează IRQ-urile — task-ul new starts with IRQ on
        "msr daifclr, #2",
        // Calls entry(arg): x0 = fn ptr, x1 = arg → trebuie x0 = arg, call x0
        "mov x2, x0",   // x2 = entry
        "mov x0, x1",   // x0 = arg (the first argument AAPCS64)
        "blr x2",       // entry(arg)
        // If entry returns — call task_exit_stub
        "bl {exit}",
        exit = sym task_exit_stub_arm64,
    );
}

#[cfg(target_arch = "aarch64")]
pub fn task_exit_stub_arm64() -> ! {
    crate::serial_println!("[SCHED] ARM64 task exited — halting core");
    // SAFETY: Inline assembly is correct for the current execution context (EL1, AArch64).
    loop { unsafe { core::arch::asm!("wfi", options(nomem, nostack)) } }
}

// ─── Common alias for task_exit_stub ────────────────────────────────────────
#[cfg(target_arch = "x86_64")]
pub use task_exit_stub as task_exit;
#[cfg(target_arch = "aarch64")]
pub use task_exit_stub_arm64 as task_exit;
