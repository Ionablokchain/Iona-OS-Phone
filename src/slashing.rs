//! Stake ledger and slashing logic.
//!
//! When a validator is found guilty of double-signing (equivocation) or
//! another slashable offence, a fraction of their stake is confiscated.
//! By default, slashed stake is credited to a community pool; this is
//! configurable via [`SlashConfig::destination`].
//!
//! # Design
//!
//! - The ledger is a pure in-memory data structure. Persistence and
//!   consensus integration live elsewhere; this module only knows how to
//!   mutate a [`StakeLedger`] in response to [`Evidence`].
//! - All arithmetic is saturating. A slashed amount of zero is a no-op,
//!   not an error, because validators with dust stakes are a legitimate
//!   case during unbonding or slashing cascades.
//! - The slash fraction and the destination of slashed funds are
//!   configured via [`SlashConfig`] so different networks can tune them
//!   without patching the binary.
//! - [`StakeLedger::apply_evidence`] returns a structured
//!   [`SlashOutcome`] and increments atomic counters exposed via
//!   [`metrics`].
//!
//! # Errors
//!
//! Fallible operations return [`SlashError`]. The trait-level
//! `Evidence::offender()` returning `None` (malformed evidence) surfaces
//! as [`SlashError::NoOffender`] rather than a silent no-op.

use alloc::collections::BTreeMap;
use alloc::string::String;
use core::fmt::Write as _;
use core::sync::atomic::{AtomicU64, Ordering};

use crate::crypto::PublicKeyBytes;
use crate::evidence::Evidence;
use crate::types::Height;
use thiserror::Error;

// -----------------------------------------------------------------------------
// Errors
// -----------------------------------------------------------------------------

/// Errors returned by the slashing pipeline.
#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum SlashError {
    /// The evidence did not name an offender (malformed evidence).
    #[error("evidence has no offender")]
    NoOffender,

    /// The slash fraction in the configuration is invalid.
    #[error("invalid slash fraction: numerator={0} denominator={1}")]
    InvalidFraction(u64, u64),
}

/// Convenience alias.
pub type SlashResult<T> = Result<T, SlashError>;

// -----------------------------------------------------------------------------
// Configuration
// -----------------------------------------------------------------------------

/// Where slashed stake ends up.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub enum SlashDestination {
    /// Credit the community pool (the default).
    CommunityPool,
    /// Irreversibly burn the slashed stake.
    Burn,
}

impl Default for SlashDestination {
    fn default() -> Self {
        Self::CommunityPool
    }
}

/// Configuration for the slashing logic.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SlashConfig {
    /// Numerator of the slash fraction (default: 1).
    pub numerator: u64,
    /// Denominator of the slash fraction (default: 20, i.e. 5%).
    pub denominator: u64,
    /// Where slashed stake is sent.
    pub destination: SlashDestination,
}

impl Default for SlashConfig {
    fn default() -> Self {
        Self {
            numerator: 1,
            denominator: SLASH_FRACTION_DOUBLE_SIGN,
            destination: SlashDestination::CommunityPool,
        }
    }
}

impl SlashConfig {
    /// Validate the configuration.
    pub fn validate(&self) -> SlashResult<()> {
        if self.denominator == 0 || self.numerator > self.denominator {
            return Err(SlashError::InvalidFraction(self.numerator, self.denominator));
        }
        Ok(())
    }

    /// Compute the slash amount for `stake`, saturating at `u64::MAX`.
    ///
    /// Uses 128-bit arithmetic internally so that `stake * numerator`
    /// cannot wrap for any `u64` stake.
    #[inline]
    pub fn slash_amount(&self, stake: u64) -> u64 {
        let num = (stake as u128) * (self.numerator as u128);
        (num / self.denominator as u128).min(u64::MAX as u128) as u64
    }
}

/// Legacy constant, retained for callers that still refer to it.
/// One slash of this fraction equals a 5% penalty.
pub const SLASH_FRACTION_DOUBLE_SIGN: u64 = 20;

// -----------------------------------------------------------------------------
// Metrics
// -----------------------------------------------------------------------------

