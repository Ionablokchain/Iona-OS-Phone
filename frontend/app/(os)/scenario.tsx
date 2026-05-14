import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  Animated, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { C, MONO, R, SP, GRID, RESET } from '@/src/theme';
import { api } from '@/src/utils/api';
import { haptic } from '@/src/utils/haptics';
import { BridgeStatusBar, ValidatorHeatmap } from '@/src/components/GridOverlay';

const { width: W } = Dimensions.get('window');

const PHASES = [
  { id: 'thermal',    label: '1. THERMAL',    icon: 'thermometer', color: '#EF4444',
    desc: 'CPU → 87°C, ECO forced, poll → 2000ms' },
  { id: 'simulated',  label: '2. SIM MODE',   icon: 'wifi-off',    color: '#F59E0B',
    desc: 'Kernel disconnect, is_simulated=true, UI dims' },
  { id: 'mesh',       label: '3. MESH P2P',   icon: 'radio',       color: '#3B82F6',
    desc: 'net_stability → 0.08, BLE peer discovered' },
  { id: 'prediction', label: '4. AI PRED',    icon: 'cpu',         color: '#8B5CF6',
    desc: 'confidence drops (net_factor=0.08), slope projects' },
  { id: 'emergency',  label: '5. EMERGENCY',  icon: 'alert-triangle', color: '#FF003C',
    desc: 'Vol↑×3 → hard reset, stability restored to 1.42' },
];

// ── Live metric row ───────────────────────────────────────────────────────────
function LiveRow({ label, value, color, prev }: {
  label: string; value: string; color?: string; prev?: string;
}) {
  const flashAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (value !== prev) {
      Animated.sequence([
        Animated.timing(flashAnim, { toValue: 0.3, duration: 120, useNativeDriver: true }),
        Animated.timing(flashAnim, { toValue: 1, duration: 180, useNativeDriver: true }),
      ]).start();
    }
  }, [value]);
  return (
    <View style={lr.row}>
      <Text style={lr.label}>{label}</Text>
      <Animated.Text style={[lr.value, { color: color || C.fg, opacity: flashAnim }]}>
        {value}
      </Animated.Text>
    </View>
  );
}
const lr = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: C.borderSubtle },
  label: { fontFamily: MONO, fontSize: 10, color: C.fgSecondary, letterSpacing: 1 },
  value: { fontFamily: MONO, fontSize: 12, fontWeight: '600' },
});

// ── Phase step indicator ──────────────────────────────────────────────────────
function PhaseStep({ phase, currentPhase, phaseIndex }: {
  phase: typeof PHASES[0];
  currentPhase: string | null;
  phaseIndex: number;
}) {
  const isActive = currentPhase === phase.id;
  const isDone = phaseIndex > PHASES.findIndex(p => p.id === phase.id) + 1;
  const isPending = !isActive && !isDone;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (isActive) {
      Animated.loop(Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.04, duration: 400, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
      ])).start();
    } else { pulseAnim.setValue(1); }
  }, [isActive]);

  return (
    <Animated.View style={[
      ps.wrap,
      { borderColor: isActive ? `${phase.color}60` : isDone ? `${phase.color}30` : C.borderSubtle },
      { backgroundColor: isActive ? `${phase.color}10` : isDone ? `${phase.color}05` : C.surface },
      isActive && { transform: [{ scale: pulseAnim }] },
    ]}>
      <View style={[ps.iconWrap, {
        borderColor: isActive ? `${phase.color}40` : isDone ? `${phase.color}25` : C.border,
        backgroundColor: isActive ? `${phase.color}15` : 'transparent',
      }]}>
        {isDone
          ? <Feather name="check" size={14} color={phase.color} />
          : <Feather name={phase.icon as any} size={14} color={isActive ? phase.color : C.fgTertiary} />
        }
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[ps.label, { color: isActive ? phase.color : isDone ? phase.color : C.fgTertiary }]}>
          {phase.label}
        </Text>
        <Text style={ps.desc}>{phase.desc}</Text>
      </View>
      <View style={[ps.status, {
        backgroundColor: isActive ? `${phase.color}20` : isDone ? `${phase.color}10` : C.borderSubtle,
      }]}>
        <Text style={[ps.statusText, {
          color: isActive ? phase.color : isDone ? phase.color : C.fgTertiary
        }]}>
          {isActive ? 'ACTIVE' : isDone ? 'DONE' : 'WAIT'}
        </Text>
      </View>
    </Animated.View>
  );
}
const ps = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, padding: SP.sm, marginBottom: 5, gap: 10 },
  iconWrap: { width: 30, height: 30, borderWidth: 1, justifyContent: 'center', alignItems: 'center', borderRadius: R.none, flexShrink: 0 },
  label: { fontFamily: MONO, fontSize: 11, fontWeight: '600', letterSpacing: 0.5 },
  desc: { fontFamily: MONO, fontSize: 9, color: C.fgTertiary, marginTop: 1, lineHeight: 13 },
  status: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: R.none, minWidth: 42, alignItems: 'center' },
  statusText: { fontFamily: MONO, fontSize: 8, letterSpacing: 1 },
});

