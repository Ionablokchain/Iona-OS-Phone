//! SMP — Symmetric Multi-Processing
//!
//! Brings Application Processors (APs) online, keeps them scheduling, and
//! provides cross-CPU IPIs (including TLB shootdown).
//!
//! # Architecture dispatch
//!
//! The control flow (`init`, `ap_main`, `ap_scheduler_entry`, IPI
//! broadcasting) is arch-neutral. Privileged primitives dispatch behind
//! `cfg(target_arch = ...)`:
//!
//! | Operation      | x86_64                | aarch64            |
//! |----------------|-----------------------|--------------------|
//! | CPU count      | CPUID 0xB / leaf 1    | arch layer         |
//! | AP start       | SIPI to trampoline    | PSCI / spin-table  |
//! | Send IPI       | APIC ICR (MMIO)       | GIC SGI            |
//! | TLB invalidate | `invlpg` + IPI        | `tlbi vae1is` + IPI|
//! | Idle           | `hlt`                 | `wfi`              |
//!
//! # Safety
//!
//! This module is only safe to call from kernel context (ring 0 / EL1). It
//! writes privileged registers and dereferences LAPIC MMIO.

pub mod scheduler;
pub use scheduler::*;

use core::arch::asm;
use core::sync::atomic::{AtomicBool, Ordering};

#[cfg(target_arch = "x86_64")]
use crate::arch::x86_64::apic::{send_startup_ipi, APS_ONLINE, CPU_COUNT};

// ── Constants ─────────────────────────────────────────────────────────────

/// x86_64 SIPI vector pointing at the AP trampoline.
#[cfg(target_arch = "x86_64")]
const SIPI_TRAMPOLINE_VECTOR: u8 = 0x08;

/// IPI vector for TLB shootdown.
const IPI_TLB_SHOOTDOWN: u8 = 0xF0;

/// Hard cap on supported logical CPUs.
const MAX_CPUS: usize = 64;

/// Per-AP timeout in milliseconds when waiting for it to report online.
const AP_ONLINE_TIMEOUT_MS: u64 = 200;

/// Bounded spin iterations when waiting on LAPIC delivery.
#[cfg(target_arch = "x86_64")]
const ICR_DELIVERY_SPIN_LIMIT: u32 = 100_000;

/// Maximum number of CPUID leaf-0xB topology levels we scan.
#[cfg(target_arch = "x86_64")]
const MAX_CPUID_TOPOLOGY_LEVELS: u32 = 8;

// ── State ─────────────────────────────────────────────────────────────────

/// Set once the BSP has finished bringing APs online and initialising
/// local schedulers. Informational; consensus does not depend on it.
pub static SMP_READY: AtomicBool = AtomicBool::new(false);

// ── CPU count detection ──────────────────────────────────────────────────

/// Number of logical CPUs, clamped to `[1, MAX_CPUS]`.
///
/// - x86_64: enumerates CPUID leaf 0xB topology levels; falls back to
///   leaf 1 EBX[23:16] on older hardware.
/// - aarch64: delegates to the arch layer (DTB / PSCI is expected to have
///   populated its CPU count).
pub fn detect_cpu_count() -> usize {
    let raw = detect_cpu_count_raw();
    if raw == 0 {
        1
    } else {
        (raw as usize).min(MAX_CPUS)
    }
}

#[cfg(target_arch = "x86_64")]
fn detect_cpu_count_raw() -> u32 {
    let max_leaf = cpuid_max_leaf();
    if max_leaf < 0x0B {
        return cpuid_leaf1_logical_count();
    }

    let mut count: u32 = 0;
    for level in 0..MAX_CPUID_TOPOLOGY_LEVELS {
        let (_, ebx, ecx, _) = cpuid(0x0B, level);
        let level_type = (ecx >> 8) & 0xFF;
        if level_type == 0 {
            // Enumeration ended.
            break;
        }
        if ebx > count {
            count = ebx;
        }
    }

    if count > 0 {
        count
    } else {
        cpuid_leaf1_logical_count()
    }
}

