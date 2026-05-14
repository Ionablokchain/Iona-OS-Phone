import React from 'react';
import { View, Text, StyleSheet, Dimensions } from 'react-native';
import { useSystemBridge } from '@/src/context/SystemBridgeContext';
import { C, MONO, R } from '@/src/theme';

const { width: W } = Dimensions.get('window');

// ─── SimBadge — shown when is_simulated=true ─────────────────────────────────
export function SimBadge() {
  const { isSimulated, bridge } = useSystemBridge();
  if (!isSimulated) return null;
  return (
    <View style={g.simBadge}>
      <View style={g.simDot} />
      <Text style={g.simText}>SIM</Text>
    </View>
  );
}

// ─── BridgeStatusBar — compact status line for screen headers ─────────────────
export function BridgeStatusBar() {
  const { bridge, isSimulated, networkStability } = useSystemBridge();
  const color = isSimulated ? C.fgTertiary : C.success;
  const netColor = networkStability > 0.7 ? C.success : networkStability > 0.3 ? C.warning : C.error;
  return (
    <View style={g.statusBar}>
      <View style={[g.statusDot, { backgroundColor: color }]} />
      <Text style={[g.statusText, { color }]}>
        {isSimulated ? `SIM · ${bridge.consecutive_failures} failures` : `KERNEL · ${bridge.last_kernel_ping?.slice(11, 19) ?? ''}`}
      </Text>
      <View style={g.statusRight}>
        <Text style={[g.statusText, { color: netColor }]}>
          NET {Math.round(networkStability * 100)}%
        </Text>
        <Text style={[g.statusText, { color: C.fgTertiary, marginLeft: 8 }]}>
          HAM {bridge.hamiltonian_buffer_size}/30
        </Text>
      </View>
    </View>
  );
}

// ─── NetworkStabilityBar ──────────────────────────────────────────────────────
export function NetworkStabilityBar({ compact = false }: { compact?: boolean }) {
  const { networkStability } = useSystemBridge();
  const color = networkStability > 0.7 ? C.success : networkStability > 0.3 ? C.warning : C.error;
  const pct = Math.round(networkStability * 100);
  if (compact) {
    return (
      <View style={g.netBarCompact}>
        <View style={[g.netFillCompact, { width: `${pct}%` as any, backgroundColor: color }]} />
      </View>
    );
  }
  return (
    <View style={g.netBarWrap}>
      <Text style={g.netLabel}>NETWORK</Text>
      <View style={g.netBarTrack}>
        <View style={[g.netBarFill, { width: `${pct}%` as any, backgroundColor: color }]} />
      </View>
      <Text style={[g.netPct, { color }]}>{pct}%</Text>
    </View>
  );
}

// ─── ValidatorHeatmap — 1px/2px squares ─────────────────────────────────────
type Cell = { id: string; color: string; status: string; name: string; voting_power: number; uptime_pct: number; };

export function ValidatorHeatmap({ cells, size = 12 }: { cells: Cell[]; size?: number }) {
  return (
    <View style={[g.heatmap, { gap: 2 }]}>
      {cells.map((cell, i) => (
        <View
          key={i}
          style={[
            g.heatCell,
            {
              width: size,
              height: size,
              backgroundColor: cell.color,
              opacity: cell.status === 'degraded' ? 0.5 : 1,
              borderWidth: 1,
              borderColor: `${cell.color}60`,
            }
          ]}
        />
      ))}
    </View>
  );
}