// ── Event log entry ───────────────────────────────────────────────────────────
function EventEntry({ event }: { event: any }) {
  const color = event.level === 'error' ? C.error
    : event.level === 'warning' ? C.warning
    : C.success;
  return (
    <View style={ee.row}>
      <Text style={[ee.ts, { color }]}>{event.ts}</Text>
      <View style={[ee.dot, { backgroundColor: color }]} />
      <Text style={[ee.msg, event.level === 'error' && { color: C.error }]} numberOfLines={2}>
        {event.msg}
      </Text>
    </View>
  );
}
const ee = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: C.borderSubtle, gap: 6 },
  ts: { fontFamily: MONO, fontSize: 9, width: 70, flexShrink: 0 },
  dot: { width: 4, height: 4, borderRadius: R.xs, marginTop: 4, flexShrink: 0 },
  msg: { fontFamily: MONO, fontSize: 10, color: C.fgSecondary, flex: 1, lineHeight: 15 },
});

// ── Main ──────────────────────────────────────────────────────────────────────
export default function ScenarioScreen() {
  const router = useRouter();
  const [status, setStatus] = useState<any>(null);
  const [prevLive, setPrevLive] = useState<any>(null);
  const [running, setRunning] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const pollRef = useRef<any>(null);
  const progressAnim = useRef(new Animated.Value(0)).current;

  const load = async () => {
    try {
      const s = await api.getScenarioStatus();
      setStatus((prev: any) => {
        if (prev?.live) setPrevLive(prev.live);
        return s;
      });
      setRunning(s.running);
      // Animate progress bar
      const target = (s.phase_index / 6) * 100;
      Animated.timing(progressAnim, {
        toValue: target, duration: 300, useNativeDriver: false,
      }).start();
    } catch {}
  };

  useEffect(() => {
    load();
    pollRef.current = setInterval(load, 400); // 400ms — faster than backend 500ms tick
    return () => clearInterval(pollRef.current);
  }, []);

  // Auto-scroll log to bottom
  useEffect(() => {
    if (status?.events?.length) {
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [status?.events?.length]);

  const startScenario = async () => {
    haptic.heavy();
    try {
      await api.runScenario();
      setRunning(true);
      haptic.success();
    } catch { haptic.error(); }
  };

  const live = status?.live || {};
  const phase = status?.phase;
  const phaseIdx = status?.phase_index || 0;
  const isComplete = phase === 'complete';
  const result = status?.result;

  // Color helpers
  const stabilityColor = live.stability
    ? Math.abs(live.stability - 1.42) < 0.05 ? C.success
    : Math.abs(live.stability - 1.42) < 0.1 ? C.warning : C.error
    : C.fg;
  const thermalColor = live.thermal_pressure === 'critical' ? C.error
    : live.thermal_pressure === 'moderate' ? C.warning : C.success;
  const netColor = (live.network_stability || 1) > 0.6 ? C.success
    : (live.network_stability || 1) > 0.2 ? C.warning : C.error;

  return (
    <SafeAreaView style={RESET.screen} testID="scenario-screen">
      {/* Header */}
      <View style={RESET.header}>
        <TouchableOpacity onPress={() => { haptic.tap(); router.back(); }}>
          <Feather name="arrow-left" size={20} color={C.fgSecondary} />
        </TouchableOpacity>
        <Text style={{ fontFamily: MONO, fontSize: 11, color: C.fg, letterSpacing: 4 }}>
          SCENARIO RUNNER
        </Text>
        <View style={[sc.phaseBadge, { borderColor: `${status?.phase_color || C.fgTertiary}40` }]}>
          <Text style={[sc.phaseLabel, { color: status?.phase_color || C.fgTertiary }]}>
            {status?.phase_label || 'IDLE'}
          </Text>
        </View>
      </View>

      <BridgeStatusBar />

      {/* Progress bar */}
      <View style={sc.progressTrack}>
        <Animated.View style={[sc.progressFill, {
          width: progressAnim.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }),
          backgroundColor: isComplete ? C.success : running ? C.accent : C.fgTertiary,
        }]} />
        {PHASES.map((_, i) => (
          <View key={i} style={[sc.progressMarker, { left: `${(i + 1) / 6 * 100}%` as any }]} />
        ))}
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: SP.lg, paddingTop: SP.sm }} showsVerticalScrollIndicator={false}>

        {/* Launch button */}
        {!running && !isComplete && (
          <TouchableOpacity style={sc.launchBtn} onPress={startScenario} activeOpacity={0.8}>
            <View style={sc.launchInner}>
              <Feather name="play" size={20} color={C.bg} style={{ marginRight: 10 }} />
              <View>
                <Text style={sc.launchLabel}>RUN INTEGRATION SCENARIO</Text>
                <Text style={sc.launchDesc}>Thermal → Simulated → Mesh → AI Prediction → Emergency</Text>
              </View>
            </View>
          </TouchableOpacity>
        )}

        {running && (
          <View style={sc.runningBanner}>
            <Animated.View style={[sc.runningDot, {
              opacity: progressAnim.interpolate({ inputRange: [0, 100], outputRange: [1, 0.3] }),
            }]} />
            <Text style={sc.runningText}>SCENARIO EXECUTING — Phase {phaseIdx}/5</Text>
          </View>
        )}

        {isComplete && result && (
          <View style={[sc.resultCard, { borderColor: `${C.success}40` }]}>
            <View style={sc.resultHeader}>
              <Feather name="check-circle" size={18} color={C.success} />
              <Text style={[sc.resultTitle, { color: C.success }]}>SCENARIO COMPLETE</Text>
            </View>
            {[
              ['Thermal triggered', result.thermal_triggered ? 'YES' : 'NO', result.thermal_triggered ? C.error : C.fgSecondary],
              ['Simulated mode', result.simulated_mode_triggered ? 'YES' : 'NO', result.simulated_mode_triggered ? C.warning : C.fgSecondary],
              ['Mesh peer found', result.mesh_peer_found ? 'YES' : 'NO', result.mesh_peer_found ? C.blue : C.fgSecondary],
              ['Confidence degraded', result.confidence_degraded ? 'YES' : 'NO', result.confidence_degraded ? C.purple : C.fgSecondary],
              ['Emergency executed', result.emergency_reset_executed ? 'YES' : 'NO', result.emergency_reset_executed ? C.error : C.fgSecondary],
              ['Final stability', result.final_stability?.toFixed(6), Math.abs(result.final_stability - 1.42) < 0.01 ? C.success : C.warning],
              ['Final thermal', `${result.final_thermal?.toFixed(1)}°C`, C.success],
              ['Final network', `${Math.round((result.final_network || 0) * 100)}%`, C.success],
            ].map(([k, v, c]: any) => (
              <View key={k} style={sc.resultRow}>
                <Text style={sc.resultKey}>{k}</Text>
                <Text style={[sc.resultVal, { color: c }]}>{v}</Text>
              </View>
            ))}
            <TouchableOpacity style={sc.rerunBtn} onPress={startScenario}>
              <Text style={sc.rerunText}>RUN AGAIN</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Phase steps */}
        <Text style={RESET.sectionLabel}>SCENARIO PHASES</Text>
        {PHASES.map(p => (
          <PhaseStep key={p.id} phase={p} currentPhase={phase} phaseIndex={phaseIdx} />
        ))}

        {/* Live system metrics */}
        <Text style={[RESET.sectionLabel, { marginTop: SP.md }]}>LIVE SYSTEM STATE</Text>
        <View style={[GRID.border, { padding: SP.md, backgroundColor: C.surface, marginBottom: SP.sm }]}>
          <LiveRow
            label="STABILITY"
            value={live.stability?.toFixed(6) ?? '1.420000'}
            color={stabilityColor}
            prev={prevLive?.stability?.toFixed(6)}
          />
          <LiveRow
            label="THERMAL"
            value={`${live.thermal_c?.toFixed(1) ?? '35.0'}°C  [${(live.thermal_pressure || 'nominal').toUpperCase()}]`}
            color={thermalColor}
            prev={`${prevLive?.thermal_c?.toFixed(1)}°C`}
          />
          <LiveRow
            label="THROTTLING"
            value={live.throttling ? '⚠ ACTIVE — ECO FORCED' : 'NO'}
            color={live.throttling ? C.error : C.success}
          />
          <LiveRow
            label="IS_SIMULATED"
            value={live.is_simulated ? 'TRUE — dim mode active' : 'false'}
            color={live.is_simulated ? C.warning : C.success}
            prev={String(prevLive?.is_simulated)}
          />
          <LiveRow
            label="NETWORK"
            value={`${Math.round((live.network_stability || 1) * 100)}%`}
            color={netColor}
            prev={`${Math.round((prevLive?.network_stability || 1) * 100)}%`}
          />
          <LiveRow
            label="PEERS"
            value={`${live.peer_count ?? 0} discovered`}
            color={live.peer_count > 0 ? C.blue : C.fgSecondary}
          />
          <LiveRow
            label="CONFIDENCE"
            value={`${Math.round((live.confidence || 1) * 100)}%`}
            color={
              (live.confidence || 1) > 0.7 ? C.success :
              (live.confidence || 1) > 0.4 ? C.warning : C.error
            }
            prev={`${Math.round((prevLive?.confidence || 1) * 100)}%`}
          />
          <LiveRow
            label="AGENT STATUS"
            value={live.agent_status || 'Idle'}
            color={live.agent_status === 'Warning' ? C.error : live.agent_status === 'Optimizing' ? C.warning : C.success}
          />
          <LiveRow
            label="EMERGENCY COUNT"
            value={String(live.emergency_count ?? 0)}
            color={live.emergency_count > 0 ? C.error : C.fgSecondary}
            prev={String(prevLive?.emergency_count ?? 0)}
          />
        </View>

        {/* Scenario event log */}
        <Text style={RESET.sectionLabel}>SCENARIO LOG</Text>
        <View style={[GRID.border, { padding: SP.sm, backgroundColor: '#060606', minHeight: 120 }]}>
          <ScrollView ref={scrollRef} style={{ maxHeight: 280 }} nestedScrollEnabled showsVerticalScrollIndicator={false}>
            {(status?.events || []).map((ev: any, i: number) => (
              <EventEntry key={i} event={ev} />
            ))}
            {!status?.events?.length && (
              <Text style={sc.emptyLog}>Press RUN to start scenario...</Text>
            )}
          </ScrollView>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const sc = StyleSheet.create({
  phaseBadge: { borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3, borderRadius: R.none },
  phaseLabel: { fontFamily: MONO, fontSize: 9, letterSpacing: 1 },
  progressTrack: { height: 3, backgroundColor: C.borderSubtle, position: 'relative' },
  progressFill: { position: 'absolute', left: 0, top: 0, bottom: 0 },
  progressMarker: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: C.bg },
  launchBtn: { marginBottom: SP.md, borderWidth: 2, borderColor: C.accent, backgroundColor: C.accentDim, borderRadius: R.none },
  launchInner: { flexDirection: 'row', alignItems: 'center', padding: SP.lg, backgroundColor: C.accent },
  launchLabel: { fontFamily: MONO, fontSize: 14, color: C.bg, letterSpacing: 2, fontWeight: '700' },
  launchDesc: { fontFamily: MONO, fontSize: 9, color: 'rgba(5,5,5,0.7)', marginTop: 3, letterSpacing: 0.5 },
  runningBanner: {
    flexDirection: 'row', alignItems: 'center', gap: SP.sm,
    borderWidth: 1, borderColor: `${C.accent}40`,
    backgroundColor: C.accentDim, padding: SP.md, marginBottom: SP.md, borderRadius: R.none,
  },
  runningDot: { width: 8, height: 8, borderRadius: R.xs, backgroundColor: C.accent, flexShrink: 0 },
  runningText: { fontFamily: MONO, fontSize: 11, color: C.accent, letterSpacing: 1 },
  resultCard: { borderWidth: 1, padding: SP.md, marginBottom: SP.md, backgroundColor: C.surface },
  resultHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: SP.md },
  resultTitle: { fontFamily: MONO, fontSize: 12, letterSpacing: 2, fontWeight: '700' },
  resultRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: C.borderSubtle },
  resultKey: { fontFamily: MONO, fontSize: 10, color: C.fgSecondary },
  resultVal: { fontFamily: MONO, fontSize: 11, fontWeight: '600' },
  rerunBtn: { marginTop: SP.md, borderWidth: 1, borderColor: C.border, padding: SP.sm, alignItems: 'center' },
  rerunText: { fontFamily: MONO, fontSize: 11, color: C.fgSecondary, letterSpacing: 2 },
  emptyLog: { fontFamily: MONO, fontSize: 11, color: C.fgTertiary, textAlign: 'center', paddingVertical: SP.xl },
});
