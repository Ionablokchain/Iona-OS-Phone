//! Test-suite runner for the IONA integration tests.
//!
//! This module is the single entry point used by both the in-kernel test
//! harness and the `iona test` CLI subcommand. It exists so that callers
//! do not have to know the internal module layout of `crate::tests::*`; the
//! run list, ordering, and reporting all live here.
//!
//! # Design
//!
//! - The list of suites is a static slice of [`TestSuite`] descriptors.
//!   Adding a new suite means adding one entry here, not editing every
//!   caller.
//! - [`run_all`] runs every suite in declaration order and returns a
//!   [`TestReport`] with per-suite pass/fail counts and timings. It never
//!   panics on a failing test; the caller decides whether a failure is
//!   fatal (typical for CI) or merely logged (typical for a boot-time
//!   smoke test).
//! - Every run updates [`TestMetrics`], which are exposed via [`metrics`]
//!   for the GUI/health surface.
//! - A [`TestConfig`] lets callers filter by suite name and control whether
//!   failing tests abort the run early.
//!
//! # Example
//!
//! ```ignore
//! use crate::tests::runner::{run_all, TestConfig};
//!
//! // Run everything; log failures but keep going.
//! let report = run_all(TestConfig::default());
//! if !report.all_passed() {
//!     crate::klog_warn!("{} of {} suites failed", report.failed_suites(), report.total_suites());
//! }
//!
//! // For CI: abort on first failure.
//! let cfg = TestConfig { fail_fast: true, ..Default::default() };
//! let report = run_all(cfg);
//! assert!(report.all_passed(), "{}", report);
//! ```

use alloc::string::{String, ToString};
use alloc::vec::Vec;
use core::fmt;
use core::sync::atomic::{AtomicU64, Ordering};
use thiserror::Error;

// -----------------------------------------------------------------------------
// Errors
// -----------------------------------------------------------------------------

/// Errors that can be produced by the test runner itself (not by the tests
/// under it, which report their own results inside [`TestReport`]).
#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum TestRunnerError {
    /// A suite filter matched no suites.
    #[error("no suites matched filter: {0}")]
    NoSuitesMatched(String),

    /// The configuration is invalid.
    #[error("invalid configuration: {0}")]
    InvalidConfig(String),

    /// An internal invariant was violated.
    #[error("internal error: {0}")]
    Internal(String),
}

pub type TestRunnerResult<T> = Result<T, TestRunnerError>;

// -----------------------------------------------------------------------------
// Configuration
// -----------------------------------------------------------------------------

/// Configuration for a test run.
#[derive(Debug, Clone)]
pub struct TestConfig {
    /// If `Some`, only suites whose `name` contains this substring are run.
    /// The comparison is case-insensitive.
    pub filter: Option<String>,

    /// If `true`, the runner stops at the first suite that fails.
    /// If `false`, all suites are run regardless of intermediate failures.
    pub fail_fast: bool,

    /// If `true`, suites that pass are logged at `debug` level instead of
    /// the default `info` level. Useful for large CI runs.
    pub quiet_passes: bool,
}

impl Default for TestConfig {
    fn default() -> Self {
        Self {
            filter: None,
            fail_fast: false,
            quiet_passes: false,
        }
    }
}

impl TestConfig {
    /// Validate the configuration.
    pub fn validate(&self) -> TestRunnerResult<()> {
        if let Some(f) = &self.filter {
            if f.is_empty() {
                return Err(TestRunnerError::InvalidConfig(
                    "filter must not be the empty string".into(),
                ));
            }
        }
        Ok(())
    }

    /// Does `suite_name` pass the filter (if any)?
    pub fn matches(&self, suite_name: &str) -> bool {
        match &self.filter {
            None => true,
            Some(f) => {
                // Case-insensitive substring match without pulling in
                // `alloc::string::String::to_lowercase` for each call.
                contains_ignore_case(suite_name.as_bytes(), f.as_bytes())
            }
        }
    }
}

/// Case-insensitive ASCII substring test.
///
/// Returns `true` if `haystack` contains `needle` when both are folded to
/// ASCII lowercase. Non-ASCII bytes are compared as-is; test suite names
/// are ASCII by convention.
fn contains_ignore_case(haystack: &[u8], needle: &[u8]) -> bool {
    if needle.is_empty() {
        return true;
    }
    if needle.len() > haystack.len() {
        return false;
    }
    let fold = |b: u8| b.to_ascii_lowercase();
    'outer: for i in 0..=(haystack.len() - needle.len()) {
        for j in 0..needle.len() {
            if fold(haystack[i + j]) != fold(needle[j]) {
                continue 'outer;
            }
        }
        return true;
    }
    false
}

