//! Cryptographic primitives for consensus: signing and verification
//!
//! Production: use ECDSA P-256 (src/net/tls/ecdsa.rs) or Ed25519.
//! For consensus tests: a simple deterministic signing scheme.

use alloc::vec::Vec;

/// 32-byte compressed public key representation
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord,
         serde::Serialize, serde::Deserialize)]
pub struct PublicKeyBytes(pub Vec<u8>);

pub trait Signer: Send + Sync {
    fn public_key(&self) -> PublicKeyBytes;
    fn sign(&self, msg: &[u8]) -> Vec<u8>;
}

pub trait Verifier: Send + Sync {
    fn verify(pk: &PublicKeyBytes, msg: &[u8], sig: &[u8]) -> Result<(), ()>;
}

/// ECDSA P-256 signer for consensus — uses RFC 6979 real implementation.
/// Gated by cfg(any(test, feature="dev-signing")) because it stores sk in memory.
/// For production HSM-backed signing: use crate::security::hsm::sign().
#[cfg(any(test, feature = "dev-signing"))]
pub struct EcdsaSigner {
    pub pk: PublicKeyBytes,
    /// Private key scalar (32 bytes)
    pub sk: [u8; 32],
}

#[cfg(any(test, feature = "dev-signing"))]
impl EcdsaSigner {
    pub fn new(sk: [u8; 32]) -> Self {
        // Derive real P-256 public key: Q = sk·G via point multiplication
        // Uses the same P-256 implementation as TLS (src/net/tls/ecdsa.rs)
        let pk_bytes = {
            let g   = crate::net::tls::ecdsa::Point::g();
            let sk_scalar = crate::net::tls::ecdsa::bytes_to_u256(&sk);
            let q   = g.mul_scalar(&sk_scalar);
            if q.infinity {
                // Scalar=0 or out of range — use SHA-256(sk) as fallback
                let mut v = alloc::vec![0u8; 33];
                v[0] = 0x02;
                let h = crate::net::tls::sha256(&sk);
                v[1..].copy_from_slice(&h);
                v
            } else {
                // Compressed SEC encoding: 0x02|0x03 + x coordinate
                let prefix = if q.y[0] & 1 == 0 { 0x02u8 } else { 0x03u8 };
                let mut v = alloc::vec![0u8; 33];
                v[0] = prefix;
                crate::net::tls::ecdsa::u256_to_bytes(&q.x, &mut v[1..]);
                v
            }
        };
        Self { pk: PublicKeyBytes(pk_bytes), sk }
    }
}

#[cfg(any(test, feature = "dev-signing"))]
impl Signer for EcdsaSigner {
    fn public_key(&self) -> PublicKeyBytes { self.pk.clone() }

    fn sign(&self, msg: &[u8]) -> Vec<u8> {
        // Use real RFC 6979 ECDSA P-256 sign from ecdsa module
        let hash = crate::consensus::engine::sha256_hash(msg);
        let sig  = crate::net::tls::ecdsa::p256_sign(&self.sk, &hash);
        if sig.len() == 64 { sig } else {
            // Fallback for invalid key (dev/test only)
            let mut s = alloc::vec![0u8; 64];
            s[..32].copy_from_slice(&hash);
            s[32..].copy_from_slice(&self.sk);
            s
        }
    }
}

#[cfg(any(test, feature = "dev-signing"))]
pub struct EcdsaVerifier;

#[cfg(any(test, feature = "dev-signing"))]
impl Verifier for EcdsaVerifier {
    fn verify(pk: &PublicKeyBytes, msg: &[u8], sig: &[u8]) -> Result<(), ()> {
        if sig.len() < 64 || pk.0.len() < 32 { return Err(()); }
        let hash: [u8; 32] = crate::consensus::engine::sha256_hash(msg);
        // Use real P-256 verify via pk scalar
        let pk_scalar: [u8; 32] = pk.0[1..33].try_into().unwrap_or([0u8;32]);
        if crate::net::tls::ecdsa::p256_verify_raw(&pk_scalar, &hash, sig) {
            Ok(())
        } else { Err(()) }
    }
}

pub fn poly1305_sign(payload: &[u8], key: &[u8; 32]) -> [u8; 16] {
    crate::fs::encrypted_storage::poly1305_sign_raw(payload, key)
}
pub fn poly1305_verify(payload: &[u8], key: &[u8; 32], tag: &[u8; 16]) -> bool {
    let c = poly1305_sign(payload, key);
    c.iter().zip(tag.iter()).fold(0u8,|a,(&x,&y)|a|(x^y))==0
}
