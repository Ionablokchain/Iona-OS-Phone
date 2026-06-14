pub mod klog;
//! I/O subsystem
pub mod serial;
pub mod framebuffer;
pub mod font;
pub mod console;
pub mod audit_log;

pub mod dmesg;

pub mod png_decode;

pub mod mp3_decode;

pub mod uart;

pub mod dev_random;

// ── Dynamic debug (pr_debug toggles) ────────────────────────────────────────

use alloc::collections::BTreeMap;
static DEBUG_FLAGS: spin::Lazy<spin::Mutex<BTreeMap<alloc::string::String, bool>>> =
    spin::Lazy::new(|| spin::Mutex::new(BTreeMap::new()));

pub fn debug_toggle(module: &str, enable: bool) {
    DEBUG_FLAGS.lock().insert(module.into(), enable);
    crate::serial_println!("[DYNDBG] {}: {}", module, if enable {"ON"} else {"OFF"});
}

pub fn is_debug(module: &str) -> bool {
    *DEBUG_FLAGS.lock().get(module).unwrap_or(&false)
}

/// pr_debug equivalent: print only if module debug is enabled.
pub fn pr_debug(module: &str, msg: &str) {
    if is_debug(module) { crate::serial_println!("[{}] {}", module, msg); }
}

pub fn list_debug_modules() -> alloc::vec::Vec<(alloc::string::String, bool)> {
    DEBUG_FLAGS.lock().iter().map(|(k,&v)| (k.clone(), v)).collect()
}
