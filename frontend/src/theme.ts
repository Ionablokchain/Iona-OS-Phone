import { Platform, StyleSheet } from 'react-native';

// ─── IONA OS — "Control Room" Protocol v2 ────────────────────────────────────
// ZERO RADIUS. MONOSPACE ONLY. 1PX GRID. NO EXCEPTIONS.

export const C = {
  // ── Backgrounds ──
  bg:              '#050505',
  surface:         '#0D0D0D',
  surfaceElevated: '#141414',
  surfaceHigh:     '#1A1A1A',

  // ── Foreground — live mode ──
  fg:              '#FFFFFF',
  fgSecondary:     '#A1A1AA',
  fgTertiary:      '#52525B',

  // ── Foreground — simulated mode (dimmed) ──
  fgSim:           '#6B7280',
  fgSecondarySim:  '#4B5563',
  bgSim:           '#0A0A0A',
  borderSim:       'rgba(255,255,255,0.04)',

  // ── 1px Grid Borders ──
  border:          'rgba(255,255,255,0.08)',
  borderStrong:    'rgba(255,255,255,0.16)',
  borderSubtle:    'rgba(255,255,255,0.04)',

  // ── Accent system ──
  accent:    '#FF4B00',
  accentDim: 'rgba(255,75,0,0.12)',
  success:   '#00FF41',
  successDim:'rgba(0,255,65,0.10)',
  error:     '#FF003C',
  errorDim:  'rgba(255,0,60,0.10)',
  warning:   '#F59E0B',
  warningDim:'rgba(245,158,11,0.10)',
  blue:      '#3B82F6',
  blueDim:   'rgba(59,130,246,0.10)',
  purple:    '#8B5CF6',
  purpleDim: 'rgba(139,92,246,0.10)',
  cyan:      '#06B6D4',
  pink:      '#EC4899',
};

// ── MONOSPACE ONLY — zero sans-serif ────────────────────────────────────────
export const MONO = Platform.OS === 'ios' ? 'Menlo' : 'monospace';

// ── ZERO RADIUS ─────────────────────────────────────────────────────────────
// Global override. All borderRadius must use these values.
export const R = {
  none: 0,   // DEFAULT — use this everywhere
  xs:   2,   // Only for micro indicators (dots, battery fill)
  sm:   4,   // PIN keys, small badges
  md:   0,   // Intentionally 0 — no medium radius
  lg:   0,   // Intentionally 0 — no large radius
  xl:   0,   // Intentionally 0 — no xl radius
};

// ── Typography — monospace lock ──────────────────────────────────────────────
export const TYPE = {
  display:   { fontFamily: MONO, fontSize: 56, fontWeight: '100' as const, letterSpacing: -3, color: C.fg },
  h1:        { fontFamily: MONO, fontSize: 24, fontWeight: '900' as const, color: C.fg, letterSpacing: -0.5 },
  h2:        { fontFamily: MONO, fontSize: 18, fontWeight: '700' as const, color: C.fg },
  h3:        { fontFamily: MONO, fontSize: 14, fontWeight: '600' as const, color: C.fg },
  body:      { fontFamily: MONO, fontSize: 14, color: C.fg },
  bodySm:    { fontFamily: MONO, fontSize: 12, color: C.fgSecondary },
  mono:      { fontFamily: MONO, fontSize: 13, color: C.fg },
  monoSm:    { fontFamily: MONO, fontSize: 11, color: C.fgSecondary },
  monoXs:    { fontFamily: MONO, fontSize: 9,  color: C.fgSecondary, letterSpacing: 1 },
  label:     { fontFamily: MONO, fontSize: 10, color: C.fgSecondary, letterSpacing: 3, textTransform: 'uppercase' as const },
  metric:    { fontFamily: MONO, fontSize: 20, color: C.fg, fontWeight: '200' as const },
  code:      { fontFamily: MONO, fontSize: 12, color: C.success, lineHeight: 19 },
};

// ── 1px Grid ─────────────────────────────────────────────────────────────────
export const GRID = {
  border: { borderWidth: 1, borderColor: C.border } as const,
  borderStrong: { borderWidth: 1, borderColor: C.borderStrong } as const,
  borderBottom: { borderBottomWidth: 1, borderBottomColor: C.border } as const,
  borderTop: { borderTopWidth: 1, borderTopColor: C.border } as const,
};

// ── Spacing — 4px base ────────────────────────────────────────────────────────
export const SP = { xs:4, sm:8, md:12, lg:16, xl:24, xxl:32 };

// ── Simulated mode overlay ────────────────────────────────────────────────────
// When is_simulated=true, UI applies these overrides to signal data source
export const SIM_OVERLAY = StyleSheet.create({
  container: { backgroundColor: C.bgSim },
  text: { color: C.fgSim },
  border: { borderColor: C.borderSim },
  badge: {
    backgroundColor: 'rgba(107,114,128,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(107,114,128,0.3)',
    borderRadius: R.sm,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: {
    fontFamily: MONO,
    fontSize: 9,
    color: C.fgSim,
    letterSpacing: 1,
  },
});

// ── Global reset helpers ──────────────────────────────────────────────────────
export const RESET = StyleSheet.create({
  // Standard screen container
  screen: {
    flex: 1,
    backgroundColor: C.bg,
  },
  // Standard header row
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SP.lg,
    paddingVertical: SP.md,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    backgroundColor: C.bg,
  },
  // Standard section label
  sectionLabel: {
    fontFamily: MONO,
    fontSize: 10,
    color: C.fgSecondary,
    letterSpacing: 3,
    marginBottom: SP.sm,
    marginTop: SP.xs,
  },
  // 1px card — zero radius
  card: {
    backgroundColor: C.surface,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.none,
    padding: SP.md,
    marginBottom: SP.sm,
  },
  // Row separator
  separator: {
    height: 1,
    backgroundColor: C.border,
  },
});
