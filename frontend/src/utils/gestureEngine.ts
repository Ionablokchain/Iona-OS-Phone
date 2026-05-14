/**
 * IONA Gesture Engine — Real accelerometer + gyroscope classification
 * Uses expo-sensors DeviceMotion for high-fidelity gesture detection
 * No cloud, fully local, runs on-device at 60Hz
 */

import { Accelerometer, Gyroscope } from 'expo-sensors';
import { Subscription } from 'expo-sensors/build/DeviceSensor';

// ─── Types ───────────────────────────────────────────────────────────────────
export type GestureType =
  | 'shake_3x'
  | 'shake_5x'
  | 'tilt_left_3x'
  | 'tilt_right_3x'
  | 'flip_up_2x'
  | 'flip_down_2x'
  | 'tap_back_4x'
  | 'rotate_cw'
  | 'rotate_ccw';

export type GestureEvent = {
  gesture: GestureType;
  confidence: number;        // 0.0–1.0
  accel_data: number[][];    // Raw samples during gesture
  timestamp: number;
};

type GestureCallback = (event: GestureEvent) => void;

// ─── Constants ────────────────────────────────────────────────────────────────
const ACCEL_UPDATE_MS = 16;    // ~60Hz
const GYRO_UPDATE_MS  = 16;
const SHAKE_THRESHOLD = 2.1;   // g-force magnitude for shake detection
const TILT_THRESHOLD  = 0.55;  // lateral tilt on X axis
const FLIP_THRESHOLD  = 0.65;  // forward/back flip on Y axis
const TAP_THRESHOLD   = 1.8;   // sharp Z spike for back-tap
const GYRO_ROTATE_THR = 2.5;   // rad/s for rotation detection
const WINDOW_MS       = 600;   // gesture window duration
const COOLDOWN_MS     = 800;   // between same gesture

// ─── Gesture Engine ───────────────────────────────────────────────────────────
export class GestureEngine {
  private accelSub:  Subscription | null = null;
  private gyroSub:   Subscription | null = null;
  private callbacks: GestureCallback[] = [];

  // Shake state
  private shakes:      { t: number; mag: number }[] = [];
  // Tilt state
  private tilts:       { t: number; dir: 'left' | 'right' }[] = [];
  // Flip state
  private flips:       { t: number; dir: 'up' | 'down' }[] = [];
  // Back-tap state
  private taps:        { t: number }[] = [];
  // Rotation state
  private rotations:   { t: number; dir: 'cw' | 'ccw' }[] = [];

  // Cooldown tracking
  private lastGesture: Map<GestureType, number> = new Map();

  // Raw sample buffer (last 120 samples = ~2s at 60Hz)
  private accelBuffer: { x: number; y: number; z: number; t: number }[] = [];
  private gyroBuffer:  { x: number; y: number; z: number; t: number }[] = [];

  // Baseline gravity (calibrated on start)
  private gravityBaseline = { x: 0, y: 0, z: 9.8 };
  private calibrated = false;
  private calibrationSamples: { x: number; y: number; z: number }[] = [];