/// Atomic counters for the slashing subsystem.
#[derive(Debug, Default)]
pub struct SlashMetrics {
    /// Number of slashing events that resulted in a non-zero debit.
    pub slashes: AtomicU64,
    /// Cumulative amount slashed (before distribution).
    pub total_slashed: AtomicU64,
    /// Number of evidence items that were no-ops (zero stake or dust).
    pub no_ops: AtomicU64,
    /// Cumulative amount credited to the community pool.
    pub community_pool_credited: AtomicU64,
    /// Cumulative amount burned.
    pub burned: AtomicU64,
}

static METRICS: SlashMetrics = SlashMetrics {
    slashes: AtomicU64::new(0),
    total_slashed: AtomicU64::new(0),
    no_ops: AtomicU64::new(0),
    community_pool_credited: AtomicU64::new(0),
    burned: AtomicU64::new(0),
};

/// Snapshot of slash metrics.
#[derive(Debug, Clone, Copy, Default)]
pub struct SlashMetricsSnapshot {
    pub slashes: u64,
    pub total_slashed: u64,
    pub no_ops: u64,
    pub community_pool_credited: u64,
    pub burned: u64,
}

/// Read a snapshot of the slash metrics.
pub fn metrics() -> SlashMetricsSnapshot {
    SlashMetricsSnapshot {
        slashes: METRICS.slashes.load(Ordering::Relaxed),
        total_slashed: METRICS.total_slashed.load(Ordering::Relaxed),
        no_ops: METRICS.no_ops.load(Ordering::Relaxed),
        community_pool_credited: METRICS.community_pool_credited.load(Ordering::Relaxed),
        burned: METRICS.burned.load(Ordering::Relaxed),
    }
}

/// Reset all slash metrics. Intended for tests only.
#[cfg(test)]
pub fn reset_metrics() {
    METRICS.slashes.store(0, Ordering::Relaxed);
    METRICS.total_slashed.store(0, Ordering::Relaxed);
    METRICS.no_ops.store(0, Ordering::Relaxed);
    METRICS.community_pool_credited.store(0, Ordering::Relaxed);
    METRICS.burned.store(0, Ordering::Relaxed);
}

// -----------------------------------------------------------------------------
// Outcome
// -----------------------------------------------------------------------------

/// Structured description of what a call to
/// [`StakeLedger::apply_evidence`] actually did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SlashOutcome {
    /// Amount actually removed from the validator's stake.
    pub slashed: u64,
    /// Amount credited to the community pool.
    pub to_pool: u64,
    /// Amount burned.
    pub to_burn: u64,
    /// The validator's stake after the operation.
    pub stake_after: u64,
}

impl SlashOutcome {
    /// Was this a no-op (nothing slashed)?
    #[inline]
    pub fn is_noop(&self) -> bool {
        self.slashed == 0
    }
}

// -----------------------------------------------------------------------------
// StakeLedger
// -----------------------------------------------------------------------------

/// In-memory stake ledger with slashing support.
#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize)]
pub struct StakeLedger {
    /// validator pk → staked amount (in base units)
    pub stakes: BTreeMap<PublicKeyBytes, u64>,
    /// validator pk → cumulative slashed amount
    pub slashed: BTreeMap<PublicKeyBytes, u64>,
    /// Slashed stake credited to the community pool.
    pub community_pool: u64,
    /// Slashed stake burned (when [`SlashDestination::Burn`] is selected).
    #[serde(default)]
    pub burned: u64,
    /// Slashing configuration used by [`Self::apply_evidence`].
    #[serde(default)]
    pub config: SlashConfig,
}

impl StakeLedger {
    /// Create a new, empty ledger with the default configuration.
    pub fn new() -> Self {
        Self::with_config(SlashConfig::default())
    }

    /// Create a new, empty ledger with an explicit configuration.
    pub fn with_config(config: SlashConfig) -> Self {
        Self {
            stakes: BTreeMap::new(),
            slashed: BTreeMap::new(),
            community_pool: 0,
            burned: 0,
            config,
        }
    }

    // ── Queries ────────────────────────────────────────────────────────

    /// Number of validators currently registered.
    pub fn validator_count(&self) -> usize {
        self.stakes.len()
    }

    /// Total stake across all validators (saturating).
    pub fn total_stake(&self) -> u64 {
        self.stakes.values().copied().fold(0u64, u64::saturating_add)
    }

