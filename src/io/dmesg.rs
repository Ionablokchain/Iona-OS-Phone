//! Kernel dmesg ring buffer — last 512 log lines.
extern crate alloc;
use alloc::{string::String, vec::Vec};
use spin::{Lazy, Mutex};

const RING_SIZE: usize = 512;

static RING: Lazy<Mutex<Vec<String>>> = Lazy::new(|| Mutex::new(Vec::new()));

/// Append a line to the ring buffer.
pub fn append(line: &str) {
    let mut r = RING.lock();
    if r.len() >= RING_SIZE { r.remove(0); }
    r.push(line.to_owned());
}

/// Get all lines (oldest first).
pub fn get_ring_buffer() -> Vec<String> { RING.lock().clone() }

/// Get last N lines.
pub fn get_last(n: usize) -> Vec<String> {
    let r = RING.lock();
    r.iter().rev().take(n).cloned().collect()
}
