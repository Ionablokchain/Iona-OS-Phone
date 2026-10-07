//! AI watchdog and task-level monitors.
//!
//! The watchdog runs on the kernel tick and, when an AI task stops sending
//! heartbeats, asks the process layer to restart it. A naive
//! `if age > 5 s { restart() }` loop is unsafe on a real system:
//!
//! - **Tick frequency vs. restart cost.** Firing on every tick would
//!   trigger thousands of restarts per second while a task is unhealthy.
//! - **Restart storms.** A task that crashes on startup would be
//!   restarted forever, consuming scheduler and I/O bandwidth.
//! - **Race between reads.** [`crate::ai::heartbeat_age_ms`] and
//!   [`crate::ai::active_task_id`] are separate reads; the task may
//!   change between them. The watchdog snapshots both once and treats
//!   the snapshot as the incident identity.
//! - **Silent failure.** A bare `let _ = restart(...)` hides both
//!   transient failures and permanent breakage. Failures are counted and,
//!   past a threshold, the watchdog stops retrying and emits an audit
//!   event.
//!
//! # State machine
//!
//! An **incident** is a single AI task that has been stale past the
//! threshold. The watchdog tracks one incident at a time:
//!
//! ```text
//! Healthy ──age>threshold──▶ Fired ──cooldown──▶ Fired ──cap──▶ GaveUp
//!    ▲                        │                    │              │
//!    └───age≤threshold────────┴────────────────────┴──────────────┘
//! ```
//!
//! A new incident begins when the task ID changes, or when the heartbeat
//! recovers (`age ≤ threshold`) and the task later goes stale again.
//! Restarts within one incident are rate-limited by
//! [`WatchdogConfig::cooldown_ms`] and capped at
//! [`WatchdogConfig::max_attempts`].
//!
//! # Concurrency
//!
//! [`AiWatchdog`] is `Send` and intended to be a singleton. The free
//! function [`tick_ai_watchdog`] uses a private global; if you need
//! per-test isolation, construct an [`AiWatchdog`] directly.

use spin::Mutex;

// ── Constants ─────────────────────────────────────────────────────────────

/// Default staleness threshold, in milliseconds.
pub const DEFAULT_STALE_AFTER_MS: u64 = 5_000;

/// Default cooldown between restart attempts for the same incident.
pub const DEFAULT_COOLDOWN_MS: u64 = 10_000;

/// Default maximum restart attempts within one incident.
pub const DEFAULT_MAX_ATTEMPTS: u32 = 3;

/// Audit event: first restart attempt of an incident.
pub const EVENT_TIMEOUT: &str = "ai.watchdog.timeout";

/// Audit event: subsequent restart attempt of the same incident.
pub const EVENT_RETRY: &str = "ai.watchdog.retry";

/// Audit event: process layer declined or failed a restart.
pub const EVENT_RESTART_FAILED: &str = "ai.watchdog.restart_failed";

/// Audit event: watchdog gave up on an incident.
pub const EVENT_CAP_REACHED: &str = "ai.watchdog.cap_reached";

// ── Configuration ─────────────────────────────────────────────────────────

/// Configuration for [`AiWatchdog`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WatchdogConfig {
    /// Age above which an AI task is considered stale (ms).
    pub stale_after_ms: u64,
    /// Minimum time between two restart attempts for the same incident (ms).
    pub cooldown_ms: u64,
    /// Maximum restart attempts before the watchdog gives up on an incident.
    pub max_attempts: u32,
}

impl Default for WatchdogConfig {
    fn default() -> Self {
        Self {
            stale_after_ms: DEFAULT_STALE_AFTER_MS,
            cooldown_ms: DEFAULT_COOLDOWN_MS,
            max_attempts: DEFAULT_MAX_ATTEMPTS,
        }
    }
}

impl WatchdogConfig {
    /// Validate the configuration.
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.stale_after_ms == 0 {
            return Err("stale_after_ms must be > 0");
        }
        if self.cooldown_ms == 0 {
            return Err("cooldown_ms must be > 0");
        }
        if self.max_attempts == 0 {
            return Err("max_attempts must be > 0");
        }
        Ok(())
    }
}

// ── Outcomes ──────────────────────────────────────────────────────────────

/// Why a would-be restart was suppressed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SuppressReason {
    /// Too soon after the last attempt for this incident.
    Cooldown,
    /// Attempt cap for this incident has been reached.
    AttemptCap,
}

