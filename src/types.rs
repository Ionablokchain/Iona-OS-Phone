//! Core protocol types shared across consensus, execution, and networking.
//!
//! This module is the single source of truth for the wire and in-memory
//! shapes that flow through the IONA consensus pipeline. Every other module
//! imports from here rather than redefining a local variant, so that a
//! change to a header field is a single-edit operation.
//!
//! # Design notes
//!
//! - [`Hash32`] is a newtype over `[u8; 32]` rather than a bare type alias,
//!   so that `Hash32::zero()` and hex conversion can live on it and so that
//!   accidental mixing with other 32-byte arrays becomes a compile error.
//! - [`Block::id()`] hashes a **canonical, length-prefixed** serialization
//!   of the header. The previous version concatenated raw fields without
//!   length prefixes, which allowed two distinct headers to collide when a
//!   variable-length field (`proposer_pk`, `proposer_addr`) changed length
//!   but produced the same byte stream. It also omitted `gas_limit`,
//!   `chain_id`, and `protocol_version`, meaning a block could be re-mined
//!   with a different gas limit and keep the same ID.
//! - [`Block::encoded_len()`] returns the exact number of bytes `id()`
//!   hashes over, so callers that want to bound wire size can do so without
//!   re-deriving the layout.
//! - [`BlockHeader::validate()`] rejects the header shapes that would
//!   otherwise corrupt the chain (zero state root, zero gas limit, etc.).
//!   Callers are expected to invoke it before a header enters the block
//!   store or the network.

use alloc::collections::BTreeMap;
use alloc::string::String;
use alloc::vec::Vec;
use core::fmt;
use core::ops::Deref;
use thiserror::Error;

// -----------------------------------------------------------------------------
// Errors
// -----------------------------------------------------------------------------

/// Errors produced by the type layer.
#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum TypeError {
    #[error("invalid hex: {0}")]
    InvalidHex(String),

    #[error("invalid length: expected {expected}, got {actual}")]
    InvalidLength { expected: usize, actual: usize },

    #[error("header validation failed: {0}")]
    InvalidHeader(String),

    #[error("block validation failed: {0}")]
    InvalidBlock(String),
}

pub type TypeResult<T> = Result<T, TypeError>;

// -----------------------------------------------------------------------------
// Primitive aliases
// -----------------------------------------------------------------------------

/// Block height. Monotonic from genesis (`height >= 1`).
pub type Height = u64;

/// Consensus round within a height. Starts at 0.
pub type Round = u32;

/// Simple key-value state: opaque byte keys and values.
///
/// The execution layer interprets the keys; the type layer only owns the
/// container choice. `BTreeMap` gives deterministic iteration order, which
/// the Merkle root and state hash depend on.
pub type KvState = BTreeMap<Vec<u8>, Vec<u8>>;

// -----------------------------------------------------------------------------
// Hash32
// -----------------------------------------------------------------------------

/// A 32-byte hash (block IDs, transaction hashes, state roots, …).
///
/// The newtype prevents accidental interchange with other 32-byte arrays
/// (validator public keys, signatures) that would otherwise silently
/// type-check.
#[derive(
    Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash,
    serde::Serialize, serde::Deserialize,
)]
#[serde(transparent)]
pub struct Hash32(pub [u8; 32]);

impl Hash32 {
    /// The all-zero hash, used as a sentinel for "no parent" at genesis.
    #[inline]
    pub const fn zero() -> Self {
        Hash32([0u8; 32])
    }

    /// Construct from a byte slice, validating the length.
    pub fn from_slice(bytes: &[u8]) -> TypeResult<Self> {
        if bytes.len() != 32 {
            return Err(TypeError::InvalidLength {
                expected: 32,
                actual: bytes.len(),
            });
        }
        let mut out = [0u8; 32];
        out.copy_from_slice(bytes);
        Ok(Hash32(out))
    }

    /// Borrow the inner bytes as a slice.
    #[inline]
    pub fn as_slice(&self) -> &[u8] {
        &self.0
    }

