//! Zero-knowledge execution prover — pluggable backend.
//!
//! Provides the on-chain interface for producing (and verifying) proofs of
//! correct execution of a block: given a pre-state, a post-state, and a
//! witness derived from the block's transactions, the prover outputs a
//! succinct proof that the state transition is valid.
//!
//! # Backends
//!
//! The module is intentionally backend-agnostic. A `ProverBackend` is any
//! type that can produce (and, if it supports it, verify) an
//! [`ExecutionProof`]. The default backend is [`StubBackend`], which is a
//! **development-only placeholder**: it emits a deterministic, fixed-size
//! byte string that is *not* a real cryptographic proof. Production builds
//! must install a real backend via [`set_backend`] (see the `real-prover`
//! feature flag for the arkworks/Groth16 integration).
//!
//! # Safety
//!
//! Because [`StubBackend`] produces a proof that any caller could trivially
//! forge, [`generate_execution_proof`] refuses to run against a stub backend
//! when the `production` feature is enabled. This prevents shipping a
//! consensus-critical component that accidentally accepts fake proofs.
//!
//! # Example
//!
//! ```ignore
//! use crate::zk::prover::{
//!     generate_execution_proof, verify_execution_proof,
//!     ExecutionWitness, CircuitPublicInputs, ProverError,
//! };
//!
//! let witness = ExecutionWitness {
//!     block_height: 42,
//!     state_root_pre: [0x11; 32],
//!     state_root_post: [0x22; 32],
//! };
//! let inputs = CircuitPublicInputs { state_root_post: [0x22; 32] };
//!
//! let proof = generate_execution_proof(&witness, &inputs)?;
//! assert!(verify_execution_proof(&proof, &inputs)?);
//! # Ok::<(), ProverError>(())
//! ```

use alloc::string::String;
use alloc::vec::Vec;
use core::sync::atomic::{AtomicU64, Ordering};
use core::time::Duration;

// `crate::gui::services::stats` is retained for the GUI metric surface that
// downstream consumers already depend on. It is currently unused in this
// module but must not be removed without auditing the GUI code path.
#[allow(unused_imports)]
use crate::gui::services::stats;

use thiserror::Error;

// -----------------------------------------------------------------------------
// Errors
// -----------------------------------------------------------------------------

/// Errors returned by the proving and verification pipeline.
#[derive(Debug, Error)]
pub enum ProverError {
    /// The witness is internally inconsistent with itself or with the public
    /// inputs (for example, the post-state root in the witness does not match
    /// the one in the public inputs).
    #[error("constraint violation: {0}")]
    ConstraintViolation(String),

    /// No proving key was loaded, or the configured backend has not been
    /// initialised.
    #[error("proving key not loaded")]
    NoProvingKey,

    /// Witness generation failed (malformed block, missing transaction
    /// receipts, or an execution trace that could not be serialised).
    #[error("witness generation failed")]
    WitnessError,

    /// A verification request was made against a proof produced by a
    /// different backend, a different circuit version, or a different
    /// block height.
    #[error("proof rejected: {0}")]
    VerificationFailed(String),

    /// The block height is invalid (zero, or above the configured tip).
    #[error("invalid block height: {0}")]
    InvalidBlockHeight(u64),

    /// The `proof_bytes` field was empty on a proof that claims to be a
    /// real cryptographic proof.
    #[error("proof is empty")]
    EmptyProof,

    /// The backend itself reported an internal error.
    #[error("backend error: {0}")]
    Backend(String),

    /// The current build does not permit use of the stub backend (for
    /// example, in a production consensus build).
    #[error("stub backend disabled in production builds")]
    StubDisabledInProduction,
}

/// Convenience alias.
pub type ProverResult<T> = Result<T, ProverError>;

// -----------------------------------------------------------------------------
// Witness and public inputs
// -----------------------------------------------------------------------------

/// The private execution witness: everything the prover needs that is not
/// exposed on chain.
///
/// The exact contents depend on the circuit. The current shape captures the
/// minimal information required to establish that "the state root moved from
/// `state_root_pre` to `state_root_post` at block `block_height`", which is
/// what the on-chain verifier checks.
#[derive(Debug, Clone)]
pub struct ExecutionWitness {
    /// Height of the block whose transition is being proven.
    pub block_height: u64,
    /// State root before the block executed.
    pub state_root_pre: [u8; 32],
    /// State root after the block executed.
    pub state_root_post: [u8; 32],
}