// ─── HamiltonianSparkline ─────────────────────────────────────────────────────
export function HamiltonianSparkline({ width = W - 32 }: { width?: number }) {
  const { hamiltonian } = useSystemBridge();
  if (!hamiltonian?.buffer?.length) return null;

  const data = hamiltonian.buffer.map(p => p.stability);
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 0.001;
  const H = 24;
  const slope = hamiltonian.metrics.slope;
  const color = Math.abs(slope) < 0.0001 ? C.success : slope > 0 ? C.warning : C.error;

  return (
    <View style={{ width, height: H, position: 'relative' }}>
      {data.map((v, i) => {
        if (i === 0) return null;
        const x1 = ((i - 1) / (data.length - 1)) * width;
        const x2 = (i / (data.length - 1)) * width;
        const y1 = H - ((data[i - 1] - min) / range) * (H - 4) - 2;
        const y2 = H - ((v - min) / range) * (H - 4) - 2;
        const dx = x2 - x1; const dy = y2 - y1;
        const len = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx) * 180 / Math.PI;
        return (
          <View key={i} style={{
            position: 'absolute', left: x1, top: y1,
            width: len, height: 1.5, backgroundColor: color,
            transform: [{ rotate: `${angle}deg` }, { translateY: -0.75 }],
          }} />
        );
      })}
    </View>
  );
}

// ─── Oracle Widget ───────────────────────────────────────────────────────────
export function OracleWidget() {
  const [oracle, setOracle] = React.useState<any>(null);
  const pollRef = React.useRef<any>(null);
  React.useEffect(() => {
    const poll = async () => { try { const d = await (await import('@/src/utils/api')).api.getOracleHealth(); setOracle(d); } catch {} };
    poll();
    pollRef.current = setInterval(poll, 5000);
    return () => clearInterval(pollRef.current);
  }, []);
  const score = oracle?.health_score ?? 1;
  const color = score > 0.7 ? C.success : score > 0.4 ? C.warning : C.error;
  return (
    <View style={ow.wrap}>
      <View style={ow.row}>
        <View style={[ow.dot, { backgroundColor: color }]} />
        <Text style={[ow.label, { color }]}>NET {Math.round(score * 100)}%</Text>
      </View>
      {oracle?.iona_price && (
        <Text style={ow.price}>${oracle.iona_price.toLocaleString()}</Text>
      )}
    </View>
  );
}
const ow = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: C.borderSubtle, borderRadius: R.none },
  row: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dot: { width: 5, height: 5, borderRadius: R.xs },
  label: { fontFamily: MONO, fontSize: 9, letterSpacing: 1 },
  price: { fontFamily: MONO, fontSize: 9, color: C.fgSecondary },
});

const g = StyleSheet.create({
  simBadge: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(107,114,128,0.15)',
    borderWidth: 1, borderColor: 'rgba(107,114,128,0.3)',
    borderRadius: R.sm, paddingHorizontal: 7, paddingVertical: 3,
  },
  simDot: { width: 5, height: 5, borderRadius: R.xs, backgroundColor: C.fgTertiary, marginRight: 4 },
  simText: { fontFamily: MONO, fontSize: 9, color: C.fgTertiary, letterSpacing: 1 },
  statusBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 4,
    borderBottomWidth: 1, borderBottomColor: C.borderSubtle,
    backgroundColor: C.surface,
  },
  statusDot: { width: 5, height: 5, borderRadius: R.xs, marginRight: 6 },
  statusText: { fontFamily: MONO, fontSize: 9, letterSpacing: 1 },
  statusRight: { marginLeft: 'auto', flexDirection: 'row' },
  netBarWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  netLabel: { fontFamily: MONO, fontSize: 9, color: C.fgTertiary, letterSpacing: 1, width: 50 },
  netBarTrack: { flex: 1, height: 3, backgroundColor: C.borderSubtle, overflow: 'hidden' },
  netBarFill: { height: 3 },
  netPct: { fontFamily: MONO, fontSize: 9, width: 32, textAlign: 'right' },
  netBarCompact: { width: 40, height: 3, backgroundColor: C.borderSubtle, overflow: 'hidden' },
  netFillCompact: { height: 3 },
  heatmap: { flexDirection: 'row', flexWrap: 'wrap' },
  heatCell: { borderRadius: R.none },
});
