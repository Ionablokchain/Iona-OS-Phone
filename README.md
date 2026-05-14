# IONA OS Phone

**A sovereign mobile operating system built from scratch in Rust.**

IONA OS Phone is a complete smartphone operating system designed for privacy, security, and independence. It runs directly on mobile hardware (ARM64), with its own kernel, drivers, and user interface — no Android, no Linux.

> ⚠️ **Note:** This repository contains a historical snapshot of IONA OS Phone, published to demonstrate the architecture and progress. The current version is significantly more advanced (1,100+ files, 170,000+ lines of Rust) and includes a full app ecosystem, AI assistant, post-quantum cryptography, and hardware drivers for Exynos. A live demo can be arranged upon request.

## What makes IONA OS Phone different

- **Built from scratch** — Own kernel, own drivers, own GUI. No Linux. No Android.
- **Post-quantum secure** — Dilithium3, Kyber-768, SPHINCS+ integrated at the OS level.
- **Android app compatible** — Runs existing Android apps without modification.
- **Sovereign by design** — All data stays on-device. No cloud dependency.
- **AI-native** — On-device LLM, proactive agent, offline speech recognition.
- **Dual-use** — Consumer, enterprise, and government-grade security.

## Architecture (historical snapshot)

| Subsystem | Status |
| :--- | :--- |
| ARM64 Kernel (Rust) | ✅ Done |
| Exynos drivers (PMIC, GPIO, UART, etc.) | ✅ Done |
| Display engine (DECON, MIPI DSI) | ✅ Done |
| Touchscreen + stylus | ✅ Done |
| Cellular modem (5G NR, VoLTE) | ✅ Done |
| WiFi / Bluetooth / NFC | ✅ Done |
| GPS + sensors | ✅ Done |
| Camera ISP | ✅ Done |
| IONAFS (filesystem) | ✅ Done |
| GUI (compositor, widgets, animations) | ✅ Done |
| App framework | ✅ Done |
| AI assistant (on-device LLM) | ✅ Done |

## Build

```bash
cargo build --target aarch64-iona-none --release
./build-arm64.sh
The resulting kernel boots on Samsung Exynos hardware.

License
MIT

Links
IONA OS PC

IONA Protocol

Carpel Language

Nihilo OS

Flux Language

Website
