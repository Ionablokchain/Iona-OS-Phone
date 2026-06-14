//! Kernel backtrace — frame pointer chain walk
//!
//! Functioneaza daca kernelul e compilat cu frame pointers (default in debug).
//! Release: necesita -C force-frame-pointers=yes or unwinfromg via .eh_frame.
//!
//! Walk:
//!   1. Reads RBP current
//!   2. La each frame: RBP+8 = return address, *RBP = previous RBP
//!   3. Verifica ca address is in kernel range (0xFFFF...)
//!   4. Max 64 frames
//!
//! Symbol resolution: without symtable embedded, afisam adresele brute.
//! Cu gdb: `add-symbol-file target/.../iona-os-kernel` si `info symbol 0xADDR`

use crate::memory::mapper::PHYS_OFFSET;
use alloc::{vec::Vec, format, string::String};

pub const MAX_FRAMES: usize = 64;
const KERNEL_BASE:    u64   = PHYS_OFFSET;

#[derive(Clone, Debug)]
pub struct Frame {
    pub rip:   u64,
    pub rbp:   u64,
    pub depth: usize,
}

impl Frame {
    pub fn format(&self) -> String {
        format!("  #{:2} 0x{:016x} (rbp=0x{:016x})", self.depth, self.rip, self.rbp)
    }
}

/// Walk the frame pointer chain starting from `rbp`.
/// Call with `current_rbp()` to capture the live stack.
pub fn walk_frames(start_rbp: u64) -> Vec<Frame> {
    let mut frames = Vec::new();
    let mut rbp = start_rbp;

    for depth in 0..MAX_FRAMES {
        // Validate RBP: must be kernel address and 8-byte aligned
        if rbp < KERNEL_BASE || rbp & 7 != 0 { break; }

        // SAFETY: invariant guaranteed by caller contract; bounds verified above
        unsafe {
            // RIP is at [RBP + 8]
            let rip_ptr = (rbp + 8) as *const u64;
            let rbp_ptr =  rbp      as *const u64;

            // Bounds check before deref
            if rip_ptr as u64 >= u64::MAX - 8 { break; }

            let rip = core::ptr::read_volatile(rip_ptr);
            let prev_rbp = core::ptr::read_volatile(rbp_ptr);

            // Stop on obviously bogus RIP
            if rip == 0 || rip < KERNEL_BASE { break; }

            frames.push(Frame { rip, rbp, depth });

            // Detect cycle or non-progressing stack
            if prev_rbp <= rbp { break; }
            rbp = prev_rbp;
        }
    }
    frames
}

/// Capture current frame pointer (RBP) inline
#[inline(always)]
pub fn current_rbp() -> u64 {
    let rbp: u64;
    // SAFETY: inline assembly — required for privileged x86_64 CPU instruction
    unsafe { core::arch::asm!("mov {}, rbp", out(reg) rbp, options(nostack, nomem)); }
    rbp
}

/// Capture complete backtrace from current execution point
pub fn capture() -> Vec<Frame> {
    let rbp = current_rbp();
    walk_frames(rbp)
}

/// Print backtrace to serial output
pub fn print(frames: &[Frame]) {
    crate::serial_println!("--- backtrace ({} frames) ---", frames.len());
    for f in frames {
        crate::serial_println!("{}", f.format());
    }
    crate::serial_println!("--- end backtrace ---");
}

/// Print backtrace from current point (convenience)
pub fn print_current() {
    let frames = capture();
    print(&frames);
}

/// Format backtrace as a single string (for crash dumps)
pub fn format_string(frames: &[Frame]) -> alloc::string::String {
    let mut s = alloc::string::String::new();
    for f in frames {
        s.push_str(&f.format());
        s.push('\n');
    }
    s
}