    /// Whether this is the all-zero sentinel.
    #[inline]
    pub fn is_zero(&self) -> bool {
        self.0.iter().all(|&b| b == 0)
    }

    /// Lowercase hex, no `0x` prefix.
    pub fn to_hex(&self) -> String {
        let mut s = String::with_capacity(64);
        for b in &self.0 {
            s.push(hex_digit((b >> 4) & 0x0F));
            s.push(hex_digit(b & 0x0F));
        }
        s
    }

    /// Parse a hex string, with or without a `0x` prefix.
    pub fn from_hex(s: &str) -> TypeResult<Self> {
        let s = s.strip_prefix("0x").unwrap_or(s);
        if s.len() != 64 {
            return Err(TypeError::InvalidLength {
                expected: 64,
                actual: s.len(),
            });
        }
        let mut out = [0u8; 32];
        let bytes = s.as_bytes();
        for i in 0..32 {
            let hi = parse_hex_digit(bytes[i * 2])?;
            let lo = parse_hex_digit(bytes[i * 2 + 1])?;
            out[i] = (hi << 4) | lo;
        }
        Ok(Hash32(out))
    }
}

impl Deref for Hash32 {
    type Target = [u8; 32];
    #[inline]
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl AsRef<[u8]> for Hash32 {
    #[inline]
    fn as_ref(&self) -> &[u8] {
        &self.0
    }
}

impl From<[u8; 32]> for Hash32 {
    #[inline]
    fn from(bytes: [u8; 32]) -> Self {
        Hash32(bytes)
    }
}

impl From<Hash32> for [u8; 32] {
    #[inline]
    fn from(h: Hash32) -> Self {
        h.0
    }
}

impl fmt::Debug for Hash32 {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Hash32({})", self.to_hex())
    }
}

impl fmt::Display for Hash32 {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.to_hex())
    }
}

#[inline]
fn hex_digit(n: u8) -> char {
    match n {
        0..=9 => (b'0' + n) as char,
        _ => (b'a' + (n - 10)) as char,
    }
}

#[inline]
fn parse_hex_digit(b: u8) -> TypeResult<u8> {
    match b {
        b'0'..=b'9' => Ok(b - b'0'),
        b'a'..=b'f' => Ok(b - b'a' + 10),
        b'A'..=b'F' => Ok(b - b'A' + 10),
        _ => Err(TypeError::InvalidHex(
            alloc::format!("bad hex digit 0x{:02x}", b),
        )),
    }
}

// -----------------------------------------------------------------------------
// Transaction
// -----------------------------------------------------------------------------

/// A signed transaction.
///
/// The execution layer interprets `payload`; the type layer only checks that
/// the structural fields are self-consistent. `from` is the human-readable
/// sender address (derived from `pubkey` by the crypto layer); it is stored
/// separately so that RPC responses and log records do not need to re-derive
/// it on every access.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Tx {
    /// Sender address (hex, no `0x`).
    pub from: String,
    /// Sender nonce. Strictly increasing per sender.
    pub nonce: u64,
    /// Chain this transaction is bound to. Prevents replay across forks.
    pub chain_id: u64,
    /// Maximum gas this transaction is allowed to consume.
    pub gas_limit: u64,
    /// Maximum fee per gas the sender is willing to pay.
    pub max_fee_per_gas: u64,
    /// Ed25519 public key, 32 bytes.
    pub pubkey: Vec<u8>,
    /// Opaque payload (RLP, bincode, or scheme-specific envelope).
    pub payload: Vec<u8>,
    /// Signature over the canonical signing bytes for this transaction.
    pub signature: Vec<u8>,
}