/// The public inputs the verifier will see.
///
/// These are bound to the proof; a proof produced for one set of public
/// inputs cannot be reused with a different set.
#[derive(Debug, Clone)]
pub struct CircuitPublicInputs {
    /// The post-state root committed to by the proof. Must equal
    /// `ExecutionWitness::state_root_post`.
    pub state_root_post: [u8; 32],
}

/// A succinct proof that the block at `block_height` correctly transitioned
/// the chain state to `public_inputs.state_root_post`.
#[derive(Debug, Clone)]
pub struct ExecutionProof {
    /// Height of the block whose execution is being attested.
    pub block_height: u64,
    /// Public inputs the proof is bound to.
    pub public_inputs: CircuitPublicInputs,
    /// Opaque proof bytes. Layout is backend-specific.
    pub proof_bytes: Vec<u8>,
    /// Wall-clock time spent generating the proof, in milliseconds.
    pub prove_time_ms: u64,
}

// -----------------------------------------------------------------------------
// Backend trait
// -----------------------------------------------------------------------------

/// A proving backend.
///
/// Implementations are expected to be `Send + Sync` and cheap to call
/// repeatedly; the proving pipeline itself is synchronous, so the backend
/// should not block for long periods without a reason.
pub trait ProverBackend: Send + Sync + 'static {
    /// Human-readable backend identifier, used in diagnostics and metrics.
    fn name(&self) -> &'static str;

    /// Whether the backend produces real cryptographic proofs.
    ///
    /// The pipeline uses this to refuse to operate in production builds
    /// against a stub backend.
    fn is_real(&self) -> bool;

    /// Generate a proof for `witness` and bind it to `inputs`.
    fn prove(
        &self,
        witness: &ExecutionWitness,
        inputs: &CircuitPublicInputs,
    ) -> ProverResult<Vec<u8>>;

    /// Verify `proof_bytes` against `inputs` for the given block height.
    ///
    /// Backends that do not support in-process verification may return
    /// `Ok(true)` only when they are certain the proof is valid; a `false`
    /// result must be returned for any proof that cannot be verified. The
    /// default implementation returns an error so that misconfigured
    /// backends fail loudly rather than silently accepting everything.
    fn verify(
        &self,
        _proof_bytes: &[u8],
        _inputs: &CircuitPublicInputs,
        _block_height: u64,
    ) -> ProverResult<bool> {
        Err(ProverError::Backend(format!(
            "backend '{}' does not implement verify()",
            self.name()
        )))
    }
}

// -----------------------------------------------------------------------------
// Stub backend
// -----------------------------------------------------------------------------

/// Development-only stub backend.
///
/// Produces a deterministic 32-byte tag derived from the witness and public
/// inputs. The tag is **not** a cryptographic proof; it only exists so that
/// downstream code paths (serialization, storage, RPC) can be exercised
/// end-to-end without a real proving key.
pub struct StubBackend;

impl ProverBackend for StubBackend {
    fn name(&self) -> &'static str {
        "stub"
    }

    fn is_real(&self) -> bool {
        false
    }

    fn prove(
        &self,
        witness: &ExecutionWitness,
        inputs: &CircuitPublicInputs,
    ) -> ProverResult<Vec<u8>> {
        // Deterministic "proof" for development: chain height || pre || post.
        let mut tag = [0u8; 32];
        tag[0..8].copy_from_slice(&witness.block_height.to_le_bytes());
        tag[8..24].copy_from_slice(&witness.state_root_pre[0..16]);
        tag[16..32].copy_from_slice(&inputs.state_root_post[0..16]);
        Ok(tag.to_vec())
    }

    fn verify(
        &self,
        proof_bytes: &[u8],
        inputs: &CircuitPublicInputs,
        _block_height: u64,
    ) -> ProverResult<bool> {
        // The stub cannot verify anything; it can only check structural
        // shape so that obviously wrong inputs fail early.
        if proof_bytes.is_empty() {
            return Ok(false);
        }
        if proof_bytes.len() != 32 {
            return Ok(false);
        }
        // A real proof binds the block height and pre-state, which the stub
        // does not have access to here. Return an explicit error so callers
        // do not mistakenly trust a "true" from a stub verifier.
        Err(ProverError::VerificationFailed(format!(
            "stub backend cannot verify a proof for inputs {}",
            hex_prefix(&inputs.state_root_post)
        )))
    }
}