/// What the watchdog decided on a given tick.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WatchdogOutcome {
    /// No AI task is currently active, or it is within the threshold.
    Healthy,
    /// The watchdog asked the process layer to restart the task.
    Fired {
        pid: u64,
        age_ms: u64,
        attempt: u32,
    },
    /// The task is stale but the watchdog suppressed the restart.
    Suppressed {
        pid: u64,
        age_ms: u64,
        attempt: u32,
        reason: SuppressReason,
    },
    /// The process layer declined or failed the restart.
    RestartFailed {
        pid: u64,
        age_ms: u64,
        attempt: u32,
    },
}

// ── Statistics ────────────────────────────────────────────────────────────

/// Cumulative counters for observability.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct WatchdogStats {
    /// Total ticks observed by the watchdog.
    pub ticks: u64,
    /// Ticks where the active task was stale (age > threshold).
    pub stale_observations: u64,
    /// Distinct incidents started (new pid, or recovered then stale again).
    pub incidents_started: u64,
    /// Restart attempts that the process layer accepted.
    pub fired: u64,
    /// Suppressed due to cooldown.
    pub suppressed_cooldown: u64,
    /// Suppressed due to attempt cap.
    pub suppressed_cap: u64,
    /// Restart attempts the process layer declined or failed.
    pub restart_failed: u64,
}

// ── Watchdog ──────────────────────────────────────────────────────────────

/// The restart function signature. Returns `true` on success.
type RestartFn = fn(u64) -> bool;

/// Watchdog state for one incident.
#[derive(Debug, Clone, Copy)]
struct Incident {
    pid: u64,
    /// First tick we observed this incident.
    first_seen_ms: u64,
    /// Timestamp of the most recent restart attempt.
    last_attempt_ms: u64,
    /// Number of restart attempts made so far.
    attempts: u32,
    /// Whether we've emitted [`EVENT_CAP_REACHED`] for this incident.
    cap_reported: bool,
}

/// AI watchdog with hysteresis and bounded retries.
///
/// See the module-level docs for the state machine and concurrency notes.
pub struct AiWatchdog {
    config: WatchdogConfig,
    restart_fn: RestartFn,
    incident: Option<Incident>,
    stats: WatchdogStats,
}

impl AiWatchdog {
    /// Create a watchdog with the given configuration.
    ///
    /// Uses [`crate::process::restart_noncritical_ui`] as the restart
    /// function. Panics if `config` is invalid — construct with a default
    /// or call [`WatchdogConfig::validate`] first if you need a fallible
    /// constructor.
    #[must_use]
    pub fn new(config: WatchdogConfig) -> Self {
        assert!(
            config.validate().is_ok(),
            "invalid AiWatchdog config: {:?}",
            config
        );
        Self::with_restart_fn(config, |pid| {
            crate::process::restart_noncritical_ui(pid).is_ok()
        })
    }

    /// Create a watchdog with a custom restart function.
    ///
    /// Primarily intended for tests: inject a mock to observe decisions
    /// without touching the real process layer.
    #[must_use]
    pub fn with_restart_fn(config: WatchdogConfig, restart_fn: RestartFn) -> Self {
        assert!(
            config.validate().is_ok(),
            "invalid AiWatchdog config: {:?}",
            config
        );
        Self {
            config,
            restart_fn,
            incident: None,
            stats: WatchdogStats::default(),
        }
    }

    /// Current configuration.
    #[must_use]
    pub fn config(&self) -> &WatchdogConfig {
        &self.config
    }

    /// Cumulative statistics.
    #[must_use]
    pub fn stats(&self) -> WatchdogStats {
        self.stats
    }

    /// Current incident, if any, as `(pid, attempt_count)`.
    #[must_use]
    pub fn incident(&self) -> Option<(u64, u32)> {
        self.incident.map(|i| (i.pid, i.attempts))
    }

    /// Clear the current incident. The next stale observation starts a
    /// fresh one. Useful for tests and for operators who want to force a
    /// re-arm.
    pub fn reset(&mut self) {
        self.incident = None;
    }