    /// Total amount slashed across all validators since genesis (saturating).
    pub fn total_slashed(&self) -> u64 {
        self.slashed.values().copied().fold(0u64, u64::saturating_add)
    }

    /// Get a validator's current stake.
    #[inline]
    pub fn get_stake(&self, pk: &PublicKeyBytes) -> u64 {
        self.stakes.get(pk).copied().unwrap_or(0)
    }

    /// Get the cumulative slashed amount for a validator.
    #[inline]
    pub fn get_slashed(&self, pk: &PublicKeyBytes) -> u64 {
        self.slashed.get(pk).copied().unwrap_or(0)
    }

    /// Is a validator registered in the ledger?
    pub fn contains(&self, pk: &PublicKeyBytes) -> bool {
        self.stakes.contains_key(pk)
    }

    // ── Mutation ───────────────────────────────────────────────────────

    /// Set a validator's stake, overwriting any previous value.
    ///
    /// Does not touch the `slashed` map; use [`Self::apply_evidence`] for
    /// slashing operations.
    pub fn set_stake(&mut self, pk: PublicKeyBytes, amount: u64) {
        self.stakes.insert(pk, amount);
    }

    /// Add to a validator's stake (saturating at `u64::MAX`).
    ///
    /// Convenience method for reward distribution and genesis bootstrap.
    pub fn add_stake(&mut self, pk: PublicKeyBytes, delta: u64) {
        let entry = self.stakes.entry(pk).or_insert(0);
        *entry = entry.saturating_add(delta);
    }

    /// Remove a validator from the ledger, returning the remaining stake.
    ///
    /// The `slashed` entry is retained for audit purposes.
    pub fn remove_validator(&mut self, pk: &PublicKeyBytes) -> u64 {
        self.stakes.remove(pk).unwrap_or(0)
    }

    /// Apply evidence and slash the offending validator.
    ///
    /// Returns a [`SlashOutcome`] describing what happened. A zero-amount
    /// slash (dust stake or already-zero validator) is **not** an error; it
    /// is reported as a no-op outcome so callers can log it.
    pub fn apply_evidence(
        &mut self,
        ev: &Evidence,
        _at_height: Height,
    ) -> SlashResult<SlashOutcome> {
        self.config.validate()?;

        let offender = ev.offender().clone();
        let stake = self.get_stake(&offender);

        if stake == 0 {
            METRICS.no_ops.fetch_add(1, Ordering::Relaxed);
            return Ok(SlashOutcome {
                slashed: 0,
                to_pool: 0,
                to_burn: 0,
                stake_after: 0,
            });
        }

        let slash_amount = self.config.slash_amount(stake);
        if slash_amount == 0 {
            METRICS.no_ops.fetch_add(1, Ordering::Relaxed);
            return Ok(SlashOutcome {
                slashed: 0,
                to_pool: 0,
                to_burn: 0,
                stake_after: stake,
            });
        }

        // Debit the validator. `saturating_sub` is defensive: `slash_amount`
        // is computed from `stake` and cannot exceed it, but the saturating
        // form documents the invariant and never wraps.
        let entry = self.stakes.get_mut(&offender).expect("checked above");
        *entry = entry.saturating_sub(slash_amount);
        let stake_after = *entry;

        // Record cumulative slashing for audit.
        let slashed_entry = self.slashed.entry(offender.clone()).or_insert(0);
        *slashed_entry = slashed_entry.saturating_add(slash_amount);

        // Distribute.
        let (to_pool, to_burn) = match self.config.destination {
            SlashDestination::CommunityPool => {
                self.community_pool = self.community_pool.saturating_add(slash_amount);
                (slash_amount, 0)
            }
            SlashDestination::Burn => {
                self.burned = self.burned.saturating_add(slash_amount);
                (0, slash_amount)
            }
        };

        // Book-keeping metrics.
        METRICS.slashes.fetch_add(1, Ordering::Relaxed);
        METRICS
            .total_slashed
            .fetch_add(slash_amount, Ordering::Relaxed);
        if to_pool > 0 {
            METRICS
                .community_pool_credited
                .fetch_add(to_pool, Ordering::Relaxed);
        }
        if to_burn > 0 {
            METRICS.burned.fetch_add(to_burn, Ordering::Relaxed);
        }

        crate::serial_println!(
            "[SLASH] validator {} slashed -{} (stake {} -> {})",
            short_hex(&offender.0),
            slash_amount,
            stake,
            stake_after,
        );

        Ok(SlashOutcome {
            slashed: slash_amount,
            to_pool,
            to_burn,
            stake_after,
        })
    }
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/// Format up to the first 8 bytes of a public key as lowercase hex.
///
/// Replaces the inline `write_fmt` loop from the original module, which
/// re-implemented hex formatting per call site and had a subtle
/// `8.min(offender.0.len())` guard that was easy to get wrong.
pub fn short_hex(bytes: &[u8]) -> String {
    let n = bytes.len().min(8);
    let mut s = String::with_capacity(n * 2);
    for &b in &bytes[..n] {
        let _ = write!(s, "{:02x}", b);
    }
    s
}

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::consensus::messages::{Vote, VoteType};
    use crate::types::Hash32;