fn hex_prefix(bytes: &[u8; 32]) -> String {
    let mut s = String::with_capacity(8);
    for &b in &bytes[..4] {
        s.push(core::char::from_digit((b >> 4) as u32, 16).unwrap_or('?'));
        s.push(core::char::from_digit((b & 0x0F) as u32, 16).unwrap_or('?'));
    }
    s
}

// -----------------------------------------------------------------------------
// Backend installation
// -----------------------------------------------------------------------------

use spin::Mutex;

/// The active backend. `None` means "not yet installed" — the pipeline will
/// install [`StubBackend`] on first use, unless the `production` feature is
/// enabled, in which case it returns [`ProverError::NoProvingKey`].
static BACKEND: Mutex<Option<&'static dyn ProverBackend>> = Mutex::new(None);

/// Install a backend. Intended to be called once during node startup.
///
/// Returns an error if a backend is already installed.
pub fn set_backend(backend: &'static dyn ProverBackend) -> ProverResult<()> {
    let mut slot = BACKEND.lock();
    if slot.is_some() {
        return Err(ProverError::Backend("backend already installed".into()));
    }
    *slot = Some(backend);
    crate::klog_info!("zk::prover: backend installed: {}", backend.name());
    Ok(())
}

/// Return the currently installed backend, if any.
pub fn backend() -> Option<&'static dyn ProverBackend> {
    *BACKEND.lock()
}

/// Ensure a backend is available, installing the stub if the caller has not
/// already provided one. In production builds this returns `NoProvingKey`
/// instead of silently falling back to the stub.
fn ensure_backend() -> ProverResult<&'static dyn ProverBackend> {
    let mut slot = BACKEND.lock();
    if let Some(b) = *slot {
        return Ok(b);
    }

    #[cfg(feature = "production")]
    {
        return Err(ProverError::NoProvingKey);
    }

    #[cfg(not(feature = "production"))]
    {
        static STUB: StubBackend = StubBackend;
        *slot = Some(&STUB);
        Ok(&STUB)
    }
}

// -----------------------------------------------------------------------------
// Metrics
// -----------------------------------------------------------------------------

/// Atomic counters for the proving pipeline.
#[derive(Debug, Default)]
pub struct ProverMetrics {
    pub proofs_generated: AtomicU64,
    pub proofs_verified: AtomicU64,
    pub verification_failures: AtomicU64,
    pub total_prove_time_ms: AtomicU64,
}

static METRICS: ProverMetrics = ProverMetrics {
    proofs_generated: AtomicU64::new(0),
    proofs_verified: AtomicU64::new(0),
    verification_failures: AtomicU64::new(0),
    total_prove_time_ms: AtomicU64::new(0),
};

/// Snapshot of prover metrics.
#[derive(Debug, Clone, Copy, Default)]
pub struct ProverMetricsSnapshot {
    pub proofs_generated: u64,
    pub proofs_verified: u64,
    pub verification_failures: u64,
    pub total_prove_time_ms: u64,
}

/// Read a snapshot of the prover metrics.
pub fn metrics() -> ProverMetricsSnapshot {
    ProverMetricsSnapshot {
        proofs_generated: METRICS.proofs_generated.load(Ordering::Relaxed),
        proofs_verified: METRICS.proofs_verified.load(Ordering::Relaxed),
        verification_failures: METRICS.verification_failures.load(Ordering::Relaxed),
        total_prove_time_ms: METRICS.total_prove_time_ms.load(Ordering::Relaxed),
    }
}

// -----------------------------------------------------------------------------
// Validation
// -----------------------------------------------------------------------------

