//! Saved CPU context — dual-arch: x86_64 and AArch64.
//!
//! The `Context` type is architecture-specific but its public API is
//! identical on both targets:
//!
//! ```text
//! Context::empty()                          — all-zero context
//! Context::new_task(stack_top, entry, arg)  — context for a fresh task
//! ```
//!
//! # Saved registers
//!
//! | Arch    | Callee-saved registers                          |
//! |---------|-------------------------------------------------|
//! | x86_64  | r15, r14, r13, r12, rbp, rbx, rsp (SysV AMD64)  |
//! | AArch64 | x19..x28, x29 (fp), x30 (lr), sp (AAPCS64)      |
//!
//! # Stack alignment
//!
//! `new_task` expects `stack_top` to be **16-byte aligned** — a requirement
//! shared by SysV AMD64 and AAPCS64 at any public interface. Each
//! trampoline inserts a small padding adjustment before calling the user
//! entry point so the callee observes the alignment its ABI requires.
//!
//! # Toolchain requirements
//!
//! Both trampolines are `#[naked]` functions using `naked_asm!`. This
//! requires Rust **≥ 1.88** on the stable channel (or a nightly toolchain
//! with `#![feature(naked_functions)]` on older releases). On edition 2024
//! the attribute may need to be spelled `#[unsafe(naked)]`.
//!
//! # Safety
//!
//! This module writes to raw stack memory and executes privileged
//! instructions (`sti`, `msr daifclr`, `hlt`, `wfi`). It is only safe to
//! call from kernel context (ring 0 / EL1).

// ─── x86_64 ──────────────────────────────────────────────────────────────

#[cfg(target_arch = "x86_64")]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
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
    /// All-zero context. Not directly runnable.
    pub const ZERO: Self = Self {
        r15: 0,
        r14: 0,
        r13: 0,
        r12: 0,
        rbp: 0,
        rbx: 0,
        rsp: 0,
    };

    /// Alias for [`Self::ZERO`].
    #[must_use]
    pub const fn empty() -> Self {
        Self::ZERO
    }

    /// Build a context that enters `entry(arg)` on first switch-to.
    ///
    /// # Stack layout (from `stack_top` downward)
    ///
    /// ```text
    /// stack_top -  8: task_exit_stub
    /// stack_top - 16: arg
    /// stack_top - 24: entry
    /// stack_top - 32: task_entry_trampoline   ← initial rsp
    /// ```
    ///
    /// The context-switch routine restores `rsp` to `stack_top - 32` and
    /// executes `ret`, popping the trampoline address. The trampoline then
    /// pops `entry` and `arg`, re-aligns `rsp` for the `call`, enables
    /// interrupts, and calls `entry(arg)`.
    ///
    /// # Safety (caller contract)
    ///
    /// The caller must guarantee:
    ///
    /// 1. `stack_top` points at the top of a **writable** stack region with
    ///    at least 32 bytes of free space below it, plus enough room for
    ///    the task's own stack usage.
    /// 2. `stack_top` is **16-byte aligned** (enforced by `debug_assert` in
    ///    debug builds; the trampoline's padding adjustment assumes it).
    /// 3. `entry` is a valid `extern "C" fn(u64) -> !`, or a function that
    ///    never returns. If `entry` returns, the trampoline calls
    ///    [`task_exit_stub`].
    #[must_use]
    pub fn new_task(stack_top: u64, entry: u64, arg: u64) -> Self {
        debug_assert_eq!(stack_top % 16, 0, "stack_top must be 16-byte aligned");

        let sp = stack_top as *mut u64;
        // SAFETY: caller contract (1)–(3) above; all four writes stay
        // within the 32-byte reservation at the top of the stack.
        unsafe {
            sp.sub(1).write(task_exit_stub as usize as u64);
            sp.sub(2).write(arg);
            sp.sub(3).write(entry);
            sp.sub(4).write(task_entry_trampoline as usize as u64);
        }

        Self {
            r15: 0,
            r14: 0,
            r13: 0,
            r12: 0,
            rbp: 0,
            rbx: 0,
            rsp: stack_top - 4 * 8,
        }
    }
}

/// First code executed by a fresh x86_64 task.
///
/// Called via `ret` from the context-switch routine, with `rsp` pointing
/// at the `entry` slot pushed by [`Context::new_task`].
///
/// Effects:
/// - Pops `entry` into rdi and `arg` into rsi.
/// - Subtracts 8 from `rsp` so the subsequent `call` observes the 16-byte
///   stack alignment required by the SysV AMD64 ABI.
/// - Enables maskable interrupts (`sti`).
/// - Calls `entry(arg)`.
/// - If `entry` returns, calls [`task_exit_stub`], which halts.
#[cfg(target_arch = "x86_64")]
#[naked]
unsafe extern "C" fn task_entry_trampoline() {
    core::arch::naked_asm!(
        // rsp now points at the `entry` slot.
        "pop rdi",              // rdi = entry
        "pop rsi",              // rsi = arg
        "xchg rdi, rsi",        // rdi = arg, rsi = entry
        "sub rsp, 8",           // SysV AMD64: align rsp for the upcoming call
        "sti",                  // tasks run with interrupts enabled
        "call rsi",             // entry(arg)
        // Unreachable in the normal case; restores alignment for tidiness.
        "add rsp, 8",
        "call {exit}",
        exit = sym task_exit_stub,
    );
}

