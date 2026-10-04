//! Cryptographic primitives for consensus: signing and verification.
//!
//! # Overview
//!
//! This module defines the [`Signer`] and [`Verifier`] traits that consensus
//! uses to authenticate proposals and votes, together with a concrete
//! [`EcdsaSigner`]/[`EcdsaVerifier`] pair backed by the real RFC 6979
//! ECDSA P-256 implementation in [`crate::net::tls::ecdsa`].
//!
//! # Production use
//!
//! The reference signer stores the private scalar in process memory and is
//! therefore gated behind `cfg(any(test, feature = "dev-signing"))`. A
//! production deployment must obtain its signatures from an HSM (see
//! `crate::security::hsm`), which implements [`Signer`] without ever
//! exposing key material to this crate. The [`Verifier`] trait is always
//! available and is what consensus uses on the hot path.
//!
//! # Error handling
//!
//! All fallible operations return a structured [`CryptoError`] rather than
//! the stringly-typed `Err(())` that the verifier trait previously used.
//! The trait signatures have been widened to `Result<(), CryptoError>`;
//! callers that only care about success/failure can match on `.is_ok()`.
//!
//! # Constant-time comparison
//!
//! [`poly1305_verify`] uses a branch-free comparison to avoid leaking the
//! number of matching bytes through timing side channels.

use alloc::string::String;
use alloc::vec::Vec;
use thiserror::Error;

// -----------------------------------------------------------------------------
// Errors
// -----------------------------------------------------------------------------

/// Errors returned by the cryptographic primitives in this module.
///
/// Every variant is `Clone + PartialEq + Eq` so callers can match on the
/// failure reason without allocating.
#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum CryptoError {
    /// The public key is structurally invalid (wrong length, wrong SEC
    /// prefix, or represents the point at infinity).
    #[error("invalid public key: {0}")]
    InvalidPublicKey(String),

    /// The private scalar is zero or not in `[1, n-1]` for the curve.
    #[error("invalid private scalar")]
    InvalidPrivateScalar,

    /// The signature has the wrong length or fails the curve's canonical
    /// `(r, s)` range check.
    #[error("malformed signature")]
    MalformedSignature,

    /// The signature is structurally well-formed but cryptographically
    /// invalid for the given key/message pair.
    #[error("signature verification failed")]
    SignatureVerificationFailed,

    /// The Poly1305 tag did not match.
    #[error("poly1305 authentication tag mismatch")]
    Poly1305Mismatch,

    /// The Poly1305 key length was wrong.
    #[error("poly1305 key must be exactly 32 bytes, got {0}")]
    Poly1305BadKeyLength(usize),

    /// The underlying backend reported an error.
    #[error("backend error: {0}")]
    Backend(String),
}

/// Convenience alias.
pub type CryptoResult<T> = Result<T, CryptoError>;

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/// SEC1-encoded compressed public key (`0x02`/`0x03 || X`, 33 bytes) for
/// ECDSA P-256, or a raw public key for other schemes.
///
/// The byte length is not enforced by the type itself because the trait is
/// also used for Ed25519 (32-byte keys) and future schemes; individual
/// verifiers validate the length they expect.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord,
         serde::Serialize, serde::Deserialize)]
pub struct PublicKeyBytes(pub Vec<u8>);

impl PublicKeyBytes {
    /// Interpret the key as a SEC1 compressed P-256 point.
    ///
    /// Returns the X-coordinate bytes and whether Y is odd.
    pub fn as_p256_compressed(&self) -> CryptoResult<(&[u8], bool)> {
        if self.0.len() != 33 {
            return Err(CryptoError::InvalidPublicKey(alloc::format!(
                "expected 33 bytes, got {}", self.0.len()
            )));
        }
        let prefix = self.0[0];
        let odd = match prefix {
            0x02 => false,
            0x03 => true,
            _ => {
                return Err(CryptoError::InvalidPublicKey(alloc::format!(
                    "bad SEC1 prefix 0x{:02x}", prefix
                )));
            }
        };
        Ok((&self.0[1..], odd))
    }
}