/// Validate that the witness and public inputs are internally consistent.
///
/// The checks here are intentionally cheap and backend-independent; a real
/// circuit will perform many more checks, but these catch the most common
/// programmer errors before the prover is invoked.
pub fn validate(
    witness: &ExecutionWitness,
    inputs: &CircuitPublicInputs,
) -> ProverResult<()> {
    if witness.block_height == 0 {
        return Err(ProverError::InvalidBlockHeight(0));
    }
    if witness.state_root_post != inputs.state_root_post {
        return Err(ProverError::ConstraintViolation(format!(
            "witness.post_state_root ({}) != inputs.state_root_post ({})",
            hex_prefix(&witness.state_root_post),
            hex_prefix(&inputs.state_root_post),
        )));
    }
    // A block that claims to change the state root must actually change it.
    // (Empty blocks are allowed to leave the root unchanged, but the caller
    //  must then mark the witness as a "no-op" — which the current schema
    //  does not support. This is a guard against a whole class of programmer
    //  errors where an empty witness is submitted as if it were a real
    //  transition.)
    if witness.state_root_pre == witness.state_root_post {
        return Err(ProverError::ConstraintViolation(
            "pre-state and post-state roots are identical; \
             a real execution must change the state root"
                .into(),
        ));
    }
    Ok(())
}

// -----------------------------------------------------------------------------
// Public entry points
// -----------------------------------------------------------------------------

/// Generate an execution proof for `witness`, bound to `inputs`.
///
/// # Errors
/// - [`ProverError::InvalidBlockHeight`] if `block_height == 0`.
/// - [`ProverError::ConstraintViolation`] if the witness and public inputs
///   disagree, or if the pre- and post-state roots are identical.
/// - [`ProverError::NoProvingKey`] if no backend is installed and the
///   `production` feature is enabled.
/// - [`ProverError::Backend`] for any backend-specific failure.
pub fn generate_execution_proof(
    witness: &ExecutionWitness,
    inputs: &CircuitPublicInputs,
) -> ProverResult<ExecutionProof> {
    validate(witness, inputs)?;

    let backend = ensure_backend()?;

    #[cfg(feature = "production")]
    if !backend.is_real() {
        return Err(ProverError::StubDisabledInProduction);
    }

    let start = crate::arch::uptime_ms();
    let proof_bytes = backend.prove(witness, inputs)?;
    let elapsed_ms = crate::arch::uptime_ms().saturating_sub(start);

    if proof_bytes.is_empty() {
        return Err(ProverError::EmptyProof);
    }

    METRICS.proofs_generated.fetch_add(1, Ordering::Relaxed);
    METRICS
        .total_prove_time_ms
        .fetch_add(elapsed_ms, Ordering::Relaxed);

    crate::klog_debug!(
        "zk::prover: generated {} B proof for height {} in {} ms (backend={})",
        proof_bytes.len(),
        witness.block_height,
        elapsed_ms,
        backend.name(),
    );

    Ok(ExecutionProof {
        block_height: witness.block_height,
        public_inputs: inputs.clone(),
        proof_bytes,
        prove_time_ms: elapsed_ms,
    })
}

