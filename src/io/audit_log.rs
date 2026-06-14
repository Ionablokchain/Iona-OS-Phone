//! Append-only, hash-chained kernel audit log.
//!
//! Attempts to rewrite earlier entries has treated as tampering. The log is held
//! in memory and mirrored to IONAFS when available.

extern crate alloc;
use alloc::{string::String, vec::Vec};
use spin::{Lazy, Mutex};

#[derive(Clone, Debug)]
pub struct AuditEntry {
    pub seq: u64,
    pub tag: String,
    pub payload: Vec<u8>,
    pub prev_hash: [u8; 32],
    pub entry_hash: [u8; 32],
}

struct State { entries: Vec<AuditEntry>, head: [u8; 32] }
static LOG: Lazy<Mutex<State>> = Lazy::new(|| Mutex::new(State { entries: Vec::new(), head: [0u8; 32] }));

pub fn init() { crate::serial_println!("[AUDIT] append-only log online"); }

pub fn append_event(tag: &str, payload: &[u8]) {
    let mut st = LOG.lock();
    let seq = st.entries.len() as u64 + 1;
    let mut data = Vec::new();
    data.extend_from_slice(&st.head);
    data.extend_from_slice(&seq.to_le_bytes());
    data.extend_from_slice(tag.as_bytes());
    data.extend_from_slice(payload);
    let hash = crate::net::tls::sha256(&data);
    let entry = AuditEntry { seq, tag: tag.into(), payload: payload.to_vec(), prev_hash: st.head, entry_hash: hash };
    st.head = hash;
    st.entries.push(entry.clone());
    if crate::fs::ionafs::exists("/") {
        let _ = crate::fs::ionafs::append("/var/log/iona-audit.chain", alloc::format!("{} {} {:02x}{:02x}
", seq, tag, hash[0], hash[1]).as_bytes());
    }
}

pub fn verify_chain() -> bool {
    let st = LOG.lock();
    let mut prev = [0u8; 32];
    for e in &st.entries {
        let mut data = Vec::new();
        data.extend_from_slice(&prev);
        data.extend_from_slice(&e.seq.to_le_bytes());
        data.extend_from_slice(e.tag.as_bytes());
        data.extend_from_slice(&e.payload);
        if crate::net::tls::sha256(&data) != e.entry_hash { return false; }
        prev = e.entry_hash;
    }
    true
}

pub fn tamper_detected() {
    crate::serial_println!("[AUDIT] tamper detected -> panic path");
    crate::security::kill_switch::trigger("audit log tamper detected");
}


pub fn enforce_chain() -> Result<(), &'static str> {
    if verify_chain() { Ok(()) } else {
        tamper_detected();
        Err("audit chain verification failed")
    }
}

/// Get last N audit log entries as strings.
pub fn recent_entries(n: usize) -> alloc::vec::Vec<alloc::string::String> {
    if let Some(data) = crate::fs::ionafs::read("/var/log/audit.log") {
        let s = core::str::from_utf8(&data).unwrap_or("");
        s.lines().rev().take(n).map(|l| l.to_owned()).collect()
    } else { alloc::vec![] }
}

// ── Syscall audit log ────────────────────────────────────────────────────────

use core::sync::atomic::{AtomicBool, Ordering};
static SYSCALL_AUDIT: AtomicBool = AtomicBool::new(false);

pub fn enable_syscall_audit()  { SYSCALL_AUDIT.store(true,  Ordering::Relaxed); }
pub fn disable_syscall_audit() { SYSCALL_AUDIT.store(false, Ordering::Relaxed); }

pub fn log_syscall(nr: u64, pid: u64, result: i64) {
    if !SYSCALL_AUDIT.load(Ordering::Relaxed) { return; }
    let name = syscall_name(nr);
    append_event("syscall", alloc::format!("nr={} ({}) pid={} ret={}", nr, name, pid, result).as_bytes());
}

fn syscall_name(nr: u64) -> &'static str {
    match nr {
        0=>"read", 1=>"write", 2=>"open", 3=>"close", 9=>"mmap",
        39=>"getpid", 60=>"exit", 62=>"kill", 102=>"getuid",
        1000=>"iona_send", 1001=>"iona_recv", _ => "unknown",
    }
}

pub fn syscall_stats() -> alloc::vec::Vec<(alloc::string::String, u64)> {
    // Count syscalls per type from log
    alloc::vec![] // Would parse log file in production
}