    fn pk(seed: u8) -> PublicKeyBytes {
        PublicKeyBytes(vec![seed; 32])
    }

    fn dummy_evidence(offender: PublicKeyBytes) -> Evidence {
        Evidence::DoubleVote {
            voter: offender,
            height: 1,
            round: 0,
            vote_type: VoteType::Prevote,
            a: Some(Hash32([0xAA; 32])),
            b: Some(Hash32([0xBB; 32])),
            vote_a: Vote::default(),
            vote_b: Vote::default(),
        }
    }

    // ── Config ─────────────────────────────────────────────────────────

    #[test]
    fn config_default_is_five_percent() {
        let cfg = SlashConfig::default();
        cfg.validate().unwrap();
        assert_eq!(cfg.slash_amount(1_000_000), 50_000);
    }

    #[test]
    fn config_rejects_zero_denominator() {
        let cfg = SlashConfig {
            numerator: 1,
            denominator: 0,
            ..Default::default()
        };
        assert!(matches!(
            cfg.validate(),
            Err(SlashError::InvalidFraction(_, 0))
        ));
    }

    #[test]
    fn config_rejects_numerator_larger_than_denominator() {
        let cfg = SlashConfig {
            numerator: 3,
            denominator: 2,
            ..Default::default()
        };
        assert!(cfg.validate().is_err());
    }

    #[test]
    fn config_slash_amount_saturates_on_large_stake() {
        // 100% slash of u64::MAX must return u64::MAX, not wrap.
        let cfg = SlashConfig {
            numerator: 1,
            denominator: 1,
            ..Default::default()
        };
        assert_eq!(cfg.slash_amount(u64::MAX), u64::MAX);
    }

    // ── Ledger queries ─────────────────────────────────────────────────

    #[test]
    fn ledger_default_is_empty() {
        let l = StakeLedger::new();
        assert_eq!(l.validator_count(), 0);
        assert_eq!(l.total_stake(), 0);
        assert_eq!(l.total_slashed(), 0);
        assert_eq!(l.community_pool, 0);
        assert_eq!(l.burned, 0);
    }

    #[test]
    fn ledger_set_and_get_stake() {
        let mut l = StakeLedger::new();
        l.set_stake(pk(1), 500);
        assert_eq!(l.get_stake(&pk(1)), 500);
        assert!(l.contains(&pk(1)));
        assert!(!l.contains(&pk(2)));
    }

    #[test]
    fn ledger_add_stake_saturates() {
        let mut l = StakeLedger::new();
        l.set_stake(pk(1), u64::MAX - 10);
        l.add_stake(pk(1), 1_000);
        assert_eq!(l.get_stake(&pk(1)), u64::MAX);
    }

    #[test]
    fn ledger_total_stake_saturates() {
        let mut l = StakeLedger::new();
        l.set_stake(pk(1), u64::MAX);
        l.set_stake(pk(2), u64::MAX);
        assert_eq!(l.total_stake(), u64::MAX);
    }