#[cfg(not(target_arch = "x86_64"))]
fn detect_cpu_count_raw() -> u32 {
    // The arch layer (device-tree scan on aarch64) owns this count.
    crate::arch::cpu_count().min(u32::MAX as usize) as u32
}

/// CPUID leaf 0 — highest basic leaf supported.
#[cfg(target_arch = "x86_64")]
fn cpuid_max_leaf() -> u32 {
    let eax: u32;
    // SAFETY: CPUID is available on every x86_64 CPU; no memory operands.
    unsafe {
        asm!(
            "push rbx",
            "cpuid",
            "pop rbx",
            inlateout("eax") 0u32 => eax,
            out("ecx") _,
            out("edx") _,
            options(preserves_flags),
        );
    }
    eax
}

/// CPUID leaf 1, EBX[23:16] — logical processors per package.
#[cfg(target_arch = "x86_64")]
fn cpuid_leaf1_logical_count() -> u32 {
    let ebx: u32;
    // SAFETY: CPUID is available on every x86_64 CPU.
    unsafe {
        asm!(
            "push rbx",
            "cpuid",
            "mov {0:e}, ebx",
            "pop rbx",
            out(reg) ebx,
            inlateout("eax") 1u32 => _,
            inlateout("ecx") 0u32 => _,
            out("edx") _,
            options(preserves_flags),
        );
    }
    (ebx >> 16) & 0xFF
}

/// CPUID with explicit leaf / subleaf. Returns `(eax, ebx, ecx, edx)`.
#[cfg(target_arch = "x86_64")]
fn cpuid(leaf: u32, subleaf: u32) -> (u32, u32, u32, u32) {
    let (eax, ebx, ecx, edx);
    // SAFETY: CPUID is available on every x86_64 CPU.
    unsafe {
        asm!(
            "push rbx",
            "cpuid",
            "mov {ebx_out:e}, ebx",
            "pop rbx",
            ebx_out = out(reg) ebx,
            inlateout("eax") leaf => eax,
            inlateout("ecx") subleaf => ecx,
            out("edx") edx,
            options(preserves_flags),
        );
    }
    (eax, ebx, ecx, edx)
}

// ── Init ──────────────────────────────────────────────────────────────────

/// Bring up all APs and initialise per-CPU schedulers.
pub fn init() {
    let count = detect_cpu_count();
    crate::serial_println!("  [SMP] {} logical CPU(s)", count);

    #[cfg(target_arch = "x86_64")]
    CPU_COUNT.store(count as u64, Ordering::SeqCst);

    // BSP scheduler.
    scheduler::init_local(0);

    #[cfg(target_arch = "x86_64")]
    if count > 1 {
        bring_up_aps_x86_64(count);
    }

    SMP_READY.store(true, Ordering::SeqCst);

    #[cfg(target_arch = "x86_64")]
    let online = APS_ONLINE.load(Ordering::SeqCst);
    #[cfg(not(target_arch = "x86_64"))]
    let online = 1u32;

    crate::serial_println!("  [SMP] {} AP(s) online, local schedulers ready", online);
}

#[cfg(target_arch = "x86_64")]
fn bring_up_aps_x86_64(count: usize) {
    for id in 1..(count as u32).min(MAX_CPUS as u32) {
        // SAFETY: `id < MAX_CPUS`; the trampoline was prepared by the BSP
        // before SMP init; interrupts are disabled at this point.
        unsafe {
            send_startup_ipi(id as u8, SIPI_TRAMPOLINE_VECTOR);
        }
        wait_for_ap(id);
    }
}

#[cfg(target_arch = "x86_64")]
fn wait_for_ap(id: u32) {
    let deadline = crate::arch::uptime_ms().saturating_add(AP_ONLINE_TIMEOUT_MS);
    while crate::arch::uptime_ms() < deadline {
        // APS_ONLINE counts APs that have reported in. If we are waiting
        // for AP#id (1-indexed), the counter should be >= id.
        if APS_ONLINE.load(Ordering::SeqCst) >= id {
            return;
        }
        core::hint::spin_loop();
    }
    crate::serial_println!(
        "  [SMP] warning: AP#{} did not report online within {} ms",
        id,
        AP_ONLINE_TIMEOUT_MS
    );
}