impl Tx {
    /// Canonical signing bytes: everything except the signature.
    ///
    /// Every field is length-prefixed so that variable-length fields cannot
    /// be shifted across a boundary without changing the digest.
    pub fn signing_bytes(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(
            8 + self.from.len()
                + 8 + 8 + 8
                + 4 + self.pubkey.len()
                + 4 + self.payload.len(),
        );
        write_len_prefixed(&mut out, self.from.as_bytes());
        out.extend_from_slice(&self.nonce.to_le_bytes());
        out.extend_from_slice(&self.chain_id.to_le_bytes());
        out.extend_from_slice(&self.gas_limit.to_le_bytes());
        out.extend_from_slice(&self.max_fee_per_gas.to_le_bytes());
        write_len_prefixed(&mut out, &self.pubkey);
        write_len_prefixed(&mut out, &self.payload);
        out
    }

    /// Validate the transaction's structural invariants.
    ///
    /// This is a *cheap* check performed before the transaction enters the
    /// mempool. Signature verification is done by the crypto layer.
    pub fn validate(&self) -> TypeResult<()> {
        if self.from.is_empty() {
            return Err(TypeError::InvalidBlock("tx.from is empty".into()));
        }
        if self.pubkey.is_empty() {
            return Err(TypeError::InvalidBlock("tx.pubkey is empty".into()));
        }
        if self.signature.is_empty() {
            return Err(TypeError::InvalidBlock("tx.signature is empty".into()));
        }
        if self.gas_limit == 0 {
            return Err(TypeError::InvalidBlock("tx.gas_limit is zero".into()));
        }
        if self.chain_id == 0 {
            return Err(TypeError::InvalidBlock("tx.chain_id is zero".into()));
        }
        Ok(())
    }
}

// -----------------------------------------------------------------------------
// Log
// -----------------------------------------------------------------------------

/// An EVM-style log record.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Log {
    /// Emitting contract address, 20 bytes.
    pub address: [u8; 20],
    /// Indexed topics, up to 4 per EIP-234.
    pub topics: Vec<Hash32>,
    /// Unindexed data payload.
    pub data: Vec<u8>,
}

impl Log {
    /// Address as lowercase hex without a `0x` prefix.
    pub fn address_hex(&self) -> String {
        let mut s = String::with_capacity(40);
        for b in &self.address {
            s.push(hex_digit((b >> 4) & 0x0F));
            s.push(hex_digit(b & 0x0F));
        }
        s
    }
}

// -----------------------------------------------------------------------------
// Receipt
// -----------------------------------------------------------------------------

/// A transaction execution receipt.
///
/// The fields mirror the EIP-2718 typed receipt envelope extended with the
/// per-phase gas breakdown that the execution layer produces. The simplified
/// `{ tx_hash, success, gas_used, logs, output }` shape that earlier revisions
/// of this module used is a strict subset; every field added here has been
/// given a `#[serde(default)]` so old serialized receipts continue to
/// deserialize.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Receipt {
    pub tx_hash: Hash32,
    pub success: bool,

    // ── Gas accounting ──────────────────────────────────────────────────
    pub gas_used: u64,
    #[serde(default)]
    pub intrinsic_gas_used: u64,
    #[serde(default)]
    pub exec_gas_used: u64,
    #[serde(default)]
    pub vm_gas_used: u64,
    #[serde(default)]
    pub evm_gas_used: u64,

    // ── Fee accounting ──────────────────────────────────────────────────
    #[serde(default)]
    pub effective_gas_price: u64,
    #[serde(default)]
    pub burned: u64,
    #[serde(default)]
    pub tip: u64,

    // ── Outcome ─────────────────────────────────────────────────────────
    /// `None` on success, `Some(reason)` on revert.
    #[serde(default)]
    pub error: Option<String>,
    /// Optional structured return data (already decoded by the execution layer).
    #[serde(default)]
    pub data: Option<Vec<u8>>,

    // ── Side effects ────────────────────────────────────────────────────
    #[serde(default)]
    pub logs: Vec<Log>,
    #[serde(default)]
    pub output: Vec<u8>,
}