// -----------------------------------------------------------------------------
// Traits
// -----------------------------------------------------------------------------

/// A signing key.
///
/// Implementations must be thread-safe. This trait is deliberately narrow:
/// it exposes only the public key and a signing operation, so an HSM-backed
/// signer can be substituted for the in-memory reference implementation
/// without touching call sites.
pub trait Signer: Send + Sync {
    /// The public key corresponding to this signer's private key.
    fn public_key(&self) -> PublicKeyBytes;

    /// Sign `msg` and return the signature bytes.
    ///
    /// The signature layout is scheme-specific:
    /// - ECDSA P-256: 64 bytes, `r || s`, both big-endian.
    /// - Ed25519:    64 bytes, `R || s`.
    ///
    /// The reference implementations never fail for valid inputs; the
    /// `Result` is here so that HSM-backed signers can report transient
    /// errors without changing the trait.
    fn sign(&self, msg: &[u8]) -> CryptoResult<Vec<u8>>;
}

/// A signature verifier.
///
/// Verification is stateless, so the trait has no `&self` receiver — this
/// matches the original API and lets callers write
/// `MyVerifier::verify(pk, msg, sig)` without constructing a value.
pub trait Verifier: Send + Sync {
    /// Verify that `sig` is a valid signature over `msg` by the holder of
    /// `pk`.
    fn verify(pk: &PublicKeyBytes, msg: &[u8], sig: &[u8]) -> CryptoResult<()>;
}

// -----------------------------------------------------------------------------
// ECDSA P-256 signer / verifier
// -----------------------------------------------------------------------------

/// In-memory ECDSA P-256 signer using RFC 6979 deterministic nonces.
///
/// # Feature gate
///
/// Compiled only under `test` or the `dev-signing` feature, because it
/// keeps the private scalar in process memory. Production builds must use
/// an HSM-backed [`Signer`].
#[cfg(any(test, feature = "dev-signing"))]
pub struct EcdsaSigner {
    /// Cached SEC1-compressed public key.
    pk: PublicKeyBytes,
    /// Private scalar, big-endian, 32 bytes.
    sk: [u8; 32],
}

#[cfg(any(test, feature = "dev-signing"))]
impl EcdsaSigner {
    /// Construct a signer from a 32-byte big-endian private scalar.
    ///
    /// Returns [`CryptoError::InvalidPrivateScalar`] if the scalar is zero
    /// or, as a sanity check, if the derived public key is the point at
    /// infinity (which would indicate an out-of-range scalar).
    pub fn new(sk: [u8; 32]) -> CryptoResult<Self> {
        if sk.iter().all(|&b| b == 0) {
            return Err(CryptoError::InvalidPrivateScalar);
        }

        let pk_bytes = derive_p256_public_key(&sk)?;
        Ok(Self { pk: PublicKeyBytes(pk_bytes), sk })
    }

    /// Expose the raw private scalar.
    ///
    /// This is intentionally explicit (rather than a `pub` field) so that
    /// audit tools can grep for it. Production code should not call it.
    pub fn expose_scalar(&self) -> &[u8; 32] {
        &self.sk
    }
}

#[cfg(any(test, feature = "dev-signing"))]
impl Signer for EcdsaSigner {
    fn public_key(&self) -> PublicKeyBytes {
        self.pk.clone()
    }

    fn sign(&self, msg: &[u8]) -> CryptoResult<Vec<u8>> {
        let hash = crate::consensus::engine::sha256_hash(msg);
        let sig = crate::net::tls::ecdsa::p256_sign(&self.sk, &hash);
        if sig.len() != 64 {
            return Err(CryptoError::Backend(alloc::format!(
                "p256_sign returned {} bytes, expected 64", sig.len()
            )));
        }
        Ok(sig)
    }
}

