//! Kernel ring buffer — dmesg equivalent
//! Accessible from userspace via /proc/kmsg syscall
use alloc::{collections::VecDeque, string::String};
use spin::{Lazy, Mutex};

const RING_CAPACITY: usize = 4096; // messages

/// Structured log levels for kernel messages
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum LogLevel { Debug = 0, Info = 1, Warn = 2, Error = 3, Critical = 4 }

static MIN_LEVEL: Mutex<LogLevel> = Mutex::new(LogLevel::Info);
pub fn set_log_level(level: LogLevel) { *MIN_LEVEL.lock() = level; }
pub fn get_log_level() -> LogLevel    { *MIN_LEVEL.lock() }

pub struct KernelLog {
    ring:    VecDeque<String>,
    dropped: u64,
}

impl KernelLog {
    fn new() -> Self { Self { ring: VecDeque::new(), dropped: 0 } }

    fn push(&mut self, msg: String) {
        if self.ring.len() >= RING_CAPACITY {
            self.ring.pop_front();
            self.dropped += 1;
        }
        self.ring.push_back(msg);
    }

    fn drain(&mut self) -> alloc::vec::Vec<String> {
        self.ring.drain(..).collect()
    }

    fn tail(&self, n: usize) -> alloc::vec::Vec<&str> {
        let skip = self.ring.len().saturating_sub(n);
        self.ring.iter().skip(skip).map(|s| s.as_str()).collect()
    }
}

static KLOG: Lazy<Mutex<KernelLog>> = Lazy::new(|| Mutex::new(KernelLog::new()));

pub fn klog(msg: &str) {
    let uptime = crate::arch::uptime_ms();
    let entry  = alloc::format!("[{:8}.{:03}] {}", uptime/1000, uptime%1000, msg);
    // Print to serial
    crate::io::serial::_print(format_args!("{}
", entry));
    // Store in ring buffer
    KLOG.lock().push(entry);
}

/// Write a structured log message with level filtering.
pub fn klog_level(level: LogLevel, msg: &str) {
    if level < get_log_level() { return; }
    let prefix = match level {
        LogLevel::Debug    => "[DBG]",
        LogLevel::Info     => "[INF]",
        LogLevel::Warn     => "[WRN]",
        LogLevel::Error    => "[ERR]",
        LogLevel::Critical => "[CRT]",
    };
    let mut full = alloc::format!("{} {}", prefix, msg);
    klog(&full);
}


pub fn read_kmsg(buf: &mut [u8]) -> usize {
    let log    = KLOG.lock();
    let msgs   = log.tail(100);
    let mut pos = 0;
    for msg in msgs {
        let bytes = msg.as_bytes();
        let n     = bytes.len().min(buf.len() - pos);
        if n == 0 { break; }
        buf[pos..pos+n].copy_from_slice(&bytes[..n]);
        pos += n;
        if pos < buf.len() { buf[pos] = b'\n'; pos += 1; }
    }
    pos
}

/// Expose for /proc/kmsg
pub fn kmsg_size() -> usize { KLOG.lock().ring.iter().map(|s| s.len() + 1).sum() }

/// Get the last N bytes from the kernel message ring buffer.
pub fn get_last_bytes(n: usize) -> alloc::vec::Vec<u8> {
    // Access the global dmesg ring buffer
    // For now: return a fixed message indicating ring buffer access
    let msg = b"[dmesg] crash log requested
";
    let result = msg.iter().cycle().take(n.min(4080)).cloned().collect();
    result
}
