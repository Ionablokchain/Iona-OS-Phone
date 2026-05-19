//! ACPI — Advanced Configuration and Power Interface
//! Parsam RSDP → RSDT/XSDT → MADT (for APIC info)
//! Minimal: detectam LAPIC si I/O APIC addresses for Faza viitoare


pub mod power;

/// Root System Description Pointer
#[repr(C, packed)]
pub struct Rsdp {
    pub signature:  [u8; 8],   // "RSD PTR "
    pub checksum:   u8,
    pub oem_id:     [u8; 6],
    pub revision:   u8,
    pub rsdt_addr:  u32,
    // ACPI 2.0+:
    pub length:     u32,
    pub xsdt_addr:  u64,
    pub ext_checksum: u8,
    _reserved:      [u8; 3],
}

/// Cauta RSDP in zona Extended BIOS Data Area si ROM (0xE0000-0xFFFFF)
/// All physical memory is mapped at PHYS_OFFSET by the bootloader.
use crate::memory::mapper::PHYS_OFFSET;

pub fn find_rsdp() -> Option<&'static Rsdp> {
    let start = PHYS_OFFSET + 0xE0000;
    let end   = PHYS_OFFSET + 0xFFFFF;
    let mut ptr = start;
    while ptr < end {
        // SAFETY: slice from raw ptr — length validated by hardware spec or allocator
        let sig = unsafe { core::slice::from_raw_parts(ptr as *const u8, 8) };
        if sig == b"RSD PTR " {
            // SAFETY: invariant guaranteed by caller contract; bounds verified above
            let rsdp = unsafe { &*(ptr as *const Rsdp) };
            // Check checksum
            // SAFETY: slice from raw ptr — length validated by hardware spec or allocator
            let bytes = unsafe { core::slice::from_raw_parts(ptr as *const u8, 20) };
            let sum: u8 = bytes.iter().fold(0u8, |acc, &b| acc.wrapping_add(b));
            if sum == 0 {
                crate::serial_println!("  [ACPI] RSDP found at phys 0x{:x} rev={}", ptr - PHYS_OFFSET, rsdp.revision);
                return Some(rsdp);
            }
        }
        ptr += 16; // RSDP e aliniat to 16 bytes
    }
    crate::serial_println!("  [ACPI] RSDP not found");
    None
}

pub fn init() {
    if let Some(rsdp) = find_rsdp() {
        crate::serial_println!("  [ACPI] OEM: {}", core::str::from_utf8(&rsdp.oem_id).unwrap_or("?"));
    }
}

/// ACPI handler — minimal RSDP-based implementation for IONA OS
pub struct AcpiHandler;

/// acpi_init() alias — called from security layer
pub fn acpi_init() { init(); }
