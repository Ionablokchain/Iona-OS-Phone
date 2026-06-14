
//! AI watchdog and task-level monitors.

pub fn tick_ai_watchdog() {
    let age = crate::ai::heartbeat_age_ms();
    if age > 5_000 {
        if let Some(pid) = crate::ai::active_task_id() {
            crate::io::audit_log::append_event(
                "ai.watchdog.timeout",
                alloc::format!("pid={} age_ms={}", pid, age).as_bytes()
            );
            let _ = crate::process::restart_noncritical_ui(pid);
        }
    }
}