/// Fallback exit for an x86_64 task whose entry point returned.
///
/// Halts the CPU in a loop. A future revision should instead notify the
/// per-core scheduler and switch to the next runnable task.
#[cfg(target_arch = "x86_64")]
pub fn task_exit_stub() -> ! {
    crate::serial_println!("[SCHED] x86_64 task exited — halting");
    loop {
        // SAFETY: `hlt` is privileged and valid in ring 0.
        unsafe {
            core::arch::asm!("hlt", options(nomem, nostack, preserves_flags));
        }
    }
}

// ─── AArch64 ─────────────────────────────────────────────────────────────
//
// Layout (byte offsets within the struct):
//    0: x19     8: x20    16: x21    24: x22
//   32: x23    40: x24    48: x25    56: x26
//   64: x27    72: x28    80: x29 (fp)
//   88: x30 (lr — trampoline address)
//   96: sp

#[cfg(target_arch = "aarch64")]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(C)]
pub struct Context {
    pub x19: u64,
    pub x20: u64,
    pub x21: u64,
    pub x22: u64,
    pub x23: u64,
    pub x24: u64,
    pub x25: u64,
    pub x26: u64,
    pub x27: u64,
    pub x28: u64,
    pub x29: u64,
    pub x30: u64,
    pub sp: u64,
}

#[cfg(target_arch = "aarch64")]
impl Context {
    /// All-zero context. Not directly runnable.
    pub const ZERO: Self = Self {
        x19: 0,
        x20: 0,
        x21: 0,
        x22: 0,
        x23: 0,
        x24: 0,
        x25: 0,
        x26: 0,
        x27: 0,
        x28: 0,
        x29: 0,
        x30: 0,
        sp: 0,
    };

    /// Alias for [`Self::ZERO`].
    #[must_use]
    pub const fn empty() -> Self {
        Self::ZERO
    }

    /// Build a context that enters `entry(arg)` on first switch-to.
    ///
    /// The context-switch routine loads `x30` = trampoline address and
    /// `sp` = `stack_top - 3 * 8`, then executes `ret`, jumping to the
    /// trampoline. The trampoline pops `entry` and `arg`, re-aligns `sp`
    /// for the call, enables IRQs, and calls `entry(arg)`.
    ///
    /// # Stack layout (from `stack_top` downward)
    ///
    /// ```text
    /// stack_top -  8: task_exit_stub_arm64
    /// stack_top - 16: arg
    /// stack_top - 24: entry
    ///                 ↑ initial sp
    /// ```
    ///
    /// # Safety (caller contract)
    ///
    /// Same as the x86_64 counterpart:
    ///
    /// 1. `stack_top` points at the top of a writable stack region with at
    ///    least 24 bytes of free space below it.
    /// 2. `stack_top` is 16-byte aligned.
    /// 3. `entry` is a valid `extern "C" fn(u64) -> !`.
    #[must_use]
    pub fn new_task(stack_top: u64, entry: u64, arg: u64) -> Self {
        debug_assert_eq!(stack_top % 16, 0, "stack_top must be 16-byte aligned");

        let sp = stack_top as *mut u64;
        // SAFETY: caller contract (1)–(3) above; all three writes stay
        // within the 24-byte reservation at the top of the stack.
        unsafe {
            sp.sub(1).write(task_exit_stub_arm64 as usize as u64);
            sp.sub(2).write(arg);
            sp.sub(3).write(entry);
        }

        Self {
            x19: 0,
            x20: 0,
            x21: 0,
            x22: 0,
            x23: 0,
            x24: 0,
            x25: 0,
            x26: 0,
            x27: 0,
            x28: 0,
            x29: 0,
            x30: task_entry_trampoline_arm64 as usize as u64,
            sp: stack_top - 3 * 8,
        }
    }
}