impl Receipt {
    /// Validate that the gas breakdown sums correctly and that the success
    /// flag is consistent with `error`.
    pub fn validate(&self) -> TypeResult<()> {
        if self.success && self.error.is_some() {
            return Err(TypeError::InvalidBlock(
                "receipt.success is true but error is set".into(),
            ));
        }
        if !self.success && self.error.is_none() {
            return Err(TypeError::InvalidBlock(
                "receipt.success is false but error is None".into(),
            ));
        }
        let phase_sum = self
            .intrinsic_gas_used
            .saturating_add(self.exec_gas_used)
            .saturating_add(self.vm_gas_used)
            .saturating_add(self.evm_gas_used);
        // If any phase is non-zero, require the total to be at least the
        // phase sum (the execution layer may add overhead between phases).
        if phase_sum > self.gas_used {
            return Err(TypeError::InvalidBlock(alloc::format!(
                "phase gas sum {} exceeds total {}",
                phase_sum,
                self.gas_used
            )));
        }
        Ok(())
    }
}

// -----------------------------------------------------------------------------
// BlockHeader
// -----------------------------------------------------------------------------

/// Block header.
///
/// The field set is the union of what consensus, execution, and the wire
/// protocol need. Every field contributes to [`Block::id()`] via
/// [`Self::canonical_bytes`], so adding a field without updating the ID
/// function is a silent consensus bug; the ID function and the header are
/// defined in the same module precisely so that edits stay paired.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct BlockHeader {
    pub height: Height,
    pub round: Round,

    /// Hash of the parent block. `Hash32::zero()` for genesis.
    pub parent_id: Hash32,
    /// Pre-state root.
    pub prev_state_root: Hash32,
    /// Post-state root after executing this block.
    pub state_root: Hash32,
    /// Root of the transaction Merkle tree.
    pub tx_root: Hash32,
    /// Root of the receipts Merkle tree.
    pub receipts_root: Hash32,

    /// Raw Ed25519 public key of the block proposer.
    pub proposer_pk: Vec<u8>,
    /// Human-readable proposer address, matching `proposer_pk`.
    pub proposer_addr: String,

    /// EIP-1559 base fee per gas.
    pub base_fee_per_gas: u64,
    /// Total gas consumed by the block.
    pub gas_used: u64,
    /// Block gas limit.
    pub gas_limit: u64,
    /// Intrinsic gas (paid before execution begins).
    pub intrinsic_gas_used: u64,
    /// Execution-phase gas.
    pub exec_gas_used: u64,
    /// VM-phase gas.
    pub vm_gas_used: u64,
    /// EVM-phase gas.
    pub evm_gas_used: u64,

    /// Chain identifier. Replay protection across forks.
    pub chain_id: u64,
    /// Consensus protocol version that produced this block.
    pub protocol_version: u32,
    /// Unix timestamp in milliseconds.
    pub timestamp_ms: u64,
}

impl BlockHeader {
    /// Canonical byte encoding used by [`Block::id()`].
    ///
    /// Every variable-length field is prefixed with a 4-byte little-endian
    /// length. Every fixed-length field is written in a fixed order. The
    /// encoding is intentionally simple and total: it has no failure modes
    /// and no version-dependent behaviour, so two independently built nodes
    /// always agree on the digest.
    pub fn canonical_bytes(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(256);
        out.extend_from_slice(&self.height.to_le_bytes());
        out.extend_from_slice(&self.round.to_le_bytes());
        out.extend_from_slice(&self.parent_id.0);
        out.extend_from_slice(&self.prev_state_root.0);
        out.extend_from_slice(&self.state_root.0);
        out.extend_from_slice(&self.tx_root.0);
        out.extend_from_slice(&self.receipts_root.0);
        write_len_prefixed(&mut out, &self.proposer_pk);
        write_len_prefixed(&mut out, self.proposer_addr.as_bytes());
        out.extend_from_slice(&self.base_fee_per_gas.to_le_bytes());
        out.extend_from_slice(&self.gas_used.to_le_bytes());
        out.extend_from_slice(&self.gas_limit.to_le_bytes());
        out.extend_from_slice(&self.intrinsic_gas_used.to_le_bytes());
        out.extend_from_slice(&self.exec_gas_used.to_le_bytes());
        out.extend_from_slice(&self.vm_gas_used.to_le_bytes());
        out.extend_from_slice(&self.evm_gas_used.to_le_bytes());
        out.extend_from_slice(&self.chain_id.to_le_bytes());
        out.extend_from_slice(&self.protocol_version.to_le_bytes());
        out.extend_from_slice(&self.timestamp_ms.to_le_bytes());
        out
    }