    /// Run one tick of the watchdog.
    ///
    /// `now_ms`, `age_ms`, and `active_pid` are snapshotted by the caller
    /// (see [`tick_ai_watchdog`] for the standard snapshotting pattern).
    pub fn tick(
        &mut self,
        now_ms: u64,
        age_ms: u64,
        active_pid: Option<u64>,
    ) -> WatchdogOutcome {
        self.stats.ticks = self.stats.ticks.saturating_add(1);

        // ── Healthy paths ────────────────────────────────────────────────
        let Some(pid) = active_pid else {
            self.incident = None;
            return WatchdogOutcome::Healthy;
        };

        if age_ms <= self.config.stale_after_ms {
            self.incident = None;
            return WatchdogOutcome::Healthy;
        }

        self.stats.stale_observations = self.stats.stale_observations.saturating_add(1);

        // ── Incident bookkeeping ─────────────────────────────────────────
        let new_incident = match self.incident {
            Some(inc) => inc.pid != pid,
            None => true,
        };

        if new_incident {
            self.stats.incidents_started = self.stats.incidents_started.saturating_add(1);
            self.incident = Some(Incident {
                pid,
                first_seen_ms: now_ms,
                last_attempt_ms: now_ms,
                attempts: 0,
                cap_reported: false,
            });
        }

        // Safe: set immediately above.
        let inc = self
            .incident
            .as_mut()
            .expect("incident was just set");

        // ── Cap check ────────────────────────────────────────────────────
        if inc.attempts >= self.config.max_attempts {
            if !inc.cap_reported {
                inc.cap_reported = true;
                self.stats.suppressed_cap = self.stats.suppressed_cap.saturating_add(1);
                audit_cap_reached(pid, age_ms, inc.attempts);
            }
            return WatchdogOutcome::Suppressed {
                pid,
                age_ms,
                attempt: inc.attempts,
                reason: SuppressReason::AttemptCap,
            };
        }

        // ── Cooldown check (only after the first attempt) ────────────────
        if inc.attempts > 0 {
            let since_last = now_ms.saturating_sub(inc.last_attempt_ms);
            if since_last < self.config.cooldown_ms {
                self.stats.suppressed_cooldown = self.stats.suppressed_cooldown.saturating_add(1);
                return WatchdogOutcome::Suppressed {
                    pid,
                    age_ms,
                    attempt: inc.attempts,
                    reason: SuppressReason::Cooldown,
                };
            }
        }

        // ── Fire ─────────────────────────────────────────────────────────
        let attempt = inc.attempts.saturating_add(1);
        inc.attempts = attempt;
        inc.last_attempt_ms = now_ms;

        let ok = (self.restart_fn)(pid);

        if ok {
            self.stats.fired = self.stats.fired.saturating_add(1);
            audit_fired(pid, age_ms, attempt, inc.first_seen_ms);
            WatchdogOutcome::Fired { pid, age_ms, attempt }
        } else {
            self.stats.restart_failed = self.stats.restart_failed.saturating_add(1);
            audit_restart_failed(pid, age_ms, attempt);
            WatchdogOutcome::RestartFailed { pid, age_ms, attempt }
        }
    }
}

// ── Audit helpers ─────────────────────────────────────────────────────────

fn audit_fired(pid: u64, age_ms: u64, attempt: u32, first_seen_ms: u64) {
    let event = if attempt == 1 { EVENT_TIMEOUT } else { EVENT_RETRY };
    let msg = alloc::format!(
        "pid={} age_ms={} attempt={} first_seen_ms={}",
        pid,
        age_ms,
        attempt,
        first_seen_ms,
    );
    crate::io::audit_log::append_event(event, msg.as_bytes());
}

fn audit_restart_failed(pid: u64, age_ms: u64, attempt: u32) {
    let msg = alloc::format!("pid={} age_ms={} attempt={}", pid, age_ms, attempt);
    crate::io::audit_log::append_event(EVENT_RESTART_FAILED, msg.as_bytes());
}

fn audit_cap_reached(pid: u64, age_ms: u64, attempts: u32) {
    let msg = alloc::format!("pid={} age_ms={} attempts={}", pid, age_ms, attempts);
    crate::io::audit_log::append_event(EVENT_CAP_REACHED, msg.as_bytes());
}

// ── Global entry point ────────────────────────────────────────────────────

/// Global watchdog, lazily initialised on first use.
static WATCHDOG: Mutex<Option<AiWatchdog>> = Mutex::new(None);