/// Verify ECDSA P-256 signatures produced by [`EcdsaSigner`] (or any other
/// RFC 6979 P-256 signer using the same message-hash convention).
pub struct EcdsaVerifier;

impl Verifier for EcdsaVerifier {
    fn verify(pk: &PublicKeyBytes, msg: &[u8], sig: &[u8]) -> CryptoResult<()> {
        // Structural checks first, so a malformed input never reaches the
        // curve arithmetic.
        let (x_bytes, odd) = pk.as_p256_compressed()?;
        if sig.len() != 64 {
            return Err(CryptoError::MalformedSignature);
        }
        // The X coordinate must be exactly 32 bytes (SEC1 compressed form).
        let x: [u8; 32] = x_bytes
            .try_into()
            .map_err(|_| CryptoError::InvalidPublicKey("X is not 32 bytes".into()))?;

        let hash = crate::consensus::engine::sha256_hash(msg);

        // Reconstruct the point from the compressed form and verify.
        // `p256_verify_compressed` is expected to decompress (X, odd) to a
        // point, reject points at infinity, and run the standard ECDSA
        // verify. See `net::tls::ecdsa` for the implementation.
        if crate::net::tls::ecdsa::p256_verify_compressed(&x, odd, &hash, sig) {
            Ok(())
        } else {
            Err(CryptoError::SignatureVerificationFailed)
        }
    }
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

/// Derive a SEC1-compressed P-256 public key from a big-endian private
/// scalar.
#[cfg(any(test, feature = "dev-signing"))]
fn derive_p256_public_key(sk: &[u8; 32]) -> CryptoResult<Vec<u8>> {
    use crate::net::tls::ecdsa;

    let g = ecdsa::Point::g();
    let scalar = ecdsa::bytes_to_u256(sk);
    let q = g.mul_scalar(&scalar);

    if q.infinity {
        // Scalar was out of range; the caller should treat this as an
        // invalid key rather than silently substituting a hash.
        return Err(CryptoError::InvalidPrivateScalar);
    }

    // Compressed SEC1 encoding: prefix || X, where prefix encodes the
    // parity of Y.
    let prefix = if q.y[0] & 1 == 0 { 0x02u8 } else { 0x03u8 };
    let mut out = alloc::vec![0u8; 33];
    out[0] = prefix;
    ecdsa::u256_to_bytes(&q.x, &mut out[1..]);
    Ok(out)
}

// -----------------------------------------------------------------------------
// Poly1305
// -----------------------------------------------------------------------------

/// Compute a Poly1305 tag over `payload` with `key`.
///
/// The key must be 32 bytes. This is the raw one-shot variant; the caller
/// is responsible for deriving the per-message key via the AEAD scheme
/// (e.g. ChaCha20-Poly1305) that this module's caller uses.
pub fn poly1305_sign(payload: &[u8], key: &[u8; 32]) -> [u8; 16] {
    crate::fs::encrypted_storage::poly1305_sign_raw(payload, key)
}

/// Verify a Poly1305 tag in constant time.
///
/// Returns `Ok(())` if the tag matches, `Err(CryptoError::Poly1305Mismatch)`
/// otherwise. The comparison is branch-free so that the number of matching
/// bytes is not observable through timing.
pub fn poly1305_verify(payload: &[u8], key: &[u8; 32], tag: &[u8; 16]) -> CryptoResult<()> {
    let computed = poly1305_sign(payload, key);
    // Fold XOR of every byte into a single accumulator; the result is zero
    // iff all bytes matched. No early exit, no data-dependent branches.
    let diff = computed
        .iter()
        .zip(tag.iter())
        .fold(0u8, |acc, (&a, &b)| acc | (a ^ b));
    // `diff == 0` still involves a comparison, but it is a single
    // data-independent compare on a value that is already the fold of all
    // bytes, so timing does not reveal which byte differed.
    if diff == 0 {
        Ok(())
    } else {
        Err(CryptoError::Poly1305Mismatch)
    }
}

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn public_key_rejects_wrong_length() {
        let pk = PublicKeyBytes(vec![0x02; 10]);
        assert!(matches!(
            pk.as_p256_compressed(),
            Err(CryptoError::InvalidPublicKey(_))
        ));
    }

