
# IONA OS Phone

**A sovereign mobile operating system built from scratch in Rust.**

IONA OS Phone is a complete smartphone operating system designed for privacy, security,
and independence. It runs directly on mobile hardware (ARM64), with its own kernel,
drivers, and user interface — no Android, no Linux. It is part of the IONA ecosystem,
which spans desktop, mobile, blockchain, AI, and custom programming languages.

> ⚠️ **Note:** This repository contains a historical snapshot of IONA OS Phone, published
> to demonstrate the architecture and progress. The current version is significantly
> more advanced (1,100+ files, 170,000+ lines of Rust) and includes a full app ecosystem,
> AI assistant, post-quantum cryptography, and hardware drivers for Exynos.
> A live demo can be arranged upon request.

---

## Why IONA OS Phone

| Differentiator | What it means |
| :--- | :--- |
| **Built from scratch** | Own kernel, own drivers, own GUI. No Linux. No Android. |
| **Post-quantum secure** | Dilithium3, Kyber-768, SPHINCS+ integrated at the OS level. |
| **Android app compatible** | Runs existing Android apps without modification. |
| **Sovereign by design** | All data stays on-device. No cloud dependency. |
| **AI-native** | On-device LLM, proactive agent, offline speech recognition. |
| **Dual-use** | Consumer, enterprise, and government-grade security. |

---

## Architecture (historical snapshot)

### Kernel & Core
| Subsystem | Status | Description |
| :--- | :--- | :--- |
| ARM64 Kernel | ✅ Done | Bare-metal Rust kernel, SMP, GICv3, MMU |
| Process Management | ✅ Done | Fork with COW, exec with ELF64, IPC, signals |
| Memory Management | ✅ Done | Buddy allocator, slab, mmap, ZRAM |
| Filesystem (IONAFS) | ✅ Done | Custom FS with WAL journaling, encryption |
| Scheduler | ✅ Done | EDF real-time + CFS, priority inheritance |

### Hardware Drivers
| Subsystem | Status | Description |
| :--- | :--- | :--- |
| Display (DECON, MIPI DSI) | ✅ Done | Framebuffer, vsync, panel power-on sequence |
| Touchscreen + Stylus | ✅ Done | Multi-touch, palm rejection, pressure sensitivity |
| Cellular Modem (5G NR) | ✅ Done | AT command queue, VoLTE, VoNR, dual SIM |
| WiFi / Bluetooth / NFC | ✅ Done | WPA3, BLE, HCE, NDEF |
| GPS + Sensors | ✅ Done | NMEA parser, geofencing, IMU, magnetometer |
| Camera ISP | ✅ Done | RAW10 parse, AE/AWB, LSC, HDR |
| Audio | ✅ Done | I2S, DMA, spatial audio, beamforming |
| Power Management | ✅ Done | PMIC, DVFS, thermal throttling, battery stats |

### User Experience
| Subsystem | Status | Description |
| :--- | :--- | :--- |
| GUI (Compositor) | ✅ Done | Glassmorphism, spring animations, 120fps |
| Lock Screen / AOD | ✅ Done | PIN, fingerprint, always-on display |
| Home Screen / Launcher | ✅ Done | Widgets, icon packs, gesture navigation |
| Quick Settings / Notifications | ✅ Done | 16 toggle tiles, notification history, edge lighting |
| Keyboard (IME) | ✅ Done | QWERTY, word prediction, haptic feedback, voice input |

<img width="726" height="462" alt="Screenshot 2026-04-18 064622" src="https://github.com/user-attachments/assets/be9813db-afc9-41f5-a231-02e3259b6865" />

### Apps & Ecosystem
| Subsystem | Status | Description |
| :--- | :--- | :--- |
| Phone / Contacts | ✅ Done | Dialer, call recording, emergency SOS, voicemail |
| Messages | ✅ Done | SMS/MMS, E2E encrypted mesh messenger |
| Camera App | ✅ Done | Pro mode, HDR, macro, portrait, 8K video |
| Wallet | ✅ Done | IONA payments, crypto, digital ID, FIDO2 |
| Settings | ✅ Done | Full settings with 12 categories |
| App Store | ✅ Done | Sovereign app registry with signature verification |

<img width="793" height="497" alt="Screenshot 2026-04-18 064654" src="https://github.com/user-attachments/assets/4905521e-1df8-49f2-89f1-930370a3c0ff" />


### AI & Intelligence
| Subsystem | Status | Description |
| :--- | :--- | :--- |
| On-device LLM | ✅ Done | INT4 quantized transformer, GPU-accelerated |
| Voice Assistant | ✅ Done | "Hey IONA" wake word, on-device speech-to-text |
| Proactive Agent | ✅ Done | CPU/RAM/battery monitoring, background tasks |
| Photo AI | ✅ Done | Object eraser, scene detection, auto-enhance |

---

## Build

```bash
cargo build --target aarch64-iona-none --release
./build-arm64.sh