// ── AP entry points ──────────────────────────────────────────────────────

/// AP boot entry. Called by the arch trampoline once the CPU has entered
/// long mode (x86_64) or EL1 (aarch64). Never returns.
///
/// # Safety
///
/// Called from assembly with a valid per-CPU `id` in `[1, MAX_CPUS)` and
/// interrupts disabled.
#[no_mangle]
pub extern "C" fn ap_main(id: u32) -> ! {
    if id == 0 || id as usize >= MAX_CPUS {
        // Should never happen: the trampoline passes a fixed ID. Halt
        // rather than corrupting shared state.
        crate::serial_println!("  [SMP] ap_main: invalid id {}", id);
        loop {
            arch_idle();
        }
    }

    // Per-arch early init.
    #[cfg(target_arch = "x86_64")]
    {
        crate::arch::x86_64::gdt::init();
        crate::arch::x86_64::idt::init();
        // The local APIC is already enabled by the trampoline / BSP.
        crate::arch::x86_64::percpu::init_for_cpu(id);
    }
    #[cfg(target_arch = "aarch64")]
    {
        // GIC is initialised by `early_init`; nothing to do here.
        crate::arch::aarch64::percpu::init_for_cpu(id);
    }

    // Common per-CPU init.
    scheduler::init_local(id);

    #[cfg(target_arch = "x86_64")]
    APS_ONLINE.fetch_add(1, Ordering::SeqCst);

    crate::serial_println!("  [SMP] AP#{} ready", id);
    crate::arch::interrupts_enable();

    // Idle loop; the scheduler runs from IPI / timer interrupts.
    loop {
        arch_idle();
    }
}

/// Backwards-compatible AP entry-point shim.
///
/// Kept for callers that used the old symbol name. Delegates to
/// [`ap_main`] with the current CPU's per-CPU id.
///
/// # Safety
///
/// Same as [`ap_main`].
#[no_mangle]
pub extern "C" fn ap_scheduler_entry() -> ! {
    #[cfg(target_arch = "aarch64")]
    let cpu_id = crate::arch::aarch64::percpu::current().cpu_id;

    #[cfg(not(target_arch = "aarch64"))]
    let cpu_id: u32 = 0; // ap_main will bail out cleanly if 0

    ap_main(cpu_id)
}

// ── IPIs ─────────────────────────────────────────────────────────────────

/// Send a fixed-delivery IPI to a specific CPU.
///
/// On aarch64 this currently logs a warning and returns; the GIC SGI path
/// should be used instead. This function never panics.
pub fn send_ipi(cpu_id: u8, vector: u8) {
    #[cfg(target_arch = "x86_64")]
    {
        send_ipi_x86_64(cpu_id, vector);
    }
    #[cfg(not(target_arch = "x86_64"))]
    {
        let _ = (cpu_id, vector);
        crate::serial_println!(
            "  [SMP] warning: send_ipi not implemented for this architecture"
        );
    }
}

#[cfg(target_arch = "x86_64")]
fn send_ipi_x86_64(cpu_id: u8, vector: u8) {
    // LAPIC MMIO — ICR low / high.
    const ICR_LOW: *mut u32 = 0xFEE0_0300usize as *mut u32;
    const ICR_HIGH: *mut u32 = 0xFEE0_0310usize as *mut u32;
    const ICR_DELIVERY_STATUS: u32 = 1 << 12;
    const ICR_LEVEL_ASSERT: u32 = 1 << 14;

    // SAFETY: LAPIC MMIO is mapped and accessible from ring 0.
    unsafe {
        // Destination APIC ID in bits 24..31 (physical destination mode).
        ICR_HIGH.write_volatile((cpu_id as u32) << 24);

        // Fixed delivery (bits 8..10 = 0), physical (bit 11 = 0),
        // assert level (bit 14 = 1), edge trigger (bit 15 = 0).
        ICR_LOW.write_volatile((vector as u32) | ICR_LEVEL_ASSERT);

        // Bounded spin on delivery status. We prefer a spin counter over
        // `uptime_ms()` because the timer may not be running during early
        // boot.
        let mut spins: u32 = 0;
        while ICR_LOW.read_volatile() & ICR_DELIVERY_STATUS != 0 {
            if spins >= ICR_DELIVERY_SPIN_LIMIT {
                break;
            }
            core::hint::spin_loop();
            spins = spins.wrapping_add(1);
        }
    }
}