    /// Validate the header's structural invariants.
    ///
    /// Rejects headers that would corrupt the chain: zero state root on a
    /// non-genesis block, gas_used exceeding gas_limit, zero gas_limit,
    /// empty proposer key/addr, etc. Signature verification is out of scope.
    pub fn validate(&self) -> TypeResult<()> {
        if self.gas_limit == 0 {
            return Err(TypeError::InvalidHeader("gas_limit is zero".into()));
        }
        if self.gas_used > self.gas_limit {
            return Err(TypeError::InvalidHeader(alloc::format!(
                "gas_used {} exceeds gas_limit {}",
                self.gas_used,
                self.gas_limit
            )));
        }
        if self.proposer_pk.is_empty() {
            return Err(TypeError::InvalidHeader("proposer_pk is empty".into()));
        }
        if self.proposer_addr.is_empty() {
            return Err(TypeError::InvalidHeader("proposer_addr is empty".into()));
        }
        // Genesis is the only block allowed to have a zero parent and a
        // zero pre-state root. Non-genesis blocks must reference both.
        if self.height > 1 {
            if self.parent_id.is_zero() {
                return Err(TypeError::InvalidHeader(
                    "non-genesis block has zero parent_id".into(),
                ));
            }
            if self.prev_state_root.is_zero() {
                return Err(TypeError::InvalidHeader(
                    "non-genesis block has zero prev_state_root".into(),
                ));
            }
        }
        if self.state_root.is_zero() {
            return Err(TypeError::InvalidHeader("state_root is zero".into()));
        }
        Ok(())
    }
}

// -----------------------------------------------------------------------------
// Block
// -----------------------------------------------------------------------------

/// A block: header plus the transactions it carries.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct Block {
    pub header: BlockHeader,
    pub txs: Vec<Tx>,
}

impl Block {
    /// Deterministic block ID: the SHA-256 hash of the header's canonical
    /// bytes.
    ///
    /// The canonical encoding is defined by
    /// [`BlockHeader::canonical_bytes`], which length-prefixes every
    /// variable-length field and includes every header field. The previous
    /// implementation of `id()` concatenated raw fields without length
    /// prefixes and omitted `gas_limit`, `chain_id`, and
    /// `protocol_version`, allowing distinct blocks to share an ID.
    pub fn id(&self) -> Hash32 {
        let bytes = self.header.canonical_bytes();
        crate::consensus::engine::sha256_hash(&bytes).into()
    }

    /// Exact number of bytes [`Self::id()`] hashes over. Useful for wire
    /// size budgeting without re-deriving the layout at the call site.
    pub fn encoded_len(&self) -> usize {
        self.header.canonical_bytes().len()
    }

    /// Total number of transactions in the block.
    pub fn tx_count(&self) -> usize {
        self.txs.len()
    }

    /// Validate the block: header is valid, every transaction is valid, and
    /// no two transactions share a sender+nonce pair (which would let a
    /// malicious proposer include a self-overwriting transaction pair).
    pub fn validate(&self) -> TypeResult<()> {
        self.header.validate()?;
        for tx in &self.txs {
            tx.validate()?;
        }
        // Reject duplicate (sender, nonce) pairs.
        let mut seen: BTreeMap<(&str, u64), ()> = BTreeMap::new();
        for tx in &self.txs {
            let key = (tx.from.as_str(), tx.nonce);
            if seen.insert(key, ()).is_some() {
                return Err(TypeError::InvalidBlock(alloc::format!(
                    "duplicate (from={}, nonce={}) in block",
                    tx.from,
                    tx.nonce
                )));
            }
        }
        Ok(())
    }

