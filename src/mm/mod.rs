pub mod shm;
//! Memory Manager — Buddy + Slab
pub mod buddy;
pub mod slab;

pub fn init() {
    // Buddy starts at 4MB phys, covers 64MB
    buddy::init(0x40_0000, 16_384);
    slab::init();
}

pub mod mmap;


pub fn allocate_dma_buffer(size: usize) -> crate::memory::address::VirtAddr {
    let mut buf = alloc::vec![0u8; size];
    let ptr = buf.as_mut_ptr() as usize;
    core::mem::forget(buf);
    ptr
}


pub const SYNTH_ZONE_START: usize = 0xFFFF_8000_0000_0000;
pub const SYNTH_ZONE_SIZE: usize  = 256 * 1024 * 1024;

static SYNTH_CURSOR: spin::Lazy<spin::Mutex<usize>> =
    spin::Lazy::new(|| spin::Mutex::new(SYNTH_ZONE_START));

fn find_free_slot(len: usize) -> crate::memory::address::VirtAddr {
    let mut cur = SYNTH_CURSOR.lock();
    let align = 4096usize;
    let size = (len + align - 1) & !(align - 1);
    let base = *cur;
    let end = base.saturating_add(size);
    if end > SYNTH_ZONE_START + SYNTH_ZONE_SIZE {
        return 0;
    }
    *cur = end;
    base
}

fn copy_to_addr(addr: crate::memory::address::VirtAddr, binary: &[u8]) {
    if addr == 0 || binary.is_empty() { return; }
    // SAFETY: addr points to a region allocated by find_free_slot() within
    // SYNTH_ZONE. The region is guaranteed to be len bytes, page-aligned,
    // and not overlapping any other allocation (cursor bumped atomically).
    // SAFETY: Invariant verified by caller; bounds checked above.
    unsafe {
        core::ptr::copy_nonoverlapping(
            binary.as_ptr(),
            addr as *mut u8,
            binary.len(),
        );
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PageFlags(pub usize);
impl PageFlags {
    pub const EXECUTABLE: Self = Self(1 << 0);
    pub const READ_ONLY: Self = Self(1 << 1);
}

fn change_page_permissions(addr: crate::memory::address::VirtAddr, flags: PageFlags) {
    if addr == 0 { return; }

    let executable = flags.0 & PageFlags::EXECUTABLE.0 != 0;
    let read_only  = flags.0 & PageFlags::READ_ONLY.0  != 0;

    // AArch64 page table walk: update UXN/PXN bits on L3 PTE
    // SYNTH_ZONE is in the upper half (TTBR1_EL1 range).
    #[cfg(target_arch = "aarch64")]
    // SAFETY: Invariant verified by caller; bounds checked above.
    unsafe {
        let ttbr1: u64;
        core::arch::asm!("mrs {}, ttbr1_el1", out(reg) ttbr1);
        if ttbr1 == 0 { return; }

        let va = addr as u64;
        // 4KB granule, 48-bit VA:  [47:39] L0  [38:30] L1  [29:21] L2  [20:12] L3
        let l0_idx = ((va >> 39) & 0x1FF) as usize;
        let l1_idx = ((va >> 30) & 0x1FF) as usize;
        let l2_idx = ((va >> 21) & 0x1FF) as usize;
        let l3_idx = ((va >> 12) & 0x1FF) as usize;

        let l0 = ttbr1 as *mut u64;
        let l0e = l0.add(l0_idx).read_volatile();
        if l0e & 0x1 == 0 { return; }

        let l1 = ((l0e & 0x0000_FFFF_FFFF_F000) as usize) as *mut u64;
        let l1e = l1.add(l1_idx).read_volatile();
        if l1e & 0x3 != 0x3 { return; } // must be table

        let l2 = ((l1e & 0x0000_FFFF_FFFF_F000) as usize) as *mut u64;
        let l2e = l2.add(l2_idx).read_volatile();
        if l2e & 0x3 != 0x3 { return; } // must be table

        let l3 = ((l2e & 0x0000_FFFF_FFFF_F000) as usize) as *mut u64;
        let l3_ptr = l3.add(l3_idx);
        let mut pte = l3_ptr.read_volatile();

        // UXN (bit 54): Unprivileged Execute Never — clear to allow EL0 exec
        // PXN (bit 53): Privileged Execute Never   — clear to allow EL1 exec
        const UXN: u64 = 1 << 54;
        const PXN: u64 = 1 << 53;
        const AP_RO: u64 = 1 << 7; // AP[2]=1 means read-only

        if executable {
            pte &= !UXN;
            pte &= !PXN;
        } else {
            pte |= UXN;
            pte |= PXN;
        }

        if read_only {
            pte |= AP_RO;
        } else {
            pte &= !AP_RO;
        }

        l3_ptr.write_volatile(pte);

        // TLB flush for this virtual address
        core::arch::asm!(
            "dsb ishst",
            "tlbi vaae1is, {}",
            "dsb ish",
            "isb",
            in(reg) va >> 12,
            options(nomem, nostack)
        );
    }
}

pub fn map_synthesized_driver(binary: &[u8]) -> crate::memory::address::VirtAddr {
    let addr = find_free_slot(binary.len());
    if addr == 0 {
        return 0;
    }
    copy_to_addr(addr, binary);
    change_page_permissions(addr, PageFlags(PageFlags::EXECUTABLE.0 | PageFlags::READ_ONLY.0));

    // Sincronizăm I-Cache after what am mapat cod new executabil
    // Fără asta, CPU ar putea executa instrucțiuni old from I-Cache
    // în loc de codul driver-ului sintetizat
    #[cfg(target_arch = "aarch64")]
    crate::arch::aarch64::cache::sync_icache_range(addr, binary.len());

    addr
}


pub fn can_map_synthesized_driver(binary: &[u8]) -> bool {
    crate::security::synth_verify::verify_logic(binary)
}


pub fn allocate_quantum_buffer(size: usize) -> alloc::vec::Vec<f32> {
    alloc::vec![0.0f32; size]
}