/// Run one tick of the global AI watchdog.
///
/// This is the standard entry point for the kernel tick. It snapshots the
/// AI subsystem state once (to avoid a race between the two reads) and
/// forwards to the global [`AiWatchdog`].
///
/// The watchdog is created with [`WatchdogConfig::default`] on the first
/// call. To install a custom configuration, call
/// [`set_global_watchdog_config`] before the first tick.
#[must_use]
pub fn tick_ai_watchdog() -> WatchdogOutcome {
    let now_ms = crate::arch::uptime_ms();
    let age_ms = crate::ai::heartbeat_age_ms();
    let pid = crate::ai::active_task_id();

    let mut guard = WATCHDOG.lock();
    let wd = guard.get_or_insert_with(|| AiWatchdog::new(WatchdogConfig::default()));
    wd.tick(now_ms, age_ms, pid)
}

/// Install a custom configuration for the global watchdog.
///
/// Resets any in-flight incident. Returns the previous configuration, or
/// `None` if the watchdog had not been created yet.
pub fn set_global_watchdog_config(config: WatchdogConfig) -> Option<WatchdogConfig> {
    let mut guard = WATCHDOG.lock();
    let prev = guard.as_ref().map(|w| *w.config());
    *guard = Some(AiWatchdog::new(config));
    prev
}

/// Snapshot of the global watchdog's statistics, if it has been used.
#[must_use]
pub fn global_watchdog_stats() -> Option<WatchdogStats> {
    WATCHDOG.lock().as_ref().map(|w| w.stats())
}