  start() {
    Accelerometer.setUpdateInterval(ACCEL_UPDATE_MS);
    Gyroscope.setUpdateInterval(GYRO_UPDATE_MS);

    this.accelSub = Accelerometer.addListener(raw => {
      const t = Date.now();
      const { x, y, z } = raw;

      // Calibration phase — first 30 samples
      if (!this.calibrated) {
        this.calibrationSamples.push({ x, y, z });
        if (this.calibrationSamples.length >= 30) {
          const avg = this.calibrationSamples.reduce(
            (acc, s) => ({ x: acc.x + s.x / 30, y: acc.y + s.y / 30, z: acc.z + s.z / 30 }),
            { x: 0, y: 0, z: 0 }
          );
          this.gravityBaseline = avg;
          this.calibrated = true;
        }
        return;
      }

      // Remove gravity component (high-pass filter)
      const alpha = 0.85;
      this.gravityBaseline.x = alpha * this.gravityBaseline.x + (1 - alpha) * x;
      this.gravityBaseline.y = alpha * this.gravityBaseline.y + (1 - alpha) * y;
      this.gravityBaseline.z = alpha * this.gravityBaseline.z + (1 - alpha) * z;

      const lx = x - this.gravityBaseline.x;
      const ly = y - this.gravityBaseline.y;
      const lz = z - this.gravityBaseline.z;

      // Store in buffer
      this.accelBuffer.push({ x: lx, y: ly, z: lz, t });
      if (this.accelBuffer.length > 120) this.accelBuffer.shift();

      // Total linear magnitude
      const mag = Math.sqrt(lx * lx + ly * ly + lz * lz);

      // ── Shake detection (high magnitude in any direction) ──
      if (mag > SHAKE_THRESHOLD) {
        this.shakes.push({ t, mag });
        this.shakes = this.shakes.filter(s => t - s.t < WINDOW_MS);
        if (this.shakes.length >= 5) this._emit('shake_5x', 0.95);
        else if (this.shakes.length >= 3) this._emit('shake_3x', 0.9);
      }

      // ── Tilt detection (lateral X axis) ──
      if (Math.abs(x) > TILT_THRESHOLD && Math.abs(lx) > 0.3) {
        const dir = x > 0 ? 'right' : 'left';
        this.tilts.push({ t, dir });
        this.tilts = this.tilts.filter(s => t - s.t < WINDOW_MS * 2);
        const leftCount  = this.tilts.filter(s => s.dir === 'left').length;
        const rightCount = this.tilts.filter(s => s.dir === 'right').length;
        if (leftCount >= 3)  this._emit('tilt_left_3x', 0.88);
        if (rightCount >= 3) this._emit('tilt_right_3x', 0.88);
      }

      // ── Flip detection (Y axis for forward/back) ──
      if (Math.abs(y) > FLIP_THRESHOLD && Math.abs(ly) > 0.3) {
        const dir = y > 0 ? 'up' : 'down';
        this.flips.push({ t, dir });
        this.flips = this.flips.filter(s => t - s.t < WINDOW_MS * 2);
        const upCount   = this.flips.filter(s => s.dir === 'up').length;
        const downCount = this.flips.filter(s => s.dir === 'down').length;
        if (upCount >= 2)   this._emit('flip_up_2x', 0.85);
        if (downCount >= 2) this._emit('flip_down_2x', 0.85);
      }

      // ── Back-tap detection (sharp Z spike with low XY) ──
      if (Math.abs(lz) > TAP_THRESHOLD && Math.abs(lx) < 0.5 && Math.abs(ly) < 0.5) {
        this.taps.push({ t });
        this.taps = this.taps.filter(s => t - s.t < WINDOW_MS * 2);
        if (this.taps.length >= 4) this._emit('tap_back_4x', 0.82);
      }
    });

    this.gyroSub = Gyroscope.addListener(raw => {
      const t = Date.now();
      const { x, y, z } = raw;

      this.gyroBuffer.push({ x, y, z, t });
      if (this.gyroBuffer.length > 120) this.gyroBuffer.shift();

      // ── Rotation detection (Z-axis angular velocity) ──
      if (Math.abs(z) > GYRO_ROTATE_THR) {
        const dir = z > 0 ? 'cw' : 'ccw';
        this.rotations.push({ t, dir });
        this.rotations = this.rotations.filter(s => t - s.t < WINDOW_MS);
        const cwCount  = this.rotations.filter(s => s.dir === 'cw').length;
        const ccwCount = this.rotations.filter(s => s.dir === 'ccw').length;
        if (cwCount >= 3)  this._emit('rotate_cw', 0.8);
        if (ccwCount >= 3) this._emit('rotate_ccw', 0.8);
      }
    });
  }

  stop() {
    this.accelSub?.remove();
    this.gyroSub?.remove();
    this.accelSub = null;
    this.gyroSub  = null;
  }

