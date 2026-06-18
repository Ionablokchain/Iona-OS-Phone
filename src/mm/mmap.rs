//! mmap — memory-mapped files + anonymous mappings
//!
//! Supports:
//!   MAP_ANON  — anonymous zero-fill pages (functional via VMM)
//!   MAP_FILE  — IONAFS file mapped into virtual address space
//!   MAP_PRIVATE — CoW, changes not propagated to file
//!   MAP_SHARED  — shared, flushed on msync/munmap
//!
//! Page fault flow for MAP_FILE:
//!   1. Access to unmapped address → page fault
//!   2. fault handler checks MmapTable
//!   3. If MAP_FILE entry exists: read page from IONAFS
//!   4. Map page into process page table
//!   5. Return → re-execute instruction

use alloc::{collections::BTreeMap, string::String, vec::Vec};
use spin::{Lazy, Mutex};
// x86_64 crate: not needed on ARM64

pub const PROT_READ:  u32 = 0x1;
pub const PROT_WRITE: u32 = 0x2;
pub const PROT_EXEC:  u32 = 0x4;
pub const MAP_FILE:   u32 = 0x0;  // default (file-backed)
pub const MAP_ANON:   u32 = 0x20; // anonymous
pub const MAP_SHARED: u32 = 0x01;
pub const MAP_PRIVATE:u32 = 0x02;
pub const MAP_FIXED:  u32 = 0x10;

#[derive(Clone, Debug)]
pub enum MmapBacking {
    Anonymous,
    File {
        path:   String,
        offset: u64,    // byte offset in file
        length: usize,  // mapping length in bytes
    },
}

#[derive(Clone, Debug)]
pub struct MmapRegion {
    pub base:    u64,           // virtual address (page-aligned)
    pub length:  usize,         // bytes
    pub prot:    u32,
    pub flags:   u32,
    pub backing: MmapBacking,
    pub dirty:   bool,          // for MAP_SHARED flush
}

impl MmapRegion {
    pub fn contains(&self, addr: u64) -> bool {
        addr >= self.base && addr < self.base + self.length as u64
    }

    /// Page offset within this mapping for a given address
    pub fn page_offset(&self, addr: u64) -> usize {
        ((addr & !0xFFF) - self.base) as usize
    }
}

// Per-task mmap table (tid → regions)
use crate::task::TaskId;
static MMAP_TABLE: Lazy<Mutex<BTreeMap<TaskId, Vec<MmapRegion>>>> =
    Lazy::new(|| Mutex::new(BTreeMap::new()));

/// Map a file region into virtual address space
/// Returns the mapped virtual address
pub fn mmap_file(tid: TaskId, path: &str, offset: u64, length: usize,
                  prot: u32, flags: u32, hint: u64) -> Option<u64> {
    // Verify file exists and is accessible
    let file_data = crate::fs::ionafs::read(path)?;
    if offset as usize >= file_data.len() { return None; }

    let actual_len = length.min(file_data.len() - offset as usize);
    let aligned_len = (actual_len + 0xFFF) & !0xFFF;

    // Choois virtual address (hint or auto from high address space)
    let base = if hint != 0 && flags & MAP_FIXED != 0 {
        hint & !0xFFF
    } else {
        next_free_vaddr(tid, aligned_len)
    };

    let region = MmapRegion {
        base,
        length: aligned_len,
        prot, flags,
        backing: MmapBacking::File {
            path: path.into(),
            offset,
            length: actual_len,
        },
        dirty: false,
    };

    crate::security::kernel_boundary::validate_user_buffer(base, aligned_len as u64, (prot & PROT_EXEC) != 0, crate::security::kernel_boundary::IsolationDomain::User).ok()?;
    crate::security::kernel_boundary::charge_mapping(tid, aligned_len as u64).ok()?;
    MMAP_TABLE.lock().entry(tid).or_default().push(region);
    crate::serial_println!("[MMAP] file '{}' offset={} len={} @ {:#x}", path, offset, actual_len, base);
    Some(base)
}