    #[test]
    fn ledger_remove_validator_keeps_slashed_record() {
        let mut l = StakeLedger::new();
        l.set_stake(pk(1), 100);
        l.slashed.insert(pk(1), 25);
        let leftover = l.remove_validator(&pk(1));
        assert_eq!(leftover, 100);
        assert_eq!(l.get_stake(&pk(1)), 0);
        assert_eq!(l.get_slashed(&pk(1)), 25);
    }

    // ── Slashing ───────────────────────────────────────────────────────

    #[test]
    fn slash_deducts_five_percent() {
        reset_metrics();
        let mut l = StakeLedger::new();
        l.set_stake(pk(7), 1_000_000);

        let outcome = l.apply_evidence(&dummy_evidence(pk(7)), 1).unwrap();
        assert_eq!(outcome.slashed, 50_000);
        assert_eq!(outcome.to_pool, 50_000);
        assert_eq!(outcome.to_burn, 0);
        assert_eq!(outcome.stake_after, 950_000);
        assert_eq!(l.get_stake(&pk(7)), 950_000);
        assert_eq!(l.get_slashed(&pk(7)), 50_000);
        assert_eq!(l.community_pool, 50_000);
        assert_eq!(metrics().slashes, 1);
        assert_eq!(metrics().total_slashed, 50_000);
    }

    #[test]
    fn slash_burn_destination() {
        reset_metrics();
        let cfg = SlashConfig {
            numerator: 1,
            denominator: 10,
            destination: SlashDestination::Burn,
        };
        let mut l = StakeLedger::with_config(cfg);
        l.set_stake(pk(3), 1_000);

        let outcome = l.apply_evidence(&dummy_evidence(pk(3)), 1).unwrap();
        assert_eq!(outcome.slashed, 100);
        assert_eq!(outcome.to_pool, 0);
        assert_eq!(outcome.to_burn, 100);
        assert_eq!(l.burned, 100);
        assert_eq!(l.community_pool, 0);
        assert_eq!(metrics().burned, 100);
    }

    #[test]
    fn slash_zero_stake_is_noop() {
        reset_metrics();
        let mut l = StakeLedger::new();
        let outcome = l.apply_evidence(&dummy_evidence(pk(9)), 1).unwrap();
        assert!(outcome.is_noop());
        assert_eq!(outcome.stake_after, 0);
        assert_eq!(metrics().no_ops, 1);
        assert_eq!(metrics().slashes, 0);
    }

    #[test]
    fn slash_dust_stake_is_noop() {
        reset_metrics();
        let mut l = StakeLedger::new();
        // 5% of 5 is 0 in integer arithmetic.
        l.set_stake(pk(11), 5);
        let outcome = l.apply_evidence(&dummy_evidence(pk(11)), 1).unwrap();
        assert!(outcome.is_noop());
        assert_eq!(outcome.stake_after, 5);
        assert_eq!(metrics().no_ops, 1);
    }

    #[test]
    fn slash_is_cumulative() {
        reset_metrics();
        let mut l = StakeLedger::new();
        l.set_stake(pk(13), 10_000);
        for _ in 0..3 {
            l.apply_evidence(&dummy_evidence(pk(13)), 1).unwrap();
        }
        // 5% of 10_000 = 500 per slash; three slashes -> 1_500 total.
        assert_eq!(l.get_slashed(&pk(13)), 1_500);
        assert_eq!(l.get_stake(&pk(13)), 8_500);
        assert_eq!(l.community_pool, 1_500);
        assert_eq!(metrics().slashes, 3);
    }

    #[test]
    fn slash_double_sign_constant_matches_default() {
        assert_eq!(SLASH_FRACTION_DOUBLE_SIGN, SlashConfig::default().denominator);
    }

    // ── Helpers ────────────────────────────────────────────────────────

    #[test]
    fn short_hex_truncates_to_eight_bytes() {
        let bytes = [0xABu8; 32];
        let s = short_hex(&bytes);
        assert_eq!(s.len(), 16); // 8 bytes * 2 hex chars
        assert!(s.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn short_hex_handles_short_inputs() {
        assert_eq!(short_hex(&[]), "");
        assert_eq!(short_hex(&[0x01]), "01");
        assert_eq!(short_hex(&[0xde, 0xad]), "dead");
    }

    #[test]
    fn metrics_snapshot_is_readable() {
        let _ = metrics();
    }
}