// -----------------------------------------------------------------------------
// Metrics
// -----------------------------------------------------------------------------

/// Atomic counters for the test runner.
#[derive(Debug, Default)]
pub struct TestMetrics {
    pub suites_run: AtomicU64,
    pub suites_passed: AtomicU64,
    pub suites_failed: AtomicU64,
    pub total_duration_ms: AtomicU64,
}

static METRICS: TestMetrics = TestMetrics {
    suites_run: AtomicU64::new(0),
    suites_passed: AtomicU64::new(0),
    suites_failed: AtomicU64::new(0),
    total_duration_ms: AtomicU64::new(0),
};

/// Snapshot of test-runner metrics.
#[derive(Debug, Clone, Copy, Default)]
pub struct TestMetricsSnapshot {
    pub suites_run: u64,
    pub suites_passed: u64,
    pub suites_failed: u64,
    pub total_duration_ms: u64,
}

/// Read a snapshot of the test-runner metrics.
pub fn metrics() -> TestMetricsSnapshot {
    TestMetricsSnapshot {
        suites_run: METRICS.suites_run.load(Ordering::Relaxed),
        suites_passed: METRICS.suites_passed.load(Ordering::Relaxed),
        suites_failed: METRICS.suites_failed.load(Ordering::Relaxed),
        total_duration_ms: METRICS.total_duration_ms.load(Ordering::Relaxed),
    }
}

/// Reset the metric counters. Test-only.
#[cfg(test)]
pub fn reset_metrics() {
    METRICS.suites_run.store(0, Ordering::Relaxed);
    METRICS.suites_passed.store(0, Ordering::Relaxed);
    METRICS.suites_failed.store(0, Ordering::Relaxed);
    METRICS.total_duration_ms.store(0, Ordering::Relaxed);
}

// -----------------------------------------------------------------------------
// Suite descriptor and result
// -----------------------------------------------------------------------------

/// A single test suite, described by a name and a function to run it.
///
/// The function returns `Ok(())` on success and `Err(String)` on failure,
/// where the string is a human-readable reason that will be included in
/// the report.
pub struct TestSuite {
    /// Stable name used for filtering and reporting.
    pub name: &'static str,
    /// The suite body.
    pub run: fn() -> Result<(), String>,
}

impl fmt::Debug for TestSuite {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("TestSuite").field("name", &self.name).finish()
    }
}

/// Outcome of a single suite.
#[derive(Debug, Clone)]
pub enum SuiteOutcome {
    /// The suite ran and passed.
    Passed { duration_ms: u64 },
    /// The suite ran and failed with a reason.
    Failed { reason: String, duration_ms: u64 },
    /// The suite was skipped (filter mismatch, or a fail-fast abort).
    Skipped { reason: String },
}

impl SuiteOutcome {
    pub fn is_pass(&self) -> bool {
        matches!(self, SuiteOutcome::Passed { .. })
    }
    pub fn is_fail(&self) -> bool {
        matches!(self, SuiteOutcome::Failed { .. })
    }
}

/// Per-suite record in a [`TestReport`].
#[derive(Debug, Clone)]
pub struct SuiteResult {
    pub name: &'static str,
    pub outcome: SuiteOutcome,
}

/// Aggregate report of a test run.
#[derive(Debug, Clone, Default)]
pub struct TestReport {
    pub suites: Vec<SuiteResult>,
}

impl TestReport {
    /// Total number of suites considered (passed + failed + skipped).
    pub fn total_suites(&self) -> usize {
        self.suites.len()
    }

    /// Number of suites that passed.
    pub fn passed_suites(&self) -> usize {
        self.suites.iter().filter(|s| s.outcome.is_pass()).count()
    }

    /// Number of suites that failed.
    pub fn failed_suites(&self) -> usize {
        self.suites.iter().filter(|s| s.outcome.is_fail()).count()
    }

    /// Number of suites that were skipped.
    pub fn skipped_suites(&self) -> usize {
        self.suites
            .iter()
            .filter(|s| matches!(s.outcome, SuiteOutcome::Skipped { .. }))
            .count()
    }

    /// Did every suite that ran pass, and were there no failures?
    pub fn all_passed(&self) -> bool {
        self.failed_suites() == 0
    }

    /// Iterate over suites that failed, with their reasons.
    pub fn failures(&self) -> impl Iterator<Item = (&'static str, &str)> {
        self.suites.iter().filter_map(|s| match &s.outcome {
            SuiteOutcome::Failed { reason, .. } => Some((s.name, reason.as_str())),
            _ => None,
        })
    }
}

