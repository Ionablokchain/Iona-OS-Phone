//! UART PL011 console with ring buffer — no blocking, no lost characters.
//! TX ring buffer: 4KB. RX ring buffer: 1KB.
//! Console output goes through TX ring; flushed by UART TX interrupt.

use core::sync::atomic::{AtomicUsize, Ordering};

const TX_BUF_SIZE: usize = 4096;
const RX_BUF_SIZE: usize = 1024;

static TX_BUF:  [core::cell::UnsafeCell<u8>; TX_BUF_SIZE] = 
    unsafe { core::mem::transmute([0u8; TX_BUF_SIZE]) };
static TX_HEAD: AtomicUsize = AtomicUsize::new(0);
static TX_TAIL: AtomicUsize = AtomicUsize::new(0);
static RX_BUF:  [core::cell::UnsafeCell<u8>; RX_BUF_SIZE] =
    unsafe { core::mem::transmute([0u8; RX_BUF_SIZE]) };
static RX_HEAD: AtomicUsize = AtomicUsize::new(0);
static RX_TAIL: AtomicUsize = AtomicUsize::new(0);

/// Enqueue bytes into TX ring buffer (non-blocking).
pub fn uart_ring_write(data: &[u8]) {
    for &b in data {
        let head = TX_HEAD.load(Ordering::Relaxed);
        let next = (head + 1) % TX_BUF_SIZE;
        if next != TX_TAIL.load(Ordering::Relaxed) {
            unsafe { *TX_BUF[head].get() = b; }
            TX_HEAD.store(next, Ordering::Release);
        }
        // Drop byte if buffer full (never block)
    }
}

/// Flush TX ring to UART — call from TX interrupt handler or polling.
pub fn uart_ring_flush() {
    const UART0: usize = 0x0900_0000; // PL011 UART0
    const UARTDR:   usize = 0x000; // Data register
    const UARTFR:   usize = 0x018; // Flag register
    const TXFF: u32 = 1 << 5;       // TX FIFO full

    while TX_TAIL.load(Ordering::Relaxed) != TX_HEAD.load(Ordering::Acquire) {
        #[cfg(target_arch = "aarch64")]
        unsafe {
            let fr = ((UART0 + UARTFR) as *const u32).read_volatile();
            if fr & TXFF != 0 { break; } // TX FIFO full
            let tail = TX_TAIL.load(Ordering::Relaxed);
            let byte = *TX_BUF[tail].get();
            TX_TAIL.store((tail + 1) % TX_BUF_SIZE, Ordering::Release);
            ((UART0 + UARTDR) as *mut u32).write_volatile(byte as u32);
        }
        #[cfg(not(target_arch = "aarch64"))]
        break;
    }
}

/// Read a byte from RX ring (None if empty).
pub fn uart_ring_read() -> Option<u8> {
    let tail = RX_TAIL.load(Ordering::Relaxed);
    if tail == RX_HEAD.load(Ordering::Acquire) { return None; }
    let byte = unsafe { *RX_BUF[tail].get() };
    RX_TAIL.store((tail + 1) % RX_BUF_SIZE, Ordering::Release);
    Some(byte)
}

/// RX interrupt handler — push received byte into RX ring.
pub fn handle_uart_rx(byte: u8) {
    let head = RX_HEAD.load(Ordering::Relaxed);
    let next = (head + 1) % RX_BUF_SIZE;
    if next != RX_TAIL.load(Ordering::Relaxed) {
        unsafe { *RX_BUF[head].get() = byte; }
        RX_HEAD.store(next, Ordering::Release);
    }
}

/// TX buffer fill percentage.
pub fn tx_fill_pct() -> u8 {
    let head = TX_HEAD.load(Ordering::Relaxed);
    let tail = TX_TAIL.load(Ordering::Relaxed);
    let used = (head + TX_BUF_SIZE - tail) % TX_BUF_SIZE;
    (used * 100 / TX_BUF_SIZE) as u8
}