    #[test]
    fn public_key_rejects_bad_prefix() {
        let mut bytes = vec![0u8; 33];
        bytes[0] = 0x04; // uncompressed prefix, invalid here
        let pk = PublicKeyBytes(bytes);
        assert!(matches!(
            pk.as_p256_compressed(),
            Err(CryptoError::InvalidPublicKey(_))
        ));
    }

    #[test]
    fn public_key_accepts_valid_prefixes() {
        for prefix in [0x02u8, 0x03] {
            let mut bytes = vec![0u8; 33];
            bytes[0] = prefix;
            let pk = PublicKeyBytes(bytes);
            let (x, odd) = pk.as_p256_compressed().unwrap();
            assert_eq!(x.len(), 32);
            assert_eq!(odd, prefix == 0x03);
        }
    }

    #[cfg(any(test, feature = "dev-signing"))]
    #[test]
    fn ecdsa_signer_rejects_zero_scalar() {
        let err = EcdsaSigner::new([0u8; 32]).unwrap_err();
        assert_eq!(err, CryptoError::InvalidPrivateScalar);
    }

    #[cfg(any(test, feature = "dev-signing"))]
    #[test]
    fn ecdsa_sign_verify_roundtrip() {
        // A small, deterministic scalar (still in range for P-256).
        let mut sk = [0u8; 32];
        sk[31] = 0x42;
        let signer = EcdsaSigner::new(sk).unwrap();
        let pk = signer.public_key();
        assert_eq!(pk.0.len(), 33);

        let msg = b"iona consensus test message";
        let sig = signer.sign(msg).unwrap();
        assert_eq!(sig.len(), 64);

        EcdsaVerifier::verify(&pk, msg, &sig).expect("valid signature must verify");
    }

    #[cfg(any(test, feature = "dev-signing"))]
    #[test]
    fn ecdsa_verify_rejects_tampered_message() {
        let mut sk = [0u8; 32];
        sk[31] = 0x01;
        let signer = EcdsaSigner::new(sk).unwrap();
        let pk = signer.public_key();
        let sig = signer.sign(b"hello").unwrap();
        let err = EcdsaVerifier::verify(&pk, b"goodbye", &sig).unwrap_err();
        assert_eq!(err, CryptoError::SignatureVerificationFailed);
    }

    #[cfg(any(test, feature = "dev-signing"))]
    #[test]
    fn ecdsa_verify_rejects_malformed_sig() {
        let pk = PublicKeyBytes({
            let mut v = vec![0u8; 33];
            v[0] = 0x02;
            v
        });
        let err = EcdsaVerifier::verify(&pk, b"x", &[0u8; 10]).unwrap_err();
        assert_eq!(err, CryptoError::MalformedSignature);
    }

    #[test]
    fn poly1305_roundtrip() {
        let key = [0x11u8; 32];
        let msg = b"authenticated payload";
        let tag = poly1305_sign(msg, &key);
        poly1305_verify(msg, &key, &tag).expect("valid tag must verify");
    }

    #[test]
    fn poly1305_rejects_tampered_payload() {
        let key = [0x11u8; 32];
        let tag = poly1305_sign(b"original", &key);
        let err = poly1305_verify(b"tampered", &key, &tag).unwrap_err();
        assert_eq!(err, CryptoError::Poly1305Mismatch);
    }

    #[test]
    fn poly1305_rejects_tampered_tag() {
        let key = [0x11u8; 32];
        let mut tag = poly1305_sign(b"payload", &key);
        tag[0] ^= 0xFF;
        let err = poly1305_verify(b"payload", &key, &tag).unwrap_err();
        assert_eq!(err, CryptoError::Poly1305Mismatch);
    }
}
