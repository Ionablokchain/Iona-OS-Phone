/**
 * IONA Shell — The Strategic Console
 * ConsoleRenderer for phone, mirrors gui/apps/iona_shell.rs exactly.
 *
 * Layout:
 *   Status Bar: IONA OS | TRUST: N%
 *   Metrics 2×2: INTEGRITY / THERMAL / NETWORK / STABILITY
 *   Sovereign: Mandate status + score
 *   Enclave: TEE slot status
 *   Genesis: Recovery capsule status
 *   Terminal: Last 5 audit entries
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  RefreshControl, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { C, MONO, R, SP, GRID, RESET } from '@/src/theme';
import { api } from '@/src/utils/api';
import { haptic } from '@/src/utils/haptics';

// ─── Metric card (matches ConsoleRenderer::render_metric) ────────────────────
function MetricCard({ label, value, unit = '', pct, color, sub }: {
  label: string; value: string | number; unit?: string;
  pct: number; color: string; sub?: string;
}) {
  const barAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(barAnim, {
      toValue: Math.min(1, Math.max(0, pct)),
      duration: 600, useNativeDriver: false,
    }).start();
  }, [pct]);

  return (
    <View style={[mc.wrap, { borderColor: `${color}25` }]}>
      <Text style={mc.label}>{label}</Text>
      <View style={mc.valueRow}>
        <Text style={[mc.value, { color }]}>{value}</Text>
        {unit ? <Text style={mc.unit}>{unit}</Text> : null}
      </View>
      <View style={mc.track}>
        <Animated.View style={[mc.fill, {
          width: barAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
          backgroundColor: color,
        }]} />
      </View>
      {sub && <Text style={mc.sub}>{sub}</Text>}
    </View>
  );
}
const mc = StyleSheet.create({
  wrap: { flex: 1, borderWidth: 1, padding: SP.sm, backgroundColor: '#0A0A0A', margin: 3 },
  label: { fontFamily: MONO, fontSize: 8, color: C.fgTertiary, letterSpacing: 2, marginBottom: 3 },
  valueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 3 },
  value: { fontFamily: MONO, fontSize: 20, fontWeight: '200' },
  unit: { fontFamily: MONO, fontSize: 9, color: C.fgTertiary },
  track: { height: 3, backgroundColor: C.borderSubtle, marginTop: SP.sm },
  fill: { height: 3 },
  sub: { fontFamily: MONO, fontSize: 8, color: C.fgTertiary, marginTop: 3 },
});

// ─── Status indicator dot ─────────────────────────────────────────────────────
function StatusDot({ active, color, label }: { active: boolean; color: string; label: string }) {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (active) {
      Animated.loop(Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.5, duration: 800, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
      ])).start();
    } else { pulseAnim.setValue(1); }
  }, [active]);
  return (
    <View style={sd.row}>
      <Animated.View style={[sd.dot, { backgroundColor: color, transform: [{ scale: pulseAnim }] }]} />
      <Text style={[sd.label, { color: active ? color : C.fgTertiary }]}>{label}</Text>
    </View>
  );
}
const sd = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: R.xs },
  label: { fontFamily: MONO, fontSize: 9, letterSpacing: 1 },
});

// ─── Terminal feed line ───────────────────────────────────────────────────────
function TerminalLine({ text }: { text: string }) {
  const color = text.includes('TAMPER') || text.includes('ERROR') || text.includes('WIPE') ? C.error
    : text.includes('WARN') || text.includes('THERMAL') || text.includes('CRITICAL') ? C.warning
    : text.includes('ZK') || text.includes('SOVEREIGN') || text.includes('ENCLAVE') ? C.accent
    : text.includes('GENESIS') || text.includes('SUCCESS') ? C.success
    : C.fgSecondary;
  return <Text style={[tl.text, { color }]} numberOfLines={1}>{`> ${text}`}</Text>;
}
const tl = StyleSheet.create({
  text: { fontFamily: MONO, fontSize: 10, lineHeight: 16 },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────
export default function ShellScreen() {
  const router = useRouter();
  const [shell, setShell] = useState<any>(null);
  const [enclave, setEnclave] = useState<any>(null);
  const [genesis, setGenesis] = useState<any>(null);
  const [sovereign, setSovereign] = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const pollRef = useRef<any>(null);

  // Trust band pulse
  const trustAnim = useRef(new Animated.Value(0)).current;

  const loadAll = async () => {
    try {
      const [s, e, g, sv] = await Promise.all([
        api.getShellState(),
        api.enclaveStatus(),
        api.genesisStatus(),
        api.sovereignStatus(),
      ]);
      setShell(s);
      setEnclave(e);
      setGenesis(g);
      setSovereign(sv);

      // Animate trust bar on update
      Animated.timing(trustAnim, {
        toValue: (s.trust_band || 0) / 100,
        duration: 400, useNativeDriver: false,
      }).start();
    } catch {}
  };

  useEffect(() => {
    loadAll();
    pollRef.current = setInterval(loadAll, 2000);
    return () => clearInterval(pollRef.current);
  }, []);

  const onRefresh = async () => {
    haptic.tap(); setRefreshing(true);
    await loadAll(); setRefreshing(false);
  };

  // Genesis capsule actions
  const createCapsule = async () => {
    haptic.medium(); setLoading('genesis');
    try {
      await api.genesisCreateCapsule();
      haptic.success();
      await loadAll();
    } catch { haptic.error(); }
    setLoading(null);
  };

  const recoverFromCapsule = async () => {
    haptic.heavy(); setLoading('recover');
    try {
      const result = await api.genesisRecover();
      if (result.success) haptic.success();
      else haptic.error();
      await loadAll();
    } catch { haptic.error(); }
    setLoading(null);
  };

  // Enclave actions
  const wipeEnclave = async () => {
    haptic.heavy(); setLoading('wipe');
    try {
      await api.enclaveWipe();
      haptic.success();
      await loadAll();
    } catch { haptic.error(); }
    setLoading(null);
  };

  const s = shell || {};
  const trustBand = s.trust_band || 0;
  const trustColor = trustBand > 70 ? C.success : trustBand > 40 ? C.warning : C.error;
  const stabilityColor = Math.abs((s.stability || 1.42) - 1.42) < 0.05 ? C.success
    : Math.abs((s.stability || 1.42) - 1.42) < 0.1 ? C.warning : C.error;
  const thermalColor = s.thermal_state === 'Critical' ? C.error
    : s.thermal_state === 'Warm' ? C.warning : C.success;

  return (
    <SafeAreaView style={[RESET.screen, { backgroundColor: '#0A0A0A' }]} testID="shell-screen">

      {/* Status Bar — "IONA OS | TRUST: N%" */}
      <View style={ss.statusBar}>
        <TouchableOpacity onPress={() => { haptic.tap(); router.back(); }}>
          <Feather name="arrow-left" size={16} color={C.fgSecondary} />
        </TouchableOpacity>
        <Text style={ss.statusText}>{s.status_bar_text || 'IONA OS | TRUST: --'}</Text>
        <View style={ss.statusRight}>
          <StatusDot active={!s.is_simulated} color={C.success} label="LIVE" />
        </View>
      </View>

      {/* Trust Band — full-width reactive bar */}
      <View style={ss.trustTrack}>
        <Animated.View style={[ss.trustFill, {
          width: trustAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
          backgroundColor: trustColor,
        }]} />
        <Text style={[ss.trustLabel, { color: trustColor }]}>TRUST BAND: {trustBand}%</Text>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: SP.sm, paddingTop: SP.xs }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}
      >

        {/* Metrics 2×2 — ConsoleRenderer::render_metric */}
        <View style={ss.metricsGrid}>
          <MetricCard
            label="INTEGRITY"
            value={`${s.integrity_pct ?? '--'}%`}
            pct={(s.integrity_pct ?? 0) / 100}
            color={s.integrity_pct > 80 ? C.success : s.integrity_pct > 50 ? C.warning : C.error}
            sub={`drift: ${Math.abs(s.stability_delta || 0).toFixed(4)}`}
          />
          <MetricCard
            label="THERMAL"
            value={`${s.thermal_c ?? '--'}`}
            unit="°C"
            pct={1 - Math.min(1, ((s.thermal_c || 35) - 20) / 80)}
            color={thermalColor}
            sub={s.thermal_state || 'nominal'}
          />
        </View>
        <View style={ss.metricsGrid}>
          <MetricCard
            label="STABILITY"
            value={(s.stability || 1.42).toFixed(4)}
            pct={Math.min(1, (s.stability || 1.42) / 1.6)}
            color={stabilityColor}
            sub={`Δ ${s.stability_delta >= 0 ? '+' : ''}${(s.stability_delta || 0).toFixed(4)}`}
          />
          <MetricCard
            label="NETWORK"
            value={`${Math.round(s.network_pct || 0)}%`}
            pct={(s.network_pct || 0) / 100}
            color={s.network_pct > 60 ? C.success : s.network_pct > 20 ? C.warning : C.error}
            sub={`${s.mesh_nodes || 0} mesh peers`}
          />
        </View>

        {/* System status indicators */}
        <View style={[GRID.border, ss.indicatorCard]}>
          <View style={ss.indicatorGrid}>
            <StatusDot active={!s.is_simulated}           color={C.success}  label="KERNEL" />
            <StatusDot active={s.vfs_mounted && !s.vfs_frozen} color={C.accent} label="VFS" />
            <StatusDot active={s.enclave_armed}            color={C.success}  label="ENCLAVE" />
            <StatusDot active={!!sovereign?.enrolled}      color={C.success}  label="MANDATE" />
            <StatusDot active={s.thermal_state === 'Nominal'} color={C.success} label="THERMAL" />
            <StatusDot active={s.mesh_nodes > 0}          color={C.blue}     label="MESH" />
          </View>
        </View>

        {/* Sovereign + Genesis card */}
        <View style={[GRID.border, ss.card]}>
          <View style={ss.cardHeader}>
            <Text style={RESET.sectionLabel}>SOVEREIGN IDENTITY</Text>
            <View style={[ss.scoreBadge, { borderColor: `${trustColor}40` }]}>
              <Text style={[ss.scoreText, { color: trustColor }]}>SCORE: {trustBand}</Text>
            </View>
          </View>
          {[
            ['Mandate', sovereign?.enrolled ? 'ACTIVE' : 'NOT ENROLLED'],
            ['Mandate hash', sovereign?.mandate_short || 'none'],
            ['Proof count', String(sovereign?.proof_count || 0)],
            ['Nullifiers', `${sovereign?.nullifier_log_size || 0} logged`],
          ].map(([k, v]) => (
            <View key={k} style={ss.row}>
              <Text style={ss.rowK}>{k}</Text>
              <Text style={[ss.rowV, k === 'Mandate' && { color: sovereign?.enrolled ? C.success : C.error }]}>{v}</Text>
            </View>
          ))}
          <TouchableOpacity
            style={ss.actionBtn}
            onPress={() => router.push('/(os)/sovereign')}
          >
            <Feather name="shield" size={13} color={C.accent} />
            <Text style={[ss.actionText, { color: C.accent }]}>Open Sovereign Handshake</Text>
          </TouchableOpacity>
        </View>

        {/* Enclave TEE card */}
        <View style={[GRID.border, ss.card, enclave?.emergency_wiped && { borderColor: `${C.error}40` }]}>
          <Text style={RESET.sectionLabel}>SECURE ENCLAVE (TEE)</Text>
          {[
            ['State',        enclave?.armed ? 'ARMED' : enclave?.emergency_wiped ? 'WIPED' : 'DISARMED'],
            ['Slots used',   `${enclave?.slots_used || 0}/${enclave?.slots_total || 16}`],
            ['Audit entries',String(enclave?.audit_entries || 0)],
            ['Tick',         String(enclave?.tick || 0)],
          ].map(([k, v]) => (
            <View key={k} style={ss.row}>
              <Text style={ss.rowK}>{k}</Text>
              <Text style={[ss.rowV,
                k === 'State' && { color: enclave?.armed ? C.success : C.error }
              ]}>{v}</Text>
            </View>
          ))}
          <TouchableOpacity
            style={[ss.actionBtn, { borderColor: `${C.error}25` }]}
            onPress={wipeEnclave}
            disabled={loading === 'wipe'}
          >
            <Feather name="trash-2" size={13} color={C.error} />
            <Text style={[ss.actionText, { color: C.error }]}>
              {loading === 'wipe' ? 'Wiping...' : 'Emergency Wipe All Slots'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Genesis Recovery card */}
        <View style={[GRID.border, ss.card]}>
          <Text style={RESET.sectionLabel}>GENESIS RECOVERY</Text>
          {[
            ['Capsule stored', genesis?.capsule_stored ? 'YES' : 'NO'],
            ['Sequence',       String(genesis?.sequence || 0)],
            ['Recovery count', String(genesis?.recovery_count || 0)],
            ['Last recovery',  genesis?.last_recovery_at?.slice(11, 19) || 'never'],
          ].map(([k, v]) => (
            <View key={k} style={ss.row}>
              <Text style={ss.rowK}>{k}</Text>
              <Text style={[ss.rowV, k === 'Capsule stored' && { color: genesis?.capsule_stored ? C.success : C.warning }]}>{v}</Text>
            </View>
          ))}
          <View style={ss.btnRow}>
            <TouchableOpacity
              style={[ss.halfBtn, { borderColor: `${C.accent}30` }]}
              onPress={createCapsule}
              disabled={loading === 'genesis'}
            >
              <Text style={[ss.halfBtnText, { color: C.accent }]}>
                {loading === 'genesis' ? 'Creating...' : 'Create Capsule'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[ss.halfBtn, { borderColor: `${C.warning}30` }]}
              onPress={recoverFromCapsule}
              disabled={loading === 'recover' || !genesis?.capsule_stored}
            >
              <Text style={[ss.halfBtnText, { color: C.warning }]}>
                {loading === 'recover' ? 'Recovering...' : 'Attempt Recovery'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Terminal feed — "MANDATE ENGINE: LIVE / LATTICE STORAGE: MOUNTED" */}
        <View style={ss.terminal}>
          <Text style={ss.terminalHeader}>TERMINAL FEED</Text>
          <Text style={[ss.terminalLine, { color: C.success }]}>{'> ' + (s.mandate_status || 'MANDATE ENGINE: LIVE')}</Text>
          <Text style={[ss.terminalLine, { color: s.vfs_frozen ? C.error : C.success }]}>
            {'> ' + (s.storage_status || 'LATTICE STORAGE: MOUNTED')}
          </Text>
          {(s.terminal_feed || []).map((line: string, i: number) => (
            <TerminalLine key={i} text={line} />
          ))}
          <View style={ss.cursor}>
            <Text style={[ss.terminalLine, { color: C.accent }]}>{'> _'}</Text>
          </View>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const ss = StyleSheet.create({
  statusBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: SP.lg, paddingVertical: SP.sm, backgroundColor: '#1A1A1A' },
  statusText: { fontFamily: MONO, fontSize: 11, color: C.success, letterSpacing: 1 },
  statusRight: { flexDirection: 'row', gap: SP.md },
  trustTrack: { height: 20, backgroundColor: '#111', justifyContent: 'center' },
  trustFill: { position: 'absolute', left: 0, top: 0, bottom: 0 },
  trustLabel: { fontFamily: MONO, fontSize: 9, letterSpacing: 2, paddingLeft: SP.sm },
  metricsGrid: { flexDirection: 'row', marginBottom: 2 },
  indicatorCard: { padding: SP.md, backgroundColor: '#0A0A0A', marginBottom: SP.sm },
  indicatorGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.lg },
  card: { padding: SP.md, backgroundColor: '#0A0A0A', marginBottom: SP.sm },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SP.xs },
  scoreBadge: { borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  scoreText: { fontFamily: MONO, fontSize: 9, letterSpacing: 1 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: C.borderSubtle },
  rowK: { fontFamily: MONO, fontSize: 10, color: C.fgSecondary },
  rowV: { fontFamily: MONO, fontSize: 10, color: C.fg },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: C.border, height: 36, paddingHorizontal: SP.md, marginTop: SP.sm, justifyContent: 'center' },
  actionText: { fontFamily: MONO, fontSize: 11 },
  btnRow: { flexDirection: 'row', gap: 8, marginTop: SP.sm },
  halfBtn: { flex: 1, height: 36, borderWidth: 1, justifyContent: 'center', alignItems: 'center' },
  halfBtnText: { fontFamily: MONO, fontSize: 10 },
  terminal: { borderWidth: 1, borderColor: C.borderSubtle, padding: SP.md, backgroundColor: '#000' },
  terminalHeader: { fontFamily: MONO, fontSize: 8, color: C.fgTertiary, letterSpacing: 2, marginBottom: SP.xs },
  terminalLine: { fontFamily: MONO, fontSize: 10, lineHeight: 16 },
  cursor: {},
});