impl fmt::Display for TestReport {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        writeln!(
            f,
            "test report: {} passed, {} failed, {} skipped (of {})",
            self.passed_suites(),
            self.failed_suites(),
            self.skipped_suites(),
            self.total_suites()
        )?;
        for s in &self.suites {
            match &s.outcome {
                SuiteOutcome::Passed { duration_ms } => {
                    writeln!(f, "  PASS  {} ({} ms)", s.name, duration_ms)?;
                }
                SuiteOutcome::Failed { reason, duration_ms } => {
                    writeln!(f, "  FAIL  {} ({} ms): {}", s.name, duration_ms, reason)?;
                }
                SuiteOutcome::Skipped { reason } => {
                    writeln!(f, "  SKIP  {}: {}", s.name, reason)?;
                }
            }
        }
        Ok(())
    }
}

// -----------------------------------------------------------------------------
// Suite registry
// -----------------------------------------------------------------------------

/// The list of test suites known to the runner.
///
/// Adding a new suite means adding one entry here. The name should be a
/// stable, lowercase, dot-separated path (e.g. `"net.neural_handshake"`)
/// so filtering with `--filter net.` selects the whole subsystem.
pub static SUITES: &[TestSuite] = &[
    TestSuite {
        name: "net.neural_handshake",
        run: crate::tests::neural_handshake_tests::run,
    },
];

// -----------------------------------------------------------------------------
// Public entry points
// -----------------------------------------------------------------------------

/// Run every suite that matches `cfg.filter`, honouring `cfg.fail_fast`.
///
/// This function does not panic on test failure; the caller is expected to
/// inspect the returned [`TestReport`] and decide what to do (log, abort,
/// etc.). A panic inside a suite propagates as normal — wrap the call in
/// `catch_unwind` if you need isolation, but note that the kernel build
/// disables unwinding, so a panic is fatal by design.
pub fn run_all(cfg: TestConfig) -> TestReport {
    match run_all_checked(cfg) {
        Ok(report) => report,
        Err(e) => {
            // Configuration errors are surfaced as a single "skipped"
            // entry so that callers always get a report.
            let mut report = TestReport::default();
            report.suites.push(SuiteResult {
                name: "<runner>",
                outcome: SuiteOutcome::Skipped {
                    reason: e.to_string(),
                },
            });
            report
        }
    }
}

