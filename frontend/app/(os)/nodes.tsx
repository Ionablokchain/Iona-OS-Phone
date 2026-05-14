import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  RefreshControl, Animated, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { C, MONO, R, GRID, SP, RESET } from '@/src/theme';
import { api } from '@/src/utils/api';
import { haptic } from '@/src/utils/haptics';
import { useSystemBridge } from '@/src/context/SystemBridgeContext';
import {
  BridgeStatusBar, ValidatorHeatmap,
  HamiltonianSparkline, NetworkStabilityBar, SimBadge,
} from '@/src/components/GridOverlay';

const { width: W } = Dimensions.get('window');
const STABILITY_TARGET = 1.42;

type AgentStatus = 'Idle' | 'Monitoring' | 'Optimizing' | 'Warning' | 'Learning' | 'Emergency';

type AgentState = {
  version: string;
  stability_index: number;
  drift: number;
  entropy_level: number;
  battery_life: number;
  is_eco_mode: boolean;
  agent_status: AgentStatus;
  active_nodes: number;
  uptime_seconds: number;
  corrections_total: number;
  last_anomaly: string | null;
  log_buffer: string[];
  prediction: {
    slope_5: number;
    slope_all: number;
    variance: number;
    trend: string;
    projected_drift: number;
    confidence: number;
    network_factor: number;
    alert: string | null;
    pre_emptive: boolean;
  };
  history: number[];
};

// ── Status badge — zero radius ───────────────────────────────────────────────
function AgentStatusBadge({ status }: { status: AgentStatus }) {
  const cm: Record<AgentStatus, string> = {
    Idle: C.success, Monitoring: C.blue, Optimizing: C.warning,
    Warning: C.error, Learning: C.purple, Emergency: C.error,
  };
  const color = cm[status] || C.fgSecondary;
  return (
    <View style={[sb.badge, { backgroundColor: `${color}15`, borderColor: `${color}30` }]}>
      <View style={[sb.dot, { backgroundColor: color }]} />
      <Text style={[sb.text, { color }]}>{status.toUpperCase()}</Text>
    </View>
  );
}
const sb = StyleSheet.create({
  badge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderRadius: R.none },
  dot: { width: 5, height: 5, borderRadius: R.xs, marginRight: 5 },
  text: { fontFamily: MONO, fontSize: 9, letterSpacing: 1 },
});

// ── Stability display — zero radius ──────────────────────────────────────────
function StabilityDisplay({ value, drift, trend, confidence }: {
  value: number; drift: number; trend: string; confidence: number;
}) {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const isStable = drift < 0.05;
  const color = isStable ? C.success : drift < 0.1 ? C.warning : C.error;

  useEffect(() => {
    if (!isStable) {
      Animated.loop(Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.03, duration: 600, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      ])).start();
    } else { pulseAnim.setValue(1); }
  }, [isStable]);

  const trendIcon = trend === 'rising' ? 'trending-up' : trend === 'falling' ? 'trending-down' : 'minus';
  const trendColor = trend === 'stable' ? C.success : trend === 'rising' ? C.warning : C.error;

  return (
    <Animated.View style={[sd.wrap, { borderColor: `${color}30`, transform: [{ scale: pulseAnim }] }]}>
      <View style={sd.top}>
        <Text style={sd.label}>STABILITY INDEX</Text>
        <View style={[sd.trendBadge, { borderColor: `${trendColor}30` }]}>
          <Feather name={trendIcon as any} size={10} color={trendColor} />
          <Text style={[sd.trendText, { color: trendColor }]}>{trend.toUpperCase()}</Text>
        </View>
      </View>
      <Text style={[sd.value, { color }]}>{value.toFixed(6)}</Text>
      <View style={sd.row}>
        <Text style={sd.target}>/ {STABILITY_TARGET} TARGET</Text>
        <Text style={[sd.drift, { color: isStable ? C.success : C.error }]}>
          Δ {drift.toFixed(6)}
        </Text>
      </View>
      <View style={sd.confRow}>
        <Text style={sd.confLabel}>CONFIDENCE</Text>
        <View style={sd.confBar}>
          <View style={[sd.confFill, { width: `${confidence * 100}%` as any, backgroundColor: color }]} />
        </View>
        <Text style={[sd.confVal, { color }]}>{Math.round(confidence * 100)}%</Text>
      </View>
    </Animated.View>
  );
}
const sd = StyleSheet.create({
  wrap: { borderWidth: 1, padding: SP.lg, marginBottom: SP.sm, backgroundColor: C.surface },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SP.sm },
  label: { fontFamily: MONO, fontSize: 9, color: C.fgSecondary, letterSpacing: 3 },
  trendBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 2, borderRadius: R.none },
  trendText: { fontFamily: MONO, fontSize: 8, letterSpacing: 1 },
  value: { fontFamily: MONO, fontSize: 36, fontWeight: '200', letterSpacing: -1 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2, marginBottom: SP.md },
  target: { fontFamily: MONO, fontSize: 10, color: C.fgSecondary },
  drift: { fontFamily: MONO, fontSize: 10 },
  confRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  confLabel: { fontFamily: MONO, fontSize: 9, color: C.fgSecondary, letterSpacing: 1, width: 72 },
  confBar: { flex: 1, height: 3, backgroundColor: C.borderSubtle, overflow: 'hidden' },
  confFill: { height: 3 },
  confVal: { fontFamily: MONO, fontSize: 9, width: 30, textAlign: 'right' },
});