    /// Genesis block constructor: the only block where a zero parent is valid.
    ///
    /// `chain_id` and `protocol_version` are required; everything else is
    /// derived from the caller's genesis state.
    pub fn genesis(
        chain_id: u64,
        protocol_version: u32,
        state_root: Hash32,
        proposer_pk: Vec<u8>,
        proposer_addr: String,
        base_fee_per_gas: u64,
        gas_limit: u64,
        timestamp_ms: u64,
    ) -> Self {
        Block {
            header: BlockHeader {
                height: 1,
                round: 0,
                parent_id: Hash32::zero(),
                prev_state_root: Hash32::zero(),
                state_root,
                tx_root: Hash32::zero(),
                receipts_root: Hash32::zero(),
                proposer_pk,
                proposer_addr,
                base_fee_per_gas,
                gas_used: 0,
                gas_limit,
                intrinsic_gas_used: 0,
                exec_gas_used: 0,
                vm_gas_used: 0,
                evm_gas_used: 0,
                chain_id,
                protocol_version,
                timestamp_ms,
            },
            txs: Vec::new(),
        }
    }
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/// Write `bytes` to `out`, prefixed by their length as a little-endian
/// `u32`.
///
/// Length prefixing is what makes the canonical encoding injective: without
/// it, `("a", "bc")` and `("ab", "c")` would produce the same byte stream.
#[inline]
fn write_len_prefixed(out: &mut Vec<u8>, bytes: &[u8]) {
    let len = bytes.len().min(u32::MAX as usize) as u32;
    out.extend_from_slice(&len.to_le_bytes());
    out.extend_from_slice(&bytes[..len as usize]);
}

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // ── Hash32 ─────────────────────────────────────────────────────────

    #[test]
    fn hash32_zero_is_all_zero() {
        let z = Hash32::zero();
        assert!(z.is_zero());
        assert_eq!(z.0, [0u8; 32]);
    }

    #[test]
    fn hash32_hex_roundtrip() {
        let mut bytes = [0u8; 32];
        for (i, b) in bytes.iter_mut().enumerate() {
            *b = (i * 7) as u8;
        }
        let h = Hash32(bytes);
        let hex = h.to_hex();
        assert_eq!(hex.len(), 64);
        let parsed = Hash32::from_hex(&hex).unwrap();
        assert_eq!(parsed, h);
        // With 0x prefix
        let with_prefix = alloc::format!("0x{}", hex);
        assert_eq!(Hash32::from_hex(&with_prefix).unwrap(), h);
    }

    #[test]
    fn hash32_from_hex_rejects_bad_length() {
        assert!(matches!(
            Hash32::from_hex("abcd"),
            Err(TypeError::InvalidLength { .. })
        ));
    }

    #[test]
    fn hash32_from_hex_rejects_bad_digit() {
        let bad = "z".repeat(64);
        assert!(matches!(
            Hash32::from_hex(&bad),
            Err(TypeError::InvalidHex(_))
        ));
    }

    #[test]
    fn hash32_from_slice_checks_length() {
        assert!(Hash32::from_slice(&[0u8; 31]).is_err());
        assert!(Hash32::from_slice(&[0u8; 32]).is_ok());
        assert!(Hash32::from_slice(&[0u8; 33]).is_err());
    }

    #[test]
    fn hash32_ordering_is_lexicographic() {
        let a = Hash32([0u8; 32]);
        let mut b_bytes = [0u8; 32];
        b_bytes[31] = 1;
        let b = Hash32(b_bytes);
        assert!(a < b);
    }

    // ── Tx ─────────────────────────────────────────────────────────────

    fn sample_tx(nonce: u64) -> Tx {
        Tx {
            from: "alice".into(),
            nonce,
            chain_id: 1,
            gas_limit: 21_000,
            max_fee_per_gas: 1,
            pubkey: alloc::vec![1u8; 32],
            payload: alloc::vec![0xAA; 8],
            signature: alloc::vec![2u8; 64],
        }
    }

    #[test]
    fn tx_validate_accepts_good_tx() {
        assert!(sample_tx(0).validate().is_ok());
    }