/// Fallible variant of [`run_all`].
///
/// Returns [`TestRunnerError::NoSuitesMatched`] if `cfg.filter` excludes
/// every known suite. This is a common mistake when running `iona test
/// --filter foo` with a typo, and is best reported as an error rather than
/// as an empty (and therefore vacuously passing) report.
pub fn run_all_checked(cfg: TestConfig) -> TestRunnerResult<TestReport> {
    cfg.validate()?;

    let selected: Vec<&TestSuite> = SUITES
        .iter()
        .filter(|s| cfg.matches(s.name))
        .collect();

    if selected.is_empty() {
        return Err(TestRunnerError::NoSuitesMatched(
            cfg.filter.clone().unwrap_or_else(|| "<none>".into()),
        ));
    }

    let mut report = TestReport {
        suites: Vec::with_capacity(selected.len()),
    };
    let mut aborted = false;

    for suite in selected {
        if aborted {
            report.suites.push(SuiteResult {
                name: suite.name,
                outcome: SuiteOutcome::Skipped {
                    reason: "fail-fast: earlier suite failed".into(),
                },
            });
            continue;
        }

        let start = crate::arch::uptime_ms();
        let outcome = (suite.run)();
        let duration_ms = crate::arch::uptime_ms().saturating_sub(start);

        match outcome {
            Ok(()) => {
                METRICS.suites_passed.fetch_add(1, Ordering::Relaxed);
                if cfg.quiet_passes {
                    crate::klog_debug!("test: {} PASS ({} ms)", suite.name, duration_ms);
                } else {
                    crate::klog_info!("test: {} PASS ({} ms)", suite.name, duration_ms);
                }
                report.suites.push(SuiteResult {
                    name: suite.name,
                    outcome: SuiteOutcome::Passed { duration_ms },
                });
            }
            Err(reason) => {
                METRICS.suites_failed.fetch_add(1, Ordering::Relaxed);
                crate::klog_error!(
                    "test: {} FAIL ({} ms): {}",
                    suite.name,
                    duration_ms,
                    reason
                );
                report.suites.push(SuiteResult {
                    name: suite.name,
                    outcome: SuiteOutcome::Failed { reason, duration_ms },
                });
                if cfg.fail_fast {
                    aborted = true;
                }
            }
        }

        METRICS.suites_run.fetch_add(1, Ordering::Relaxed);
        METRICS
            .total_duration_ms
            .fetch_add(duration_ms, Ordering::Relaxed);
    }

    crate::klog_info!(
        "test run complete: {} passed, {} failed, {} skipped",
        report.passed_suites(),
        report.failed_suites(),
        report.skipped_suites(),
    );

    Ok(report)
}

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // ── contains_ignore_case ──────────────────────────────────────────────

    #[test]
    fn contains_ignore_case_basic() {
        assert!(contains_ignore_case(b"Hello World", b"world"));
        assert!(contains_ignore_case(b"HELLO", b"hello"));
        assert!(contains_ignore_case(b"abc", b""));
        assert!(!contains_ignore_case(b"abc", b"d"));
        assert!(!contains_ignore_case(b"abc", b"abcd"));
    }

    #[test]
    fn contains_ignore_case_no_match() {
        assert!(!contains_ignore_case(b"net.neural_handshake", b"storage"));
    }

    // ── TestConfig ────────────────────────────────────────────────────────

    #[test]
    fn config_validate_rejects_empty_filter() {
        let cfg = TestConfig {
            filter: Some(String::new()),
            ..Default::default()
        };
        assert!(matches!(
            cfg.validate(),
            Err(TestRunnerError::InvalidConfig(_))
        ));
    }

    #[test]
    fn config_matches_all_when_filter_is_none() {
        let cfg = TestConfig::default();
        assert!(cfg.matches("anything"));
    }

    #[test]
    fn config_matches_substring_case_insensitive() {
        let cfg = TestConfig {
            filter: Some("NEURAL".into()),
            ..Default::default()
        };
        assert!(cfg.matches("net.neural_handshake"));
        assert!(!cfg.matches("net.storage"));
    }

    // ── TestReport ────────────────────────────────────────────────────────

    fn make_report(outcomes: &[SuiteOutcome]) -> TestReport {
        TestReport {
            suites: outcomes
                .iter()
                .enumerate()
                .map(|(i, o)| SuiteResult {
                    name: Box::leak(format!("suite{}", i).into_boxed_str()),
                    outcome: o.clone(),
                })
                .collect(),
        }
    }

    #[test]
    fn report_counts_passes_and_failures() {
        let report = make_report(&[
            SuiteOutcome::Passed { duration_ms: 1 },
            SuiteOutcome::Failed {
                reason: "boom".into(),
                duration_ms: 2,
            },
            SuiteOutcome::Skipped {
                reason: "filtered".into(),
            },
        ]);
        assert_eq!(report.total_suites(), 3);
        assert_eq!(report.passed_suites(), 1);
        assert_eq!(report.failed_suites(), 1);
        assert_eq!(report.skipped_suites(), 1);
        assert!(!report.all_passed());
    }

    #[test]
    fn report_all_passed_with_no_failures() {
        let report = make_report(&[
            SuiteOutcome::Passed { duration_ms: 1 },
            SuiteOutcome::Skipped {
                reason: "no match".into(),
            },
        ]);
        assert!(report.all_passed());
    }

    #[test]
    fn report_failures_iterates_reasons() {
        let report = make_report(&[
            SuiteOutcome::Failed {
                reason: "boom".into(),
                duration_ms: 1,
            },
            SuiteOutcome::Failed {
                reason: "bang".into(),
                duration_ms: 2,
            },
        ]);
        let reasons: Vec<&str> = report.failures().map(|(_, r)| r).collect();
        assert_eq!(reasons, vec!["boom", "bang"]);
    }

    #[test]
    fn report_display_is_human_readable() {
        let report = make_report(&[
            SuiteOutcome::Passed { duration_ms: 3 },
            SuiteOutcome::Failed {
                reason: "bad".into(),
                duration_ms: 4,
            },
        ]);
        let s = alloc::format!("{}", report);
        assert!(s.contains("test report"));
        assert!(s.contains("PASS"));
        assert!(s.contains("FAIL"));
        assert!(s.contains("bad"));
    }

    // ── Metrics ───────────────────────────────────────────────────────────

    #[test]
    fn metrics_snapshot_is_readable() {
        let _ = metrics();
    }

    // ── run_all_checked behaviour ─────────────────────────────────────────

    #[test]
    fn run_all_checked_rejects_unmatched_filter() {
        let cfg = TestConfig {
            filter: Some("this-suite-does-not-exist".into()),
            ..Default::default()
        };
        let err = run_all_checked(cfg).unwrap_err();
        assert!(matches!(err, TestRunnerError::NoSuitesMatched(_)));
    }

    #[test]
    fn run_all_returns_report_on_config_error() {
        let cfg = TestConfig {
            filter: Some(String::new()),
            ..Default::default()
        };
        let report = run_all(cfg);
        assert_eq!(report.total_suites(), 1);
        assert_eq!(report.skipped_suites(), 1);
    }
}