/// Verify an execution proof against the expected public inputs.
///
/// # Errors
/// - [`ProverError::EmptyProof`] if `proof.proof_bytes` is empty.
/// - [`ProverError::VerificationFailed`] if the proof is rejected.
/// - [`ProverError::Backend`] if the backend cannot verify.
pub fn verify_execution_proof(
    proof: &ExecutionProof,
    expected_inputs: &CircuitPublicInputs,
) -> ProverResult<bool> {
    if proof.proof_bytes.is_empty() {
        METRICS.verification_failures.fetch_add(1, Ordering::Relaxed);
        return Err(ProverError::EmptyProof);
    }

    // Cheap pre-check: the proof carries its own public inputs; they must
    // match the caller's expectation before we ever touch the backend.
    if proof.public_inputs.state_root_post != expected_inputs.state_root_post {
        METRICS.verification_failures.fetch_add(1, Ordering::Relaxed);
        return Err(ProverError::VerificationFailed(format!(
            "public inputs mismatch: proof {} vs expected {}",
            hex_prefix(&proof.public_inputs.state_root_post),
            hex_prefix(&expected_inputs.state_root_post),
        )));
    }

    let backend = ensure_backend()?;
    match backend.verify(&proof.proof_bytes, expected_inputs, proof.block_height) {
        Ok(true) => {
            METRICS.proofs_verified.fetch_add(1, Ordering::Relaxed);
            Ok(true)
        }
        Ok(false) => {
            METRICS.verification_failures.fetch_add(1, Ordering::Relaxed);
            Ok(false)
        }
        Err(e) => {
            METRICS.verification_failures.fetch_add(1, Ordering::Relaxed);
            Err(e)
        }
    }
}

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_witness() -> ExecutionWitness {
        ExecutionWitness {
            block_height: 42,
            state_root_pre: [0x11; 32],
            state_root_post: [0x22; 32],
        }
    }

    fn sample_inputs() -> CircuitPublicInputs {
        CircuitPublicInputs {
            state_root_post: [0x22; 32],
        }
    }

    #[test]
    fn validate_accepts_consistent_witness() {
        assert!(validate(&sample_witness(), &sample_inputs()).is_ok());
    }

    #[test]
    fn validate_rejects_zero_height() {
        let mut w = sample_witness();
        w.block_height = 0;
        assert!(matches!(
            validate(&w, &sample_inputs()),
            Err(ProverError::InvalidBlockHeight(0))
        ));
    }

    #[test]
    fn validate_rejects_mismatched_roots() {
        let w = sample_witness();
        let mut inp = sample_inputs();
        inp.state_root_post = [0x33; 32];
        assert!(matches!(
            validate(&w, &inp),
            Err(ProverError::ConstraintViolation(_))
        ));
    }

    #[test]
    fn validate_rejects_identical_pre_and_post() {
        let mut w = sample_witness();
        w.state_root_post = w.state_root_pre;
        let mut inp = sample_inputs();
        inp.state_root_post = w.state_root_post;
        assert!(matches!(
            validate(&w, &inp),
            Err(ProverError::ConstraintViolation(_))
        ));
    }

    #[test]
    fn stub_generates_deterministic_proof() {
        let backend = StubBackend;
        let a = backend.prove(&sample_witness(), &sample_inputs()).unwrap();
        let b = backend.prove(&sample_witness(), &sample_inputs()).unwrap();
        assert_eq!(a, b);
        assert_eq!(a.len(), 32);
    }

    #[test]
    fn stub_verify_refuses_to_claim_success() {
        let backend = StubBackend;
        let bytes = backend.prove(&sample_witness(), &sample_inputs()).unwrap();
        // The stub cannot truly verify; it must return an error rather
        // than silently returning true.
        assert!(backend
            .verify(&bytes, &sample_inputs(), 42)
            .is_err());
    }

    #[test]
    fn generate_execution_proof_rejects_bad_witness() {
        let mut w = sample_witness();
        w.block_height = 0;
        let err = generate_execution_proof(&w, &sample_inputs()).unwrap_err();
        assert!(matches!(err, ProverError::InvalidBlockHeight(0)));
    }

    #[test]
    fn generate_execution_proof_succeeds_with_stub() {
        // The stub backend is installed lazily on first use in non-production
        // builds, so this must succeed without an explicit `set_backend`.
        let proof = generate_execution_proof(&sample_witness(), &sample_inputs()).unwrap();
        assert_eq!(proof.block_height, 42);
        assert!(!proof.proof_bytes.is_empty());
        assert_eq!(proof.public_inputs.state_root_post, [0x22; 32]);
    }

    #[test]
    fn verify_rejects_empty_proof_bytes() {
        let mut proof = ExecutionProof {
            block_height: 42,
            public_inputs: sample_inputs(),
            proof_bytes: Vec::new(),
            prove_time_ms: 0,
        };
        let err = verify_execution_proof(&proof, &sample_inputs()).unwrap_err();
        assert!(matches!(err, ProverError::EmptyProof));
        // Ensure the fixture was not accidentally mutated.
        proof.proof_bytes.clear();
    }

    #[test]
    fn verify_rejects_mismatched_inputs_before_backend() {
        let proof = ExecutionProof {
            block_height: 42,
            public_inputs: sample_inputs(),
            proof_bytes: vec![0u8; 32],
            prove_time_ms: 0,
        };
        let mut wrong = sample_inputs();
        wrong.state_root_post = [0x33; 32];
        let err = verify_execution_proof(&proof, &wrong).unwrap_err();
        assert!(matches!(err, ProverError::VerificationFailed(_)));
    }

    #[test]
    fn metrics_snapshot_is_readable() {
        let snap = metrics();
        // We cannot assert exact values because other tests share the
        // global counters, but the call must not panic.
        let _ = snap.proofs_generated;
    }
}