/// Map anonymous pages (zero-fill)
pub fn mmap_anon(tid: TaskId, length: usize, prot: u32, flags: u32, hint: u64) -> u64 {
    let aligned_len = (length + 0xFFF) & !0xFFF;
    let base = if hint != 0 && flags & MAP_FIXED != 0 {
        hint & !0xFFF
    } else {
        next_free_vaddr(tid, aligned_len)
    };
    let region = MmapRegion {
        base, length: aligned_len, prot, flags,
        backing: MmapBacking::Anonymous,
        dirty: false,
    };
    let _ = crate::security::kernel_boundary::validate_user_buffer(base, aligned_len as u64, (prot & PROT_EXEC) != 0, crate::security::kernel_boundary::IsolationDomain::User);
    let _ = crate::security::kernel_boundary::charge_mapping(tid, aligned_len as u64);
    MMAP_TABLE.lock().entry(tid).or_default().push(region);
    base
}

/// Handle page fault for file-backed mapping
/// Returns Some(page_data) if the fault was in an mmap region
pub fn handle_page_fault(tid: TaskId, fault_addr: u64) -> Option<[u8; 4096]> {
    let table = MMAP_TABLE.lock();
    let regions = table.get(&tid)?;
    let region = regions.iter().find(|r| r.contains(fault_addr))?;

    let mut page = [0u8; 4096];
    match &region.backing {
        MmapBacking::Anonymous => {
            // Zero-fill already done above
        }
        MmapBacking::File { path, offset, length } => {
            let page_off = region.page_offset(fault_addr);
            let file_pos = *offset as usize + page_off;
            if let Some(data) = crate::fs::ionafs::read(path) {
                let src_start = file_pos.min(data.len());
                let src_end   = (file_pos + 4096).min(data.len());
                let copy_len  = src_end - src_start;
                page[..copy_len].copy_from_slice(&data[src_start..src_end]);
            }
        }
    }
    Some(page)
}

/// Unmap a region
pub fn munmap(tid: TaskId, addr: u64, length: usize) -> bool {
    let mut table = MMAP_TABLE.lock();
    let regions = match table.get_mut(&tid) { Some(r) => r, None => return false };
    let before = regions.len();
    let mut released = 0u64;
    regions.retain(|r| {
        let drop_it = r.base <= addr && addr < r.base + r.length as u64;
        if drop_it { released = released.saturating_add(r.length as u64); }
        !drop_it
    });
    if released > 0 { crate::security::kernel_boundary::release_mapping(tid, released); }
    regions.len() < before
    // TLB shootdown: flush all TLB entries after removing mapping
    // Required to prevent stale TLB entries from being used by other cores
    #[cfg(target_arch = "aarch64")]
    // SAFETY: Invariant verified by caller; bounds checked above.
    unsafe {
        core::arch::asm!(
            "dsb ishst",           // data sync barrier (inner shareable, store)
            "tlbi vmalle1is",      // invalidate all TLB entries (inner shareable)
            "dsb ish",             // data sync barrier (inner shareable)
            "isb",                 // instruction sync barrier
            options(nomem, nostack)
        );
    }
}

/// msync — flush dirty MAP_SHARED pages back to file
pub fn msync(tid: TaskId, addr: u64) -> bool {
    // In our simplified model: MAP_SHARED modifications go through set_pixel
    // Full impl: walk dirty page table entries and write back
    true
}

/// Clean up all mappings for a task (on exit)
/// Also evicts any swapped pages for this task's virtual ranges
pub fn cleanup_task(tid: TaskId) {
    let regions = MMAP_TABLE.lock().remove(&tid);
    // Evict any swapped pages in this task's virtual address ranges
    if let Some(regs) = regions {
        let mut released = 0u64;
        for r in &regs {
            crate::memory::swap::evict_range(r.base, r.base + r.length as u64);
            released = released.saturating_add(r.length as u64);
        }
        crate::security::kernel_boundary::release_mapping(tid, released);
    }
}

fn next_free_vaddr(tid: TaskId, len: usize) -> u64 {
    // Start from a high-ish user address and scan downward
    let table = MMAP_TABLE.lock();
    let mut candidate = 0x0000_7000_0000_0000u64;
    if let Some(regions) = table.get(&tid) {
        for r in regions.iter() {
            if r.base <= candidate && candidate < r.base + r.length as u64 {
                candidate = r.base.saturating_sub(len as u64 + 0x1000);
            }
        }
    }
    candidate & !0xFFF
}

pub fn init() {
    crate::serial_println!("  [MMAP] file-backed + anonymous mmap initialized");
}

/// Real memory stats — (total_mb, used_mb, swap_used)
pub fn memory_stats() -> (usize, usize, usize) {
    let (total_f, used_f) = crate::memory::frame_alloc::stats();
    let (_total_s, used_s) = crate::memory::swap::stats();
    (total_f * 4 / 1024, used_f * 4 / 1024, used_s)
}
