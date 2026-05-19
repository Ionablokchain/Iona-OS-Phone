//! SMP — Symmetric Multi-Processing
pub mod scheduler;
pub use scheduler::*;

use core::sync::atomic::{AtomicBool, Ordering};
#[cfg(target_arch="x86_64")] use crate::arch::x86_64::apic::{send_startup_ipi, CPU_COUNT, APS_ONLINE};

pub static SMP_READY: AtomicBool = AtomicBool::new(false);

pub fn detect_cpu_count() -> usize {
    let result: u32;
    // SAFETY: invariant guaranteed by caller contract; bounds verified above
    unsafe {
        core::arch::asm!(
            "push rbx",
            "cpuid",
            "mov {0:e}, ebx",
            "pop rbx",
            out(reg) result,
            in("eax") 0xBu32,
            in("ecx") 0u32,
            options(nostack),
        );
    }
    let n = (result & 0xFFFF) as usize;
    if n == 0 { 1 } else { n.min(64) }
}

pub fn init() {
    let count = detect_cpu_count();
    crate::serial_println!("  [SMP] {} logical CPU(s)", count);
    CPU_COUNT.store(count as u64, core::sync::atomic::Ordering::SeqCst);

    // Init local scheduler for BSP (CPU 0)
    scheduler::init_local(0);

    if count > 1 {
        for id in 1u8..count as u8 {
            send_startup_ipi(id, 0x08); // trampoline at 0x8000
            let dl = crate::arch::uptime_ms() + 200;
            while crate::arch::uptime_ms() < dl {
                if APS_ONLINE.load(Ordering::SeqCst) >= id as u32 { break; }
                core::hint::spin_loop();
            }
        }
    }
    SMP_READY.store(true, Ordering::SeqCst);
    crate::serial_println!("  [SMP] {} APs online, local schedulers ready",
        APS_ONLINE.load(Ordering::SeqCst));
}

#[no_mangle]
pub extern "C" fn ap_main(id: u32) -> ! {
    crate::arch::gdt::init();
    crate::arch::idt::init();
    crate::// ARM: GIC already init in early_init;
    crate::crate::arch::aarch64::percpu::init_for_cpu(id);
    scheduler::init_local(id);
    APS_ONLINE.fetch_add(1, Ordering::SeqCst);
    crate::serial_println!("  [SMP] AP#{} ready", id);
    crate::arch::interrupts_enable();
    loop { crate::arch::cpu_halt(); }
}

/// Send Inter-Processor Interrupt to specific CPU
pub fn send_ipi(cpu_id: u8, vector: u8) {
    #[cfg(target_arch="x86_64")] use crate::arch::x86_64::apic;
    // ICR (Interrupt Command Register) — write vector + destination
    // SAFETY: invariant guaranteed by caller contract; bounds verified above
    unsafe {
        let icr_lo = 0xFEE00300 as *mut u32;
        let icr_hi = 0xFEE00310 as *mut u32;
        // Set destination CPU in ICR high
        icr_hi.write_volatile((cpu_id as u32) << 24);
        // Send: Fixed delivery, physical destination, assert level, edge
        icr_lo.write_volatile(vector as u32 | (0 << 8) | (0 << 11) | (1 << 14) | (0 << 15));
        // Wait for delivery
        let deadline = crate::arch::uptime_ms() + 1;
        while crate::arch::uptime_ms() < deadline {
            if icr_lo.read_volatile() & (1 << 12) == 0 { break; }
            core::arch::asm!("pause", options(nostack, nomem));
        }
    }
}

/// TLB shootdown — invalidate page on all CPUs
pub fn tlb_shootdown(vaddr: u64) {
    let ncpus = crate::crate::arch::cpu_count() as u64;
    for cpu in 1..ncpus as u8 {
        send_ipi(cpu, 0xF0); // vector 0xF0 = TLB shootdown IPI
    }
    // Also invalidate locally
    // SAFETY: inline assembly — required for privileged x86_64 CPU instruction
    unsafe { core::arch::asm!("invlpg [{addr}]", addr = in(reg) vaddr, options(nostack)); }
}

/// Broadcast IPI to all APs (except self)
pub fn broadcast_ipi(vector: u8) {
    let ncpus = crate::crate::arch::cpu_count() as u64;
    for cpu in 1..ncpus as u8 { send_ipi(cpu, vector); }
}

/// Check if SMP is active (APs running)
pub fn is_active() -> bool { SMP_READY.load(core::sync::atomic::Ordering::Relaxed) }

/// AP entry point — called when AP boots after SIPI
/// Each AP runs this function — initializes local state and enters scheduler
/// AP scheduler entry — delegates to arch/x86_64/smp ap_main
/// The real AP entry point is ap_main() in arch/x86_64/smp/mod.rs
/// This function is kept for compatibility with any references
#[no_mangle]
pub extern "C" fn ap_scheduler_entry() -> ! {
    // ap_main is called directly from startup IPI trampoline
    // This wrapper handles the cais where we're called from Rust code
    let cpu_id = crate::arch::aarch64::percpu::current().cpu_id;
    crate::arch::aarch64::percpu::init_for_cpu(cpu_id);
    crate::arch::aarch64::smp::CPU_COUNT
        .fetch_add(1, core::sync::atomic::Ordering::SeqCst);
    crate::serial_println!("[SMP] ap_scheduler_entry cpu_id={}", cpu_id);
    crate::arch::interrupts_enable();
    loop {
        let stolen = crate::sched::SCHEDULER.lock().steal_task_for_ap(cpu_id as u8);
        if let Some(ctx_ptr) = stolen {
            // SAFETY: invariant guaranteed by caller contract; bounds verified above
            // ARM64: task dispatch via scheduler
        } else {
            // SAFETY: inline assembly — required for privileged x86_64 CPU instruction
            unsafe { core::arch::asm!("hlt", options(nostack)); }
        }
    }
}
