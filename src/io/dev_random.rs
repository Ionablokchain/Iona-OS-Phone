//! /dev/random — entropy device backed by Exynos TRNG.
//! Provides cryptographically secure random bytes.
extern crate alloc;

pub struct DevRandom;

impl DevRandom {
    /// Read n random bytes from TRNG.
    pub fn read(n: usize) -> alloc::vec::Vec<u8> {
        let mut out = alloc::vec![0u8; n];
        let mut i = 0;
        while i + 8 <= n {
            let e = crate::drivers::trng::get_entropy_64();
            out[i..i+8].copy_from_slice(&e.to_le_bytes());
            i += 8;
        }
        while i < n {
            let e = crate::drivers::trng::get_entropy_64();
            out[i] = e as u8;
            i += 1;
        }
        out
    }

    /// Fill a byte slice with random data.
    pub fn fill(buf: &mut [u8]) {
        let rand = Self::read(buf.len());
        buf.copy_from_slice(&rand);
    }

    /// Get a random u64.
    pub fn u64() -> u64 { crate::drivers::trng::get_entropy_64() }

    /// Get a random u32.
    pub fn u32() -> u32 { Self::u64() as u32 }

    /// Get a random value in range [0, max).
    pub fn range(max: u64) -> u64 {
        if max == 0 { return 0; }
        // Rejection sampling for uniform distribution
        let threshold = u64::MAX - u64::MAX % max;
        loop {
            let v = Self::u64();
            if v < threshold { return v % max; }
        }
    }
}

/// Global random device handle.
pub static RNG: DevRandom = DevRandom;