    #[test]
    fn tx_validate_rejects_empty_from() {
        let mut tx = sample_tx(0);
        tx.from.clear();
        assert!(tx.validate().is_err());
    }

    #[test]
    fn tx_validate_rejects_zero_gas_limit() {
        let mut tx = sample_tx(0);
        tx.gas_limit = 0;
        assert!(tx.validate().is_err());
    }

    #[test]
    fn tx_signing_bytes_changes_with_nonce() {
        let a = sample_tx(1).signing_bytes();
        let b = sample_tx(2).signing_bytes();
        assert_ne!(a, b);
    }

    #[test]
    fn tx_signing_bytes_excludes_signature() {
        let tx = sample_tx(1);
        let bytes = tx.signing_bytes();
        // The signature content is 64 bytes of 0x02. The signing bytes
        // must not contain it.
        assert!(!bytes.windows(64).any(|w| w.iter().all(|&b| b == 0x02)));
    }

    #[test]
    fn tx_signing_bytes_are_length_prefixed() {
        // If the length prefix were missing, swapping the `from` and
        // `pubkey` content would produce the same bytes. This test ensures
        // that is not the case.
        let mut a = sample_tx(1);
        a.from = "ab".into();
        a.pubkey = alloc::vec![0x01; 1];

        let mut b = sample_tx(1);
        b.from = "a".into();
        b.pubkey = alloc::vec![0x62, 0x01]; // ASCII 'b' then 0x01

        assert_ne!(a.signing_bytes(), b.signing_bytes());
    }

    // ── Block / BlockHeader ────────────────────────────────────────────

    fn sample_header(height: Height) -> BlockHeader {
        BlockHeader {
            height,
            round: 0,
            parent_id: Hash32([0x11; 32]),
            prev_state_root: Hash32([0x22; 32]),
            state_root: Hash32([0x33; 32]),
            tx_root: Hash32([0x44; 32]),
            receipts_root: Hash32([0x55; 32]),
            proposer_pk: alloc::vec![0xAB; 32],
            proposer_addr: "alice".into(),
            base_fee_per_gas: 1,
            gas_used: 100,
            gas_limit: 30_000_000,
            intrinsic_gas_used: 21_000,
            exec_gas_used: 0,
            vm_gas_used: 0,
            evm_gas_used: 0,
            chain_id: 1,
            protocol_version: 1,
            timestamp_ms: 1_700_000_000_000,
        }
    }

    fn sample_block(height: Height) -> Block {
        Block {
            header: sample_header(height),
            txs: alloc::vec![sample_tx(0)],
        }
    }

    #[test]
    fn block_id_is_deterministic() {
        let b = sample_block(2);
        assert_eq!(b.id(), b.id());
    }

    #[test]
    fn block_id_changes_with_gas_limit() {
        // Regression: the previous id() omitted gas_limit, so this test
        // would have failed before the canonical_bytes rewrite.
        let a = sample_block(2);
        let mut b = sample_block(2);
        b.header.gas_limit += 1;
        assert_ne!(a.id(), b.id());
    }

    #[test]
    fn block_id_changes_with_chain_id() {
        let a = sample_block(2);
        let mut b = sample_block(2);
        b.header.chain_id += 1;
        assert_ne!(a.id(), b.id());
    }

    #[test]
    fn block_id_changes_with_protocol_version() {
        let a = sample_block(2);
        let mut b = sample_block(2);
        b.header.protocol_version += 1;
        assert_ne!(a.id(), b.id());
    }

    #[test]
    fn block_id_resists_length_prefix_shift() {
        // Regression: without length prefixing, moving a byte from
        // `proposer_pk` to `proposer_addr` would keep the same id.
        let a = sample_block(2);
        let mut b = sample_block(2);
        b.header.proposer_pk = alloc::vec![0xAB; 31];
        b.header.proposer_addr = alloc::format!("alice{}", 0xAB as char);
        assert_ne!(a.id(), b.id());
    }