/// First code executed by a fresh AArch64 task.
///
/// Entered via `ret` (from the context-switch routine) with `sp` pointing
/// at the `entry` slot pushed by [`Context::new_task`].
///
/// Effects:
/// - Loads `entry` into x0 and `arg` into x1, advancing `sp` by 16 bytes.
/// - Adjusts `sp` so the subsequent `blr` observes the 16-byte stack
///   alignment required by AAPCS64.
/// - Clears the IRQ mask (`msr daifclr, #2`), so the task runs with IRQs
///   enabled.
/// - Calls `entry(arg)`.
/// - If `entry` returns, calls [`task_exit_stub_arm64`], which halts.
///
/// Note: `blr` implicitly overwrites `x30` with the trampoline's own
/// return address, so a prior `ldr x30, [sp]` would be dead code.
#[cfg(target_arch = "aarch64")]
#[naked]
unsafe extern "C" fn task_entry_trampoline_arm64() {
    core::arch::naked_asm!(
        // sp now points at the `entry` slot.
        "ldp x0, x1, [sp], #16",  // x0 = entry, x1 = arg; sp += 16
        "sub sp, sp, #8",          // AAPCS64: align sp for the upcoming call
        "msr daifclr, #2",         // tasks run with IRQs enabled
        "mov x2, x0",              // x2 = entry
        "mov x0, x1",              // x0 = arg (first argument per AAPCS64)
        "blr x2",                  // entry(arg)
        // If entry returned, sp is unchanged from the alignment adjustment.
        "bl {exit}",
        exit = sym task_exit_stub_arm64,
    );
}

/// Fallback exit for an AArch64 task whose entry point returned.
///
/// Halts the core in a low-power loop. A future revision should instead
/// notify the per-core scheduler and switch to the next runnable task.
#[cfg(target_arch = "aarch64")]
pub fn task_exit_stub_arm64() -> ! {
    crate::serial_println!("[SCHED] AArch64 task exited — halting core");
    loop {
        // SAFETY: `wfi` is valid at EL1.
        unsafe {
            core::arch::asm!("wfi", options(nomem, nostack, preserves_flags));
        }
    }
}

// ─── Platform-agnostic exit stub alias ───────────────────────────────────

#[cfg(target_arch = "x86_64")]
pub use task_exit_stub as task_exit;

#[cfg(target_arch = "aarch64")]
pub use task_exit_stub_arm64 as task_exit;

// ─── Tests ────────────────────────────────────────────────────────────────
//
// Tests cover the pure layout math of `Context`, not the trampolines (which
// require a running kernel).

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn context_size_is_expected() {
        #[cfg(target_arch = "x86_64")]
        assert_eq!(core::mem::size_of::<Context>(), 7 * 8);
        #[cfg(target_arch = "aarch64")]
        assert_eq!(core::mem::size_of::<Context>(), 13 * 8);
    }

    #[test]
    fn context_alignment_is_u64() {
        assert_eq!(core::mem::align_of::<Context>(), 8);
    }

    #[test]
    fn empty_context_equals_zero() {
        assert_eq!(Context::empty(), Context::ZERO);
    }

    #[test]
    #[cfg(target_arch = "x86_64")]
    fn new_task_writes_expected_layout() {
        // 16 u64 slots give us plenty of room for the 4-slot reservation.
        let mut stack = [0u64; 16];
        let raw = stack.as_mut_ptr() as u64;
        let end = raw + (stack.len() * 8) as u64;
        // Round DOWN to 16 bytes so `new_task`'s `debug_assert` passes.
        let stack_top = end & !0xF;
        // Guarantee we still have 32 bytes below `stack_top`.
        assert!(stack_top - 32 >= raw, "test stack too small");

        let entry: u64 = 0xDEAD_BEEF;
        let arg: u64 = 0x1234_5678;
        let ctx = Context::new_task(stack_top, entry, arg);

        assert_eq!(ctx.rsp, stack_top - 32);

        // SAFETY: we just wrote these slots.
        unsafe {
            let base = stack_top as *const u64;
            assert_eq!(base.sub(1).read(), task_exit_stub as usize as u64);
            assert_eq!(base.sub(2).read(), arg);
            assert_eq!(base.sub(3).read(), entry);
            assert_eq!(
                base.sub(4).read(),
                task_entry_trampoline as usize as u64
            );
        }
    }

    #[test]
    #[cfg(target_arch = "aarch64")]
    fn new_task_writes_expected_layout() {
        let mut stack = [0u64; 16];
        let raw = stack.as_mut_ptr() as u64;
        let end = raw + (stack.len() * 8) as u64;
        let stack_top = end & !0xF;
        assert!(stack_top - 24 >= raw, "test stack too small");

        let entry: u64 = 0xDEAD_BEEF;
        let arg: u64 = 0x1234_5678;
        let ctx = Context::new_task(stack_top, entry, arg);

        assert_eq!(ctx.sp, stack_top - 24);
        assert_eq!(ctx.x30, task_entry_trampoline_arm64 as usize as u64);

        // SAFETY: we just wrote these slots.
        unsafe {
            let base = stack_top as *const u64;
            assert_eq!(base.sub(1).read(), task_exit_stub_arm64 as usize as u64);
            assert_eq!(base.sub(2).read(), arg);
            assert_eq!(base.sub(3).read(), entry);
        }
    }
}