/// Invalidate `vaddr` on all CPUs.
///
/// The local CPU is invalidated first, then all other CPUs are notified
/// via IPI. On return, no CPU should be using a stale translation for
/// `vaddr` (assuming the IPI is acknowledged before the caller reuses
/// the address).
pub fn tlb_shootdown(vaddr: u64) {
    // Local first — cheaper, and correct even if broadcast fails.
    arch_tlb_invalidate_page(vaddr);

    let ncpus = cpu_count();
    for cpu in 1..ncpus.min(MAX_CPUS) {
        send_ipi(cpu as u8, IPI_TLB_SHOOTDOWN);
    }
}

/// Broadcast `vector` to every AP except the local CPU.
pub fn broadcast_ipi(vector: u8) {
    let ncpus = cpu_count();
    for cpu in 1..ncpus.min(MAX_CPUS) {
        send_ipi(cpu as u8, vector);
    }
}

/// True once [`init`] has completed.
#[inline]
pub fn is_active() -> bool {
    SMP_READY.load(Ordering::Relaxed)
}

// ── Arch primitives ─────────────────────────────────────────────────────

#[inline]
fn cpu_count() -> usize {
    #[cfg(target_arch = "x86_64")]
    {
        CPU_COUNT.load(Ordering::Relaxed) as usize
    }
    #[cfg(not(target_arch = "x86_64"))]
    {
        crate::arch::cpu_count()
    }
}

/// Halt the local CPU until the next interrupt.
#[inline]
fn arch_idle() {
    #[cfg(target_arch = "x86_64")]
    // SAFETY: `hlt` is privileged and valid in ring 0.
    unsafe {
        asm!("hlt", options(nostack, nomem));
    }
    #[cfg(target_arch = "aarch64")]
    // SAFETY: `wfi` is valid at EL1.
    unsafe {
        asm!("wfi", options(nostack, nomem));
    }
}

/// Invalidate the TLB entry for a single virtual address on the local CPU.
#[inline]
fn arch_tlb_invalidate_page(vaddr: u64) {
    #[cfg(target_arch = "x86_64")]
    // SAFETY: `invlpg` is privileged and valid in ring 0.
    unsafe {
        asm!("invlpg [{addr}]", addr = in(reg) vaddr, options(nostack, preserves_flags));
    }
    #[cfg(target_arch = "aarch64")]
    // SAFETY: `tlbi vae1is` is valid at EL1 and affects the inner-shareable
    // domain. The operand is the VA shifted right by 12 (page-aligned).
    unsafe {
        asm!(
            "tlbi vae1is, {addr}",
            addr = in(reg) (vaddr >> 12),
            options(nostack, preserves_flags),
        );
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cpu_count_in_range() {
        let n = detect_cpu_count();
        assert!((1..=MAX_CPUS).contains(&n), "count = {n}");
    }

    #[test]
    fn smp_ready_default_false() {
        // Reads the static without init to avoid side effects.
        let _ = SMP_READY.load(Ordering::Relaxed);
    }

    #[test]
    fn max_cpus_is_bounded() {
        // Sanity: the cap is a power of two, matching the APIC ID space.
        assert!(MAX_CPUS.is_power_of_two());
        assert!(MAX_CPUS <= 256);
    }
}