    #[test]
    fn block_encoded_len_is_nonzero_and_matches_id_input() {
        let b = sample_block(2);
        assert!(b.encoded_len() > 0);
        assert_eq!(b.encoded_len(), b.header.canonical_bytes().len());
    }

    #[test]
    fn block_validate_accepts_good_block() {
        assert!(sample_block(2).validate().is_ok());
    }

    #[test]
    fn block_validate_rejects_gas_used_over_limit() {
        let mut b = sample_block(2);
        b.header.gas_used = b.header.gas_limit + 1;
        assert!(b.validate().is_err());
    }

    #[test]
    fn block_validate_rejects_empty_proposer() {
        let mut b = sample_block(2);
        b.header.proposer_pk.clear();
        assert!(b.validate().is_err());
    }

    #[test]
    fn block_validate_rejects_zero_state_root() {
        let mut b = sample_block(2);
        b.header.state_root = Hash32::zero();
        assert!(b.validate().is_err());
    }

    #[test]
    fn block_validate_rejects_non_genesis_zero_parent() {
        let mut b = sample_block(2);
        b.header.parent_id = Hash32::zero();
        assert!(b.validate().is_err());
    }

    #[test]
    fn block_validate_allows_genesis_zero_parent() {
        let b = Block::genesis(
            1,
            1,
            Hash32([0x01; 32]),
            alloc::vec![0xAB; 32],
            "genesis".into(),
            1,
            30_000_000,
            0,
        );
        assert!(b.validate().is_ok());
        assert_eq!(b.header.height, 1);
    }

    #[test]
    fn block_validate_rejects_duplicate_sender_nonce() {
        let mut b = sample_block(2);
        b.txs = alloc::vec![sample_tx(0), sample_tx(0)];
        assert!(b.validate().is_err());
    }

    #[test]
    fn block_validate_allows_distinct_nonces() {
        let mut b = sample_block(2);
        b.txs = alloc::vec![sample_tx(0), sample_tx(1)];
        assert!(b.validate().is_ok());
    }

    // ── Receipt ────────────────────────────────────────────────────────

    #[test]
    fn receipt_validate_success_requires_no_error() {
        let r = Receipt {
            tx_hash: Hash32([0xAA; 32]),
            success: true,
            gas_used: 21_000,
            intrinsic_gas_used: 21_000,
            exec_gas_used: 0,
            vm_gas_used: 0,
            evm_gas_used: 0,
            effective_gas_price: 1,
            burned: 0,
            tip: 0,
            error: None,
            data: None,
            logs: Vec::new(),
            output: Vec::new(),
        };
        assert!(r.validate().is_ok());
    }

    #[test]
    fn receipt_validate_rejects_success_with_error() {
        let r = Receipt {
            tx_hash: Hash32::zero(),
            success: true,
            gas_used: 0,
            intrinsic_gas_used: 0,
            exec_gas_used: 0,
            vm_gas_used: 0,
            evm_gas_used: 0,
            effective_gas_price: 0,
            burned: 0,
            tip: 0,
            error: Some("boom".into()),
            data: None,
            logs: Vec::new(),
            output: Vec::new(),
        };
        assert!(r.validate().is_err());
    }

    #[test]
    fn receipt_validate_rejects_phase_sum_over_total() {
        let r = Receipt {
            tx_hash: Hash32::zero(),
            success: true,
            gas_used: 100,
            intrinsic_gas_used: 60,
            exec_gas_used: 60,
            vm_gas_used: 0,
            evm_gas_used: 0,
            effective_gas_price: 0,
            burned: 0,
            tip: 0,
            error: None,
            data: None,
            logs: Vec::new(),
            output: Vec::new(),
        };
        assert!(r.validate().is_err());
    }

    // ── Log ────────────────────────────────────────────────────────────

    #[test]
    fn log_address_hex_is_40_chars() {
        let l = Log {
            address: [0xAB; 20],
            topics: Vec::new(),
            data: Vec::new(),
        };
        assert_eq!(l.address_hex().len(), 40);
        assert!(l.address_hex().chars().all(|c| c.is_ascii_hexdigit()));
    }
}