// ── Prediction panel ──────────────────────────────────────────────────────────
function PredictionPanel({ pred }: { pred: AgentState['prediction'] }) {
  if (!pred) return null;
  const hasAlert = !!pred.alert;
  const alertColor = pred.alert?.includes('CRITICAL') ? C.error : C.warning;
  return (
    <View style={[pp.wrap, hasAlert && { borderColor: `${alertColor}40` }]}>
      <Text style={pp.title}>AI PREDICTOR — LINEAR REGRESSION</Text>
      <View style={pp.grid}>
        <View style={pp.stat}>
          <Text style={pp.statLbl}>SLOPE (5)</Text>
          <Text style={[pp.statVal, { color: Math.abs(pred.slope_5) < 0.0003 ? C.success : C.warning }]}>
            {pred.slope_5 >= 0 ? '+' : ''}{pred.slope_5.toFixed(8)}
          </Text>
        </View>
        <View style={pp.stat}>
          <Text style={pp.statLbl}>SLOPE (ALL)</Text>
          <Text style={[pp.statVal, { color: Math.abs(pred.slope_all) < 0.0003 ? C.success : C.warning }]}>
            {pred.slope_all >= 0 ? '+' : ''}{pred.slope_all.toFixed(8)}
          </Text>
        </View>
        <View style={pp.stat}>
          <Text style={pp.statLbl}>VARIANCE</Text>
          <Text style={[pp.statVal, { color: pred.variance < 0.0001 ? C.success : C.warning }]}>
            {pred.variance.toFixed(8)}
          </Text>
        </View>
        <View style={pp.stat}>
          <Text style={pp.statLbl}>PROJ. DRIFT</Text>
          <Text style={[pp.statVal, { color: pred.projected_drift < 0.05 ? C.success : C.error }]}>
            {pred.projected_drift.toFixed(6)}
          </Text>
        </View>
        <View style={pp.stat}>
          <Text style={pp.statLbl}>NET FACTOR</Text>
          <Text style={[pp.statVal, { color: pred.network_factor > 0.7 ? C.success : C.warning }]}>
            {Math.round(pred.network_factor * 100)}%
          </Text>
        </View>
        <View style={pp.stat}>
          <Text style={pp.statLbl}>PRE-EMPTIVE</Text>
          <Text style={[pp.statVal, { color: pred.pre_emptive ? C.warning : C.success }]}>
            {pred.pre_emptive ? 'YES' : 'NO'}
          </Text>
        </View>
      </View>
      {hasAlert && (
        <View style={[pp.alertBox, { borderColor: `${alertColor}40`, backgroundColor: `${alertColor}08` }]}>
          <Feather name="alert-triangle" size={12} color={alertColor} />
          <Text style={[pp.alertText, { color: alertColor }]}>{pred.alert}</Text>
        </View>
      )}
    </View>
  );
}
const pp = StyleSheet.create({
  wrap: { borderWidth: 1, borderColor: C.border, padding: SP.md, marginBottom: SP.sm, backgroundColor: C.surface },
  title: { fontFamily: MONO, fontSize: 9, color: C.fgSecondary, letterSpacing: 2, marginBottom: SP.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 0 },
  stat: { width: '50%', paddingVertical: 5, paddingRight: SP.sm, borderBottomWidth: 1, borderBottomColor: C.borderSubtle },
  statLbl: { fontFamily: MONO, fontSize: 8, color: C.fgSecondary, letterSpacing: 1 },
  statVal: { fontFamily: MONO, fontSize: 11, marginTop: 2 },
  alertBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: SP.sm, borderWidth: 1, marginTop: SP.sm, borderRadius: R.none },
  alertText: { fontFamily: MONO, fontSize: 10, flex: 1, lineHeight: 15 },
});

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function AgentDashboardScreen() {
  const router = useRouter();
  const { bridge, hamiltonian, isSimulated, networkStability } = useSystemBridge();
  const [agent, setAgent] = useState<AgentState | null>(null);
  const [validators, setValidators] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [cmdLoading, setCmdLoading] = useState<string | null>(null);
  const pollRef = useRef<any>(null);

  const load = async () => {
    try {
      const [a, v] = await Promise.all([
        api.getAgentStatus(),
        api.getValidatorHeatmap(),
      ]);
      setAgent(a);
      if (v?.cells) setValidators(v.cells);
    } catch {}
  };

  useEffect(() => {
    load();
    pollRef.current = setInterval(load, 1000);
    return () => clearInterval(pollRef.current);
  }, []);

  const onRefresh = async () => {
    haptic.tap(); setRefreshing(true);
    await load(); setRefreshing(false);
  };

  const sendCmd = async (cmd: string, value?: number) => {
    haptic.medium(); setCmdLoading(cmd);
    try {
      await api.sendAgentCommand(cmd, value);
      await load(); haptic.success();
    } catch { haptic.error(); }
    setCmdLoading(null);
  };

  const formatUptime = (s: number) => `${Math.floor(s/3600)}h ${Math.floor((s%3600)/60)}m ${s%60}s`;

  const drift = agent?.drift ?? 0;
  const accentColor = drift < 0.05 ? C.success : drift < 0.1 ? C.warning : C.error;

  return (
    <SafeAreaView style={RESET.screen} testID="agent-screen">
      {/* Header — zero radius */}
      <View style={RESET.header}>
        <TouchableOpacity onPress={() => { haptic.tap(); router.back(); }}>
          <Feather name="arrow-left" size={20} color={C.fgSecondary} />
        </TouchableOpacity>
        <View style={{ flex: 1, alignItems: 'center' }}>
          <Text style={{ fontFamily: MONO, fontSize: 11, color: C.fg, letterSpacing: 4 }}>IONA AGENT</Text>
          {agent && <Text style={{ fontFamily: MONO, fontSize: 8, color: C.fgSecondary, letterSpacing: 2 }}>{agent.version}</Text>}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <SimBadge />
          {agent && <AgentStatusBadge status={agent.agent_status as AgentStatus} />}
        </View>
      </View>

      {/* Bridge status bar */}
      <BridgeStatusBar />

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: SP.lg, paddingTop: SP.sm }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}
      >
        {/* Stability display */}
        <StabilityDisplay
          value={agent?.stability_index ?? STABILITY_TARGET}
          drift={drift}
          trend={agent?.prediction?.trend ?? 'stable'}
          confidence={agent?.prediction?.confidence ?? 1}
        />

        {/* Hamiltonian sparkline */}
        <View style={hs.wrap}>
          <View style={hs.header}>
            <Text style={hs.label}>HAMILTONIAN BUFFER ({bridge.hamiltonian_buffer_size}/30)</Text>
            {hamiltonian?.metrics && (
              <Text style={[hs.slope, {
                color: Math.abs(hamiltonian.metrics.slope) < 0.0001 ? C.success : C.warning
              }]}>
                slope {hamiltonian.metrics.slope >= 0 ? '+' : ''}{hamiltonian.metrics.slope.toFixed(6)}
              </Text>
            )}
          </View>
          <HamiltonianSparkline width={W - SP.lg * 2} />
          {hamiltonian?.metrics && (
            <View style={hs.metrics}>
              {[
                ['MIN', hamiltonian.metrics.min.toFixed(4)],
                ['AVG', hamiltonian.metrics.avg.toFixed(4)],
                ['MAX', hamiltonian.metrics.max.toFixed(4)],
                ['VAR', hamiltonian.metrics.variance.toFixed(6)],
              ].map(([k, v]) => (
                <View key={k} style={hs.metric}>
                  <Text style={hs.mKey}>{k}</Text>
                  <Text style={hs.mVal}>{v}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* AI Prediction panel */}
        {agent?.prediction && <PredictionPanel pred={agent.prediction} />}

        {/* Metrics row */}
        <View style={mr.row}>
          {[
            { icon: 'server', label: 'NODES', val: String(agent?.active_nodes ?? '--'), color: C.success },
            { icon: 'activity', label: 'FIXES', val: String(agent?.corrections_total ?? '--'), color: C.accent },
            { icon: 'clock', label: 'UPTIME', val: agent ? `${Math.floor((agent.uptime_seconds || 0)/60)}m` : '--', color: C.blue },
            { icon: agent?.is_eco_mode ? 'battery-charging' : 'battery', label: agent?.is_eco_mode ? 'ECO' : 'PERF', val: `${agent?.battery_life ?? '--'}%`, color: (agent?.battery_life ?? 100) < 20 ? C.error : C.success },
          ].map((m, i) => (
            <View key={i} style={[mr.card, { borderColor: `${m.color}20` }]}>
              <Feather name={m.icon as any} size={14} color={m.color} />
              <Text style={[mr.val, { color: m.color }]}>{m.val}</Text>
              <Text style={mr.lbl}>{m.label}</Text>
            </View>
          ))}
        </View>

        {/* Network stability */}
        <View style={ns.wrap}>
          <Text style={ns.label}>NETWORK STABILITY</Text>
          <NetworkStabilityBar />
        </View>

        {/* Validator heatmap */}
        {validators.length > 0 && (
          <View style={vh.wrap}>
            <Text style={vh.label}>VALIDATOR HEATMAP ({validators.length} nodes)</Text>
            <ValidatorHeatmap cells={validators} size={14} />
            <View style={vh.legend}>
              {[{ color: C.success, label: 'Active >95%' }, { color: C.warning, label: 'Active <95%' }, { color: C.error, label: 'Degraded' }].map(l => (
                <View key={l.label} style={vh.legendItem}>
                  <View style={[vh.legendDot, { backgroundColor: l.color }]} />
                  <Text style={vh.legendText}>{l.label}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Architect commands — zero radius */}
        <Text style={RESET.sectionLabel}>ARCHITECT COMMANDS</Text>
        <View style={cmd.grid}>
          {[
            { id: 'force_realign', label: 'Force Realign', desc: '→ 1.42', icon: 'target', color: C.success },
            { id: 'emergency', label: 'Emergency', desc: 'Hard reset', icon: 'alert-triangle', color: C.error },
            { id: agent?.is_eco_mode ? 'set_perf' : 'set_eco', label: agent?.is_eco_mode ? 'Perf Mode' : 'Eco Mode', desc: 'Toggle power', icon: 'zap', color: C.blue },
            { id: 'start_learning', label: 'Learning', desc: 'Update baseline', icon: 'cpu', color: C.purple },
          ].map(c => (
            <TouchableOpacity
              key={c.id}
              style={[cmd.btn, { borderColor: `${c.color}25` }]}
              onPress={() => sendCmd(c.id)}
              disabled={!!cmdLoading}
              activeOpacity={0.7}
            >
              <View style={[cmd.iconWrap, { backgroundColor: `${c.color}10`, borderColor: `${c.color}25` }]}>
                <Feather name={c.icon as any} size={18} color={cmdLoading === c.id ? C.fgSecondary : c.color} />
              </View>
              <Text style={[cmd.label, { color: c.color }]}>{c.label}</Text>
              <Text style={cmd.desc}>{c.desc}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Debug inject */}
        <TouchableOpacity
          style={[cmd.wide, { borderColor: `${C.fgSecondary}15` }]}
          onPress={() => sendCmd('inject_drift', 0.15)}
          disabled={!!cmdLoading}
        >
          <Feather name="code" size={14} color={C.fgSecondary} />
          <View style={{ flex: 1, marginLeft: 10 }}>
            <Text style={[cmd.label, { color: C.fgSecondary, fontSize: 11 }]}>Debug: Inject Drift</Text>
            <Text style={cmd.desc}>Simulate anomaly → AI self-corrects via linear regression</Text>
          </View>
        </TouchableOpacity>

        {/* Log buffer */}
        <View style={lb.wrap}>
          <View style={lb.header}>
            <Text style={lb.title}>AGENT LOG BUFFER</Text>
            <Text style={lb.count}>{agent?.log_buffer.length ?? 0}/50</Text>
          </View>
          {(agent?.log_buffer ?? []).slice(0, 14).map((log, i) => (
            <View key={i} style={[lb.item, i === 0 && lb.itemLatest]}>
              <View style={[lb.dot, {
                backgroundColor:
                  log.includes('CRITICAL') || log.includes('EMERGENCY') ? C.error :
                  log.includes('PREDICTION') || log.includes('WARNING') ? C.warning :
                  log.includes('MANUAL') || log.includes('Architect') ? C.accent :
                  log.includes('Learning') ? C.purple :
                  log.includes('BRIDGE') ? C.blue :
                  C.success,
              }]} />
              <Text style={[lb.text, i === 0 && { color: C.fg }]} numberOfLines={2}>{log}</Text>
            </View>
          ))}
          {!agent?.log_buffer.length && (
            <Text style={lb.empty}>Agent initializing...</Text>
          )}
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const hs = StyleSheet.create({
  wrap: { borderWidth: 1, borderColor: C.border, padding: SP.md, marginBottom: SP.sm, backgroundColor: C.surface },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SP.sm },
  label: { fontFamily: MONO, fontSize: 9, color: C.fgSecondary, letterSpacing: 2 },
  slope: { fontFamily: MONO, fontSize: 9 },
  metrics: { flexDirection: 'row', marginTop: SP.sm },
  metric: { flex: 1 },
  mKey: { fontFamily: MONO, fontSize: 8, color: C.fgSecondary, letterSpacing: 1 },
  mVal: { fontFamily: MONO, fontSize: 11, color: C.fg, marginTop: 1 },
});

const mr = StyleSheet.create({
  row: { flexDirection: 'row', gap: 6, marginBottom: SP.sm },
  card: { flex: 1, borderWidth: 1, padding: SP.sm, alignItems: 'center', gap: 3, backgroundColor: C.surface, borderRadius: R.none },
  val: { fontFamily: MONO, fontSize: 14, fontWeight: '600' },
  lbl: { fontFamily: MONO, fontSize: 7, color: C.fgSecondary, letterSpacing: 1 },
});

const ns = StyleSheet.create({
  wrap: { borderWidth: 1, borderColor: C.border, padding: SP.md, marginBottom: SP.sm, backgroundColor: C.surface },
  label: { fontFamily: MONO, fontSize: 9, color: C.fgSecondary, letterSpacing: 2, marginBottom: SP.sm },
});

const vh = StyleSheet.create({
  wrap: { borderWidth: 1, borderColor: C.border, padding: SP.md, marginBottom: SP.sm, backgroundColor: C.surface },
  label: { fontFamily: MONO, fontSize: 9, color: C.fgSecondary, letterSpacing: 2, marginBottom: SP.sm },
  legend: { flexDirection: 'row', gap: SP.md, marginTop: SP.sm },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: R.none },
  legendText: { fontFamily: MONO, fontSize: 8, color: C.fgSecondary },
});

const cmd = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 6 },
  btn: { width: (W - SP.lg * 2 - 18) / 2, borderWidth: 1, padding: SP.md, backgroundColor: C.surface, borderRadius: R.none },
  iconWrap: { width: 32, height: 32, borderWidth: 1, justifyContent: 'center', alignItems: 'center', marginBottom: 8, borderRadius: R.none },
  label: { fontFamily: MONO, fontSize: 12, fontWeight: '600', letterSpacing: 0.5 },
  desc: { fontFamily: MONO, fontSize: 9, color: C.fgSecondary, marginTop: 2 },
  wide: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, padding: SP.md, marginBottom: SP.sm, backgroundColor: C.surface, borderRadius: R.none },
});

const lb = StyleSheet.create({
  wrap: { borderWidth: 1, borderColor: C.border, padding: SP.md, backgroundColor: C.surface },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SP.sm },
  title: { fontFamily: MONO, fontSize: 9, color: C.fgSecondary, letterSpacing: 2 },
  count: { fontFamily: MONO, fontSize: 9, color: C.fgSecondary },
  item: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: C.borderSubtle, gap: 7 },
  itemLatest: { borderBottomColor: C.border },
  dot: { width: 4, height: 4, borderRadius: R.xs, marginTop: 5, flexShrink: 0 },
  text: { fontFamily: MONO, fontSize: 10, color: C.fgSecondary, flex: 1, lineHeight: 15 },
  empty: { fontFamily: MONO, fontSize: 11, color: C.fgSecondary, textAlign: 'center', paddingVertical: SP.xl },
});