// ── Tests ─────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    // Injected restart function shared by tests. Returns true only when the
    // test has primed the "success" slot.
    static RESTART_SUCCESS: AtomicU32 = AtomicU32::new(1);
    static RESTART_CALLS: AtomicU32 = AtomicU32::new(0);

    fn mock_restart(_pid: u64) -> bool {
        RESTART_CALLS.fetch_add(1, Ordering::SeqCst);
        RESTART_SUCCESS.load(Ordering::SeqCst) != 0
    }

    fn reset_mock() {
        RESTART_SUCCESS.store(1, Ordering::SeqCst);
        RESTART_CALLS.store(0, Ordering::SeqCst);
    }

    fn cfg() -> WatchdogConfig {
        WatchdogConfig {
            stale_after_ms: 1_000,
            cooldown_ms: 500,
            max_attempts: 3,
        }
    }

    #[test]
    fn healthy_when_no_active_task() {
        reset_mock();
        let mut wd = AiWatchdog::with_restart_fn(cfg(), mock_restart);
        let out = wd.tick(0, 60_000, None);
        assert_eq!(out, WatchdogOutcome::Healthy);
        assert_eq!(wd.incident(), None);
    }

    #[test]
    fn healthy_when_within_threshold() {
        reset_mock();
        let mut wd = AiWatchdog::with_restart_fn(cfg(), mock_restart);
        let out = wd.tick(0, 500, Some(7));
        assert_eq!(out, WatchdogOutcome::Healthy);
        assert_eq!(wd.incident(), None);
    }

    #[test]
    fn fires_once_when_stale() {
        reset_mock();
        let mut wd = AiWatchdog::with_restart_fn(cfg(), mock_restart);
        let out = wd.tick(0, 5_000, Some(7));
        assert_eq!(out, WatchdogOutcome::Fired { pid: 7, age_ms: 5_000, attempt: 1 });
        assert_eq!(wd.stats().fired, 1);
        assert_eq!(wd.incident(), Some((7, 1)));
    }

    #[test]
    fn cooldown_suppresses_immediate_refire() {
        reset_mock();
        let mut wd = AiWatchdog::with_restart_fn(cfg(), mock_restart);
        let _ = wd.tick(0, 5_000, Some(7));
        let out = wd.tick(100, 5_100, Some(7));
        assert!(matches!(
            out,
            WatchdogOutcome::Suppressed { reason: SuppressReason::Cooldown, .. }
        ));
        assert_eq!(wd.stats().suppressed_cooldown, 1);
        assert_eq!(wd.stats().fired, 1);
    }

    #[test]
    fn fires_again_after_cooldown() {
        reset_mock();
        let mut wd = AiWatchdog::with_restart_fn(cfg(), mock_restart);
        let _ = wd.tick(0, 5_000, Some(7));
        let out = wd.tick(1_000, 6_000, Some(7));
        assert!(matches!(out, WatchdogOutcome::Fired { attempt: 2, .. }));
        assert_eq!(wd.stats().fired, 2);
    }

    #[test]
    fn attempt_cap_stops_retries() {
        reset_mock();
        let mut wd = AiWatchdog::with_restart_fn(cfg(), mock_restart);
        let _ = wd.tick(0, 5_000, Some(7));
        let _ = wd.tick(1_000, 6_000, Some(7));
        let _ = wd.tick(2_000, 7_000, Some(7));
        // Fourth attempt is over cap.
        let out = wd.tick(3_000, 8_000, Some(7));
        assert!(matches!(
            out,
            WatchdogOutcome::Suppressed { reason: SuppressReason::AttemptCap, .. }
        ));
        assert_eq!(wd.stats().fired, 3);
    }

    #[test]
    fn cap_reported_once() {
        reset_mock();
        let mut wd = AiWatchdog::with_restart_fn(cfg(), mock_restart);
        let _ = wd.tick(0, 5_000, Some(7));
        let _ = wd.tick(1_000, 6_000, Some(7));
        let _ = wd.tick(2_000, 7_000, Some(7));
        let _ = wd.tick(3_000, 8_000, Some(7));
        let _ = wd.tick(4_000, 9_000, Some(7));
        // `suppressed_cap` increments only once, when the cap is reached.
        assert_eq!(wd.stats().suppressed_cap, 1);
    }

    #[test]
    fn new_pid_resets_incident() {
        reset_mock();
        let mut wd = AiWatchdog::with_restart_fn(cfg(), mock_restart);
        let _ = wd.tick(0, 5_000, Some(7));
        let out = wd.tick(100, 5_100, Some(8)); // different pid
        // No cooldown pending for pid 8 → fires immediately.
        assert!(matches!(out, WatchdogOutcome::Fired { pid: 8, attempt: 1, .. }));
    }

    #[test]
    fn heartbeat_recovery_rearms() {
        reset_mock();
        let mut wd = AiWatchdog::with_restart_fn(cfg(), mock_restart);
        let _ = wd.tick(0, 5_000, Some(7));
        let _ = wd.tick(50, 5_050, Some(7)); // suppressed by cooldown
        assert_eq!(wd.incident(), Some((7, 1)));

        // Heartbeat recovers.
        let _ = wd.tick(60, 100, Some(7));
        assert_eq!(wd.incident(), None);

        // Goes stale again — new incident, cooldown is reset.
        let out = wd.tick(70, 5_000, Some(7));
        assert!(matches!(out, WatchdogOutcome::Fired { attempt: 1, .. }));
    }

    #[test]
    fn restart_failure_is_reported() {
        reset_mock();
        RESTART_SUCCESS.store(0, Ordering::SeqCst);
        let mut wd = AiWatchdog::with_restart_fn(cfg(), mock_restart);
        let out = wd.tick(0, 5_000, Some(7));
        assert!(matches!(out, WatchdogOutcome::RestartFailed { attempt: 1, .. }));
        assert_eq!(wd.stats().restart_failed, 1);
        assert_eq!(wd.stats().fired, 0);
    }

    #[test]
    fn config_validation() {
        assert!(WatchdogConfig::default().validate().is_ok());
        assert!(WatchdogConfig { stale_after_ms: 0, ..Default::default() }
            .validate()
            .is_err());
        assert!(WatchdogConfig { cooldown_ms: 0, ..Default::default() }
            .validate()
            .is_err());
        assert!(WatchdogConfig { max_attempts: 0, ..Default::default() }
            .validate()
            .is_err());
    }

    #[test]
    fn reset_clears_incident() {
        reset_mock();
        let mut wd = AiWatchdog::with_restart_fn(cfg(), mock_restart);
        let _ = wd.tick(0, 5_000, Some(7));
        assert!(wd.incident().is_some());
        wd.reset();
        assert_eq!(wd.incident(), None);
    }

    #[test]
    fn stats_are_monotonic() {
        reset_mock();
        let mut wd = AiWatchdog::with_restart_fn(cfg(), mock_restart);
        let _ = wd.tick(0, 5_000, Some(7));
        let _ = wd.tick(100, 5_100, Some(7));
        let _ = wd.tick(1_000, 6_000, Some(7));
        let s = wd.stats();
        assert_eq!(s.ticks, 3);
        assert_eq!(s.stale_observations, 3);
        assert_eq!(s.incidents_started, 1);
        assert_eq!(s.fired, 2);
        assert_eq!(s.suppressed_cooldown, 1);
    }
}