  onGesture(cb: GestureCallback): () => void {
    this.callbacks.push(cb);
    return () => { this.callbacks = this.callbacks.filter(c => c !== cb); };
  }

  getCalibrationStatus(): { calibrated: boolean; progress: number } {
    return {
      calibrated: this.calibrated,
      progress: Math.min(1, this.calibrationSamples.length / 30),
    };
  }

  getRawAccel(): { x: number; y: number; z: number; mag: number } | null {
    const last = this.accelBuffer[this.accelBuffer.length - 1];
    if (!last) return null;
    return {
      x: last.x, y: last.y, z: last.z,
      mag: Math.sqrt(last.x ** 2 + last.y ** 2 + last.z ** 2),
    };
  }

  private _emit(gesture: GestureType, confidence: number) {
    const now = Date.now();
    const lastTime = this.lastGesture.get(gesture) ?? 0;
    if (now - lastTime < COOLDOWN_MS) return;
    this.lastGesture.set(gesture, now);

    // Clear gesture buffers to avoid re-trigger
    if (gesture.startsWith('shake')) this.shakes = [];
    if (gesture.startsWith('tilt_left'))  this.tilts = this.tilts.filter(t => t.dir !== 'left');
    if (gesture.startsWith('tilt_right')) this.tilts = this.tilts.filter(t => t.dir !== 'right');
    if (gesture.startsWith('flip_up'))   this.flips = this.flips.filter(f => f.dir !== 'up');
    if (gesture.startsWith('flip_down')) this.flips = this.flips.filter(f => f.dir !== 'down');
    if (gesture === 'tap_back_4x') this.taps = [];
    if (gesture.startsWith('rotate')) this.rotations = [];

    // Collect raw samples for the last 600ms
    const windowStart = now - WINDOW_MS;
    const accel_data = this.accelBuffer
      .filter(s => s.t >= windowStart)
      .map(s => [s.x, s.y, s.z]);

    const event: GestureEvent = { gesture, confidence, accel_data, timestamp: now };
    this.callbacks.forEach(cb => cb(event));
  }
}

// Singleton instance
export const gestureEngine = new GestureEngine();

// ─── Gesture → IONA Action mapping ───────────────────────────────────────────
export const GESTURE_MAP: Record<GestureType, string> = {
  shake_3x:      'emergency',
  shake_5x:      'inject_drift',
  tilt_left_3x:  'force_realign',
  tilt_right_3x: 'set_eco',
  flip_up_2x:    'start_learning',
  flip_down_2x:  'set_perf',
  tap_back_4x:   'vfs_freeze',
  rotate_cw:     'checkpoint_now',
  rotate_ccw:    'mesh_query',
};

export const GESTURE_LABELS: Record<GestureType, { icon: string; desc: string; color: string }> = {
  shake_3x:      { icon: 'Shake ×3',    desc: 'Emergency Reset',     color: '#FF003C' },
  shake_5x:      { icon: 'Shake ×5',    desc: 'Inject Drift (debug)',  color: '#F59E0B' },
  tilt_left_3x:  { icon: 'Tilt ← ×3',  desc: 'Force Realign',        color: '#00FF41' },
  tilt_right_3x: { icon: 'Tilt → ×3',  desc: 'ECO Mode',             color: '#3B82F6' },
  flip_up_2x:    { icon: 'Flip ↑ ×2',  desc: 'Start Learning',       color: '#8B5CF6' },
  flip_down_2x:  { icon: 'Flip ↓ ×2',  desc: 'Performance Mode',     color: '#06B6D4' },
  tap_back_4x:   { icon: 'Tap ×4',     desc: 'VFS Freeze',           color: '#F59E0B' },
  rotate_cw:     { icon: 'Rotate ↻',   desc: 'Checkpoint Now',       color: '#10B981' },
  rotate_ccw:    { icon: 'Rotate ↺',   desc: 'Mesh Query',           color: '#EC4899' },
};
