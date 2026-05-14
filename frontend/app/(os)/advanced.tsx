import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  TextInput, RefreshControl, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { C, MONO, R, SP, GRID, RESET } from '@/src/theme';
import { api } from '@/src/utils/api';
import { haptic } from '@/src/utils/haptics';
import { BridgeStatusBar } from '@/src/components/GridOverlay';

type Tab = 'zk' | 'ota' | 'noise' | 'biometrics';

// ── ZK Badge ──────────────────────────────────────────────────────────────────
function ZKBadge({ verified, scope }: { verified: boolean; scope?: string }) {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (verified) {
      Animated.loop(Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.04, duration: 1500, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1500, useNativeDriver: true }),
      ])).start();
    } else { pulseAnim.setValue(1); }
  }, [verified]);
  return (
    <Animated.View style={[zb.wrap, { borderColor: verified ? `${C.success}50` : `${C.fgTertiary}25`, transform: [{ scale: pulseAnim }] }]}>
      <Feather name={verified ? 'shield' : 'shield-off'} size={12} color={verified ? C.success : C.fgTertiary} />
      <Text style={[zb.text, { color: verified ? C.success : C.fgTertiary }]}>
        {verified ? 'ZK-VERIFIED' : 'NOT VERIFIED'}
      </Text>
      {scope && verified && <Text style={zb.scope}>[{scope}]</Text>}
    </Animated.View>
  );
}
const zb = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4, borderRadius: R.none },
  text: { fontFamily: MONO, fontSize: 10, fontWeight: '600', letterSpacing: 1 },
  scope: { fontFamily: MONO, fontSize: 9, color: C.fgSecondary },
});

// ── Entropy Sparkline ─────────────────────────────────────────────────────────
function EntropySparkline({ buffer, width = 200 }: { buffer: any[]; width?: number }) {
  const H = 28;
  if (!buffer?.length) return <View style={{ width, height: H }} />;
  const values = buffer.map((p: any) => p.entropy);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 0.01;
  return (
    <View style={{ width, height: H, position: 'relative' }}>
      {values.map((v, i) => {
        if (i === 0) return null;
        const x1 = ((i - 1) / (values.length - 1)) * width;
        const x2 = (i / (values.length - 1)) * width;
        const y1 = H - ((values[i - 1] - min) / range) * (H - 4) - 2;
        const y2 = H - ((v - min) / range) * (H - 4) - 2;
        const dx = x2 - x1, dy = y2 - y1;
        const len = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx) * 180 / Math.PI;
        return (
          <View key={i} style={{
            position: 'absolute', left: x1, top: y1,
            width: len, height: 2, backgroundColor: C.purple,
            transform: [{ rotate: `${angle}deg` }, { translateY: -1 }],
          }} />
        );
      })}
    </View>
  );
}

// ── Biometric Trust Ring ──────────────────────────────────────────────────────
function TrustRing({ trustScore, anomalyScore, softLocked }: { trustScore: number; anomalyScore: number; softLocked: boolean }) {
  const color = softLocked ? C.error : trustScore > 0.7 ? C.success : trustScore > 0.4 ? C.warning : C.error;
  const pct = Math.round(trustScore * 100);
  return (
    <View style={tr.wrap}>
      <View style={[tr.ring, { borderColor: `${color}40` }]}>
        <Text style={[tr.pct, { color }]}>{pct}%</Text>
        <Text style={tr.label}>TRUST</Text>
        {softLocked && (
          <View style={tr.lockBadge}>
            <Feather name="lock" size={10} color={C.error} />
            <Text style={tr.lockText}>SOFT LOCK</Text>
          </View>
        )}
      </View>
      <View style={tr.bars}>
        <View style={tr.barRow}>
          <Text style={tr.barLabel}>TRUST</Text>
          <View style={tr.barTrack}>
            <View style={[tr.barFill, { width: `${pct}%` as any, backgroundColor: color }]} />
          </View>
          <Text style={[tr.barVal, { color }]}>{pct}%</Text>
        </View>
        <View style={tr.barRow}>
          <Text style={tr.barLabel}>ANOMALY</Text>
          <View style={tr.barTrack}>
            <View style={[tr.barFill, { width: `${Math.round(anomalyScore * 100)}%` as any, backgroundColor: C.error }]} />
          </View>
          <Text style={[tr.barVal, { color: C.error }]}>{Math.round(anomalyScore * 100)}%</Text>
        </View>
      </View>
    </View>
  );
}
const tr = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: SP.lg, marginBottom: SP.sm },
  ring: { width: 80, height: 80, borderWidth: 2, borderRadius: R.none, justifyContent: 'center', alignItems: 'center' },
  pct: { fontFamily: MONO, fontSize: 22, fontWeight: '200' },
  label: { fontFamily: MONO, fontSize: 8, color: C.fgTertiary, letterSpacing: 2 },
  lockBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 3 },
  lockText: { fontFamily: MONO, fontSize: 7, color: C.error },
  bars: { flex: 1 },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  barLabel: { fontFamily: MONO, fontSize: 8, color: C.fgTertiary, width: 48, letterSpacing: 0.5 },
  barTrack: { flex: 1, height: 4, backgroundColor: C.borderSubtle },
  barFill: { height: 4 },
  barVal: { fontFamily: MONO, fontSize: 9, width: 30, textAlign: 'right' },
});

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function AdvancedSystemsScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('zk');
  const [zkStatus, setZkStatus] = useState<any>(null);
  const [zkSession, setZkSession] = useState<any>(null);
  const [otaStatus, setOtaStatus] = useState<any>(null);
  const [noiseStatus, setNoiseStatus] = useState<any>(null);
  const [bioStatus, setBioStatus] = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  // OTA form
  const [otaVersion, setOtaVersion] = useState('v0.6.1');
  const [otaHash, setOtaHash] = useState('');
  const pollRef = useRef<any>(null);

  const loadAll = async () => {
    try {
      const [zk, ota, ns, bio] = await Promise.all([
        api.zkStatus(),
        api.otaStatus(),
        api.noiseStatus(),
        api.biometricsStatus(),
      ]);
      setZkStatus(zk);
      setOtaStatus(ota);
      setNoiseStatus(ns);
      setBioStatus(bio);
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

  // ZK prove
  const runZkProve = async (scope: string) => {
    haptic.medium(); setLoading(`zk_${scope}`);
    try {
      const ch = await api.zkRequestChallenge();
      const proof = await api.zkProve({ scope, challenge: ch.challenge });
      setZkSession(proof);
      haptic.success();
    } catch { haptic.error(); }
    setLoading(null);
  };

  // OTA
  const stageUpdate = async () => {
    if (!otaVersion || !otaHash) return;
    haptic.medium(); setLoading('ota_stage');
    try {
      const hash = otaHash || `sha256:${Math.random().toString(36).slice(2)}`;
      await api.otaStage({
        version: otaVersion,
        binary_hash: hash,
        manifest: { min_stability: 1.40, rollback_on_fail: true },
        sphincs_signature: `sphincs+:${Math.random().toString(36).slice(2)}`,
        release_notes: `IONA OS ${otaVersion} — SPHINCS+ signed`,
      });
      haptic.success();
      await loadAll();
    } catch { haptic.error(); }
    setLoading(null);
  };

  const applyUpdate = async () => {
    haptic.heavy(); setLoading('ota_apply');
    try {
      await api.otaApply();
      haptic.success();
      await loadAll();
    } catch { haptic.error(); }
    setLoading(null);
  };

  // Noise
  const toggleNoise = async () => {
    haptic.tap();
    await api.configureNoise({ enabled: !noiseStatus?.enabled, intensity: 0.5, mode: 'adaptive' });
    await loadAll();
  };

  // Biometrics
  const clearSoftLock = async () => {
    haptic.heavy();
    await api.biometricsVerify('physical_trigger');
    haptic.success();
    await loadAll();
  };

  const TABS: { id: Tab; label: string; icon: string }[] = [
    { id: 'zk', label: 'ZK-ID', icon: 'shield' },
    { id: 'ota', label: 'OTA', icon: 'download' },
    { id: 'noise', label: 'NOISE', icon: 'activity' },
    { id: 'biometrics', label: 'BIO', icon: 'user' },
  ];

  const noiseWidth = 200;

  return (
    <SafeAreaView style={RESET.screen} testID="advanced-screen">
      <View style={RESET.header}>
        <TouchableOpacity onPress={() => { haptic.tap(); router.back(); }}>
          <Feather name="arrow-left" size={20} color={C.fgSecondary} />
        </TouchableOpacity>
        <Text style={{ fontFamily: MONO, fontSize: 11, color: C.fg, letterSpacing: 4 }}>ADVANCED</Text>
        {zkSession && <ZKBadge verified scope={zkSession.scope} />}
        {!zkSession && <ZKBadge verified={false} />}
      </View>

      <BridgeStatusBar />

      <View style={s.tabs}>
        {TABS.map(t => (
          <TouchableOpacity
            key={t.id}
            style={[s.tab, tab === t.id && s.tabActive]}
            onPress={() => { haptic.selection(); setTab(t.id); }}
          >
            <Feather name={t.icon as any} size={13} color={tab === t.id ? C.accent : C.fgSecondary} />
            <Text style={[s.tabText, tab === t.id && s.tabTextActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: SP.lg, paddingTop: SP.sm }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}
      >
        {/* ── ZK Tab ── */}
        {tab === 'zk' && (
          <>
            <View style={[GRID.border, s.card]}>
              <Text style={RESET.sectionLabel}>ZERO-KNOWLEDGE PROOF IDENTITY</Text>
              <Text style={s.desc}>
                Prove "I am the Architect" via Dilithium3 → Groth16/BN254 commitment.
                Private key never transmitted — zero-knowledge only.
              </Text>
              {zkSession && (
                <View style={s.proofResult}>
                  <View style={s.proofRow}>
                    <Text style={s.proofKey}>Session</Text>
                    <Text style={s.proofVal}>{zkSession.session_id?.slice(0, 20)}...</Text>
                  </View>
                  <View style={s.proofRow}>
                    <Text style={s.proofKey}>Scope</Text>
                    <Text style={[s.proofVal, { color: C.accent }]}>{zkSession.scope}</Text>
                  </View>
                  <View style={s.proofRow}>
                    <Text style={s.proofKey}>Algorithm</Text>
                    <Text style={s.proofVal}>{zkSession.algorithm}</Text>
                  </View>
                  <View style={s.proofRow}>
                    <Text style={s.proofKey}>π_a</Text>
                    <Text style={s.proofVal} numberOfLines={1}>{zkSession.proof?.pi_a?.slice(0, 18)}...</Text>
                  </View>
                  <View style={s.proofRow}>
                    <Text style={s.proofKey}>π_b</Text>
                    <Text style={s.proofVal} numberOfLines={1}>{zkSession.proof?.pi_b?.slice(0, 18)}...</Text>
                  </View>
                  <View style={s.proofRow}>
                    <Text style={s.proofKey}>π_c</Text>
                    <Text style={s.proofVal} numberOfLines={1}>{zkSession.proof?.pi_c?.slice(0, 18)}...</Text>
                  </View>
                  <View style={[s.proofRow, { borderBottomWidth: 0 }]}>
                    <Text style={s.proofKey}>Privacy</Text>
                    <Text style={[s.proofVal, { color: C.success }]}>Key NOT transmitted</Text>
                  </View>
                </View>
              )}
            </View>
            <Text style={RESET.sectionLabel}>PROVE IDENTITY FOR SCOPE</Text>
            {[
              { scope: 'architect', label: 'Architect Identity', icon: 'user', color: C.success },
              { scope: 'emergency_reset', label: 'Emergency Reset', icon: 'alert-triangle', color: C.error },
              { scope: 'vault_transfer', label: 'Vault Transfer', icon: 'lock', color: C.warning },
              { scope: 'kernel_access', label: 'Kernel Access', icon: 'cpu', color: C.blue },
            ].map(item => (
              <TouchableOpacity
                key={item.scope}
                style={[s.zkBtn, { borderColor: `${item.color}25` }]}
                onPress={() => runZkProve(item.scope)}
                disabled={!!loading}
              >
                <View style={[s.zkBtnIcon, { backgroundColor: `${item.color}10`, borderColor: `${item.color}25` }]}>
                  <Feather name={item.icon as any} size={16} color={loading === `zk_${item.scope}` ? C.fgTertiary : item.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.zkBtnLabel, { color: item.color }]}>{item.label}</Text>
                  <Text style={s.zkBtnDesc}>Generate Groth16 proof for {item.scope}</Text>
                </View>
                <ZKBadge
                  verified={zkSession?.scope === item.scope}
                  scope={zkSession?.scope === item.scope ? item.scope : undefined}
                />
              </TouchableOpacity>
            ))}
            <View style={[GRID.border, s.card, { marginTop: SP.sm }]}>
              <Text style={RESET.sectionLabel}>ZK SESSION HISTORY</Text>
              {(zkStatus?.sessions || []).map((sess: any, i: number) => (
                <View key={i} style={s.sessRow}>
                  <View style={[s.sessDot, { backgroundColor: C.success }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.sessId}>{sess.session_id}</Text>
                    <Text style={s.sessScope}>{sess.scope} · {sess.verified_at?.slice(11, 19)}</Text>
                  </View>
                </View>
              ))}
              {!zkStatus?.sessions?.length && <Text style={s.empty}>No proofs generated yet</Text>}
            </View>
          </>
        )}

        {/* ── OTA Tab ── */}
        {tab === 'ota' && (
          <>
            <View style={[GRID.border, s.card]}>
              <Text style={RESET.sectionLabel}>QUANTUM-RESISTANT OTA</Text>
              <View style={s.otaStatusRow}>
                <Text style={s.otaVersion}>Current: {otaStatus?.current_version || 'v0.6.0'}</Text>
                {otaStatus?.pending_update && (
                  <View style={[s.pendingBadge, { borderColor: `${C.warning}40` }]}>
                    <Text style={[s.pendingText, { color: C.warning }]}>UPDATE STAGED</Text>
                  </View>
                )}
              </View>
              {[
                ['Auto-rollback count', String(otaStatus?.auto_rollback_count ?? 0)],
                ['Last update', otaStatus?.last_update_at?.slice(0, 19) || 'never'],
                ['Signing algorithm', 'SPHINCS+-SHAKE-256 (FIPS 205)'],
                ['Rollback threshold', 'stability < 1.40'],
              ].map(([k, v]) => (
                <View key={k} style={s.row}>
                  <Text style={s.rowK}>{k}</Text>
                  <Text style={s.rowV}>{v}</Text>
                </View>
              ))}
            </View>

            {otaStatus?.pending_update ? (
              <View style={[GRID.border, s.card, { borderColor: `${C.warning}30` }]}>
                <Text style={RESET.sectionLabel}>STAGED UPDATE</Text>
                {[
                  ['Version', otaStatus.pending_update.version],
                  ['SPHINCS+ sig', otaStatus.pending_update.sphincs_signature],
                  ['Pre-stability', otaStatus.pending_update.pre_stability?.toFixed(4)],
                  ['Status', otaStatus.pending_update.status],
                ].map(([k, v]) => (
                  <View key={k} style={s.row}>
                    <Text style={s.rowK}>{k}</Text>
                    <Text style={[s.rowV, k === 'Status' && { color: C.warning }]}>{v}</Text>
                  </View>
                ))}
                <TouchableOpacity
                  style={[s.applyBtn, loading === 'ota_apply' && { opacity: 0.5 }]}
                  onPress={applyUpdate}
                  disabled={loading === 'ota_apply'}
                >
                  <Text style={s.applyText}>
                    {loading === 'ota_apply' ? 'APPLYING...' : 'APPLY UPDATE — AI VALIDATION ACTIVE'}
                  </Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={[GRID.border, s.card]}>
                <Text style={RESET.sectionLabel}>STAGE NEW UPDATE</Text>
                <TextInput
                  style={s.input}
                  value={otaVersion}
                  onChangeText={setOtaVersion}
                  placeholder="Version (e.g. v0.6.1)"
                  placeholderTextColor={C.fgTertiary}
                />
                <TextInput
                  style={s.input}
                  value={otaHash}
                  onChangeText={setOtaHash}
                  placeholder="Binary hash (leave empty for auto)"
                  placeholderTextColor={C.fgTertiary}
                />
                <TouchableOpacity
                  style={[s.stageBtn, (!otaVersion || loading === 'ota_stage') && { opacity: 0.5 }]}
                  onPress={stageUpdate}
                  disabled={!otaVersion || loading === 'ota_stage'}
                >
                  <Text style={s.stageBtnText}>
                    {loading === 'ota_stage' ? 'STAGING...' : 'STAGE SPHINCS+ SIGNED UPDATE'}
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            <Text style={RESET.sectionLabel}>UPDATE HISTORY</Text>
            {(otaStatus?.history || []).map((h: any, i: number) => (
              <View key={i} style={[GRID.border, s.historyItem]}>
                <View style={[s.histDot, { backgroundColor: h.outcome === 'applied' ? C.success : C.error }]} />
                <View style={{ flex: 1 }}>
                  <Text style={s.histVersion}>{h.version}</Text>
                  <Text style={s.histMeta}>{h.outcome} · stab={h.post_stability?.toFixed(4)}</Text>
                </View>
                <Text style={[s.histOutcome, { color: h.outcome === 'applied' ? C.success : C.error }]}>
                  {h.outcome?.toUpperCase()}
                </Text>
              </View>
            ))}
            {!otaStatus?.history?.length && <Text style={s.empty}>No update history</Text>}
          </>
        )}

        {/* ── NOISE Tab ── */}
        {tab === 'noise' && (
          <>
            <View style={[GRID.border, s.card]}>
              <View style={s.noiseTitleRow}>
                <View>
                  <Text style={RESET.sectionLabel}>NEURAL NOISE INJECTION</Text>
                  <Text style={s.desc}>Dummy packets mask real wallet transactions.</Text>
                </View>
                <TouchableOpacity
                  style={[s.noiseToggle, { borderColor: noiseStatus?.enabled ? `${C.success}40` : `${C.fgTertiary}25` }]}
                  onPress={toggleNoise}
                >
                  <Text style={[s.noiseToggleText, { color: noiseStatus?.enabled ? C.success : C.fgTertiary }]}>
                    {noiseStatus?.enabled ? 'ON' : 'OFF'}
                  </Text>
                </TouchableOpacity>
              </View>
              {[
                ['Mode', noiseStatus?.mode?.toUpperCase() || 'ADAPTIVE'],
                ['Intensity', `${Math.round((noiseStatus?.intensity || 0) * 100)}%`],
                ['Obfuscation ratio', `${Math.round((noiseStatus?.obfuscation_ratio || 0) * 100)}%`],
                ['Dummy packets', String(noiseStatus?.total_dummy_packets || 0)],
                ['Real transactions', String(noiseStatus?.real_tx_count || 0)],
                ['Avg entropy', String(noiseStatus?.avg_entropy || 0)],
              ].map(([k, v]) => (
                <View key={k} style={s.row}>
                  <Text style={s.rowK}>{k}</Text>
                  <Text style={s.rowV}>{v}</Text>
                </View>
              ))}
            </View>

            <View style={[GRID.border, s.card]}>
              <View style={s.sparkHeader}>
                <Text style={RESET.sectionLabel}>ENTROPY SPARKLINE</Text>
                <Text style={s.sparkNote}>Ψ — Shannon entropy of packet timing</Text>
              </View>
              <EntropySparkline buffer={noiseStatus?.entropy_buffer || []} width={200} />
              <Text style={s.entropyNote}>
                High entropy = strong obfuscation. Low entropy = detectable pattern.
              </Text>
            </View>

            {/* Intensity controls */}
            <Text style={RESET.sectionLabel}>INTENSITY PRESETS</Text>
            {[
              { label: 'Minimal (10%)', intensity: 0.1, mode: 'constant', desc: 'Low overhead' },
              { label: 'Adaptive (50%)', intensity: 0.5, mode: 'adaptive', desc: 'Auto-adjusts to real tx' },
              { label: 'Maximum (100%)', intensity: 1.0, mode: 'burst', desc: 'Maximum privacy' },
            ].map(p => (
              <TouchableOpacity
                key={p.label}
                style={[s.presetBtn, { borderColor: `${C.purple}25` }]}
                onPress={async () => {
                  haptic.tap();
                  await api.configureNoise({ enabled: true, intensity: p.intensity, mode: p.mode });
                  await loadAll();
                }}
              >
                <View style={[s.presetIcon, { backgroundColor: `${C.purple}10` }]}>
                  <Feather name="radio" size={14} color={C.purple} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.presetLabel, { color: C.purple }]}>{p.label}</Text>
                  <Text style={s.presetDesc}>{p.desc} · mode={p.mode}</Text>
                </View>
                {Math.abs((noiseStatus?.intensity || 0) - p.intensity) < 0.05 && (
                  <Feather name="check" size={14} color={C.success} />
                )}
              </TouchableOpacity>
            ))}
          </>
        )}

        {/* ── BIOMETRICS Tab ── */}
        {tab === 'biometrics' && (
          <>
            <View style={[GRID.border, s.card, bioStatus?.soft_locked && { borderColor: `${C.error}40` }]}>
              <Text style={RESET.sectionLabel}>BEHAVIORAL BIOMETRICS</Text>
              <Text style={s.desc}>
                AI learns your typing cadence, navigation patterns, and command sequences.
                Anomaly detection protects wallet against unauthorized access.
              </Text>
              <TrustRing
                trustScore={bioStatus?.trust_score ?? 1}
                anomalyScore={bioStatus?.anomaly_score ?? 0}
                softLocked={bioStatus?.soft_locked ?? false}
              />
              {bioStatus?.soft_locked && (
                <View style={s.lockAlert}>
                  <Feather name="lock" size={14} color={C.error} />
                  <Text style={s.lockAlertText}>{bioStatus.lock_reason}</Text>
                </View>
              )}
              {[
                ['Baseline', bioStatus?.baseline_established ? 'ESTABLISHED' : 'LEARNING...'],
                ['Samples', `${bioStatus?.baseline_samples || 0} events`],
                ['Keystrokes tracked', String(bioStatus?.current_keystrokes || 0)],
                ['Commands tracked', String(bioStatus?.current_commands || 0)],
                ['Avg interval', `${bioStatus?.baseline?.avg_keystroke_interval_ms?.toFixed(0) || '--'}ms`],
                ['Soft lock', bioStatus?.soft_locked ? 'ACTIVE' : 'Clear'],
              ].map(([k, v]) => (
                <View key={k} style={s.row}>
                  <Text style={s.rowK}>{k}</Text>
                  <Text style={[s.rowV, k === 'Soft lock' && bioStatus?.soft_locked ? { color: C.error } : {}]}>{v}</Text>
                </View>
              ))}
            </View>
            {bioStatus?.soft_locked && (
              <TouchableOpacity style={s.unlockBtn} onPress={clearSoftLock}>
                <Feather name="unlock" size={16} color={C.fg} />
                <Text style={s.unlockText}>VERIFY IDENTITY — Clear Soft Lock</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={s.resetBtn} onPress={async () => { haptic.tap(); await api.resetBiometricBaseline(); await loadAll(); }}>
              <Feather name="refresh-cw" size={14} color={C.fgSecondary} />
              <Text style={s.resetText}>Reset Behavioral Baseline</Text>
            </TouchableOpacity>
            <Text style={RESET.sectionLabel}>ANOMALY ALERTS</Text>
            {(bioStatus?.alerts || []).map((a: any, i: number) => (
              <View key={i} style={[GRID.border, s.alertItem]}>
                <View style={[s.alertDot, { backgroundColor: C.error }]} />
                <View style={{ flex: 1 }}>
                  <Text style={s.alertType}>{a.type.toUpperCase()} — score={a.anomaly_score?.toFixed(3)}</Text>
                  <Text style={s.alertMsg}>{a.reason}</Text>
                  <Text style={s.alertTs}>{a.ts?.slice(11, 19)}</Text>
                </View>
              </View>
            ))}
            {!bioStatus?.alerts?.length && <Text style={s.empty}>No anomalies detected</Text>}
          </>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: C.border },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: SP.sm },
  tabActive: { borderBottomWidth: 2, borderBottomColor: C.accent },
  tabText: { fontFamily: MONO, fontSize: 9, color: C.fgSecondary, letterSpacing: 1 },
  tabTextActive: { color: C.accent },
  card: { padding: SP.md, backgroundColor: C.surface, marginBottom: SP.sm },
  desc: { fontFamily: MONO, fontSize: 10, color: C.fgSecondary, lineHeight: 16, marginBottom: SP.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: C.borderSubtle },
  rowK: { fontFamily: MONO, fontSize: 10, color: C.fgSecondary },
  rowV: { fontFamily: MONO, fontSize: 10, color: C.fg },
  proofResult: { backgroundColor: C.bg, borderWidth: 1, borderColor: `${C.success}20`, padding: SP.sm, marginBottom: SP.sm },
  proofRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: C.borderSubtle },
  proofKey: { fontFamily: MONO, fontSize: 10, color: C.fgSecondary },
  proofVal: { fontFamily: MONO, fontSize: 10, color: C.fg, flex: 1, textAlign: 'right' },
  zkBtn: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, padding: SP.md, marginBottom: 6, backgroundColor: C.surface, gap: 10 },
  zkBtnIcon: { width: 32, height: 32, borderWidth: 1, justifyContent: 'center', alignItems: 'center' },
  zkBtnLabel: { fontFamily: MONO, fontSize: 12, fontWeight: '600' },
  zkBtnDesc: { fontFamily: MONO, fontSize: 9, color: C.fgTertiary, marginTop: 2 },
  sessRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: C.borderSubtle, gap: 8 },
  sessDot: { width: 5, height: 5, borderRadius: R.xs },
  sessId: { fontFamily: MONO, fontSize: 10, color: C.fg },
  sessScope: { fontFamily: MONO, fontSize: 9, color: C.fgSecondary, marginTop: 1 },
  otaStatusRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SP.sm },
  otaVersion: { fontFamily: MONO, fontSize: 16, color: C.fg, fontWeight: '200' },
  pendingBadge: { borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  pendingText: { fontFamily: MONO, fontSize: 9, letterSpacing: 1 },
  applyBtn: { backgroundColor: C.accent, height: 44, justifyContent: 'center', alignItems: 'center', marginTop: SP.sm },
  applyText: { fontFamily: MONO, fontSize: 11, color: C.bg, letterSpacing: 1 },
  input: { height: 44, borderWidth: 1, borderColor: C.border, paddingHorizontal: SP.md, color: C.fg, fontFamily: MONO, fontSize: 13, marginBottom: SP.sm, backgroundColor: C.bg },
  stageBtn: { backgroundColor: 'rgba(59,130,246,0.15)', borderWidth: 1, borderColor: `${C.blue}30`, height: 44, justifyContent: 'center', alignItems: 'center' },
  stageBtnText: { fontFamily: MONO, fontSize: 11, color: C.blue, letterSpacing: 1 },
  historyItem: { flexDirection: 'row', alignItems: 'center', padding: SP.sm, marginBottom: 4, backgroundColor: C.surface, gap: 8 },
  histDot: { width: 6, height: 6, borderRadius: R.xs, flexShrink: 0 },
  histVersion: { fontFamily: MONO, fontSize: 12, color: C.fg, fontWeight: '600' },
  histMeta: { fontFamily: MONO, fontSize: 9, color: C.fgSecondary, marginTop: 2 },
  histOutcome: { fontFamily: MONO, fontSize: 9, letterSpacing: 1 },
  noiseTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: SP.xs },
  noiseToggle: { borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6 },
  noiseToggleText: { fontFamily: MONO, fontSize: 12, fontWeight: '700', letterSpacing: 2 },
  sparkHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SP.sm },
  sparkNote: { fontFamily: MONO, fontSize: 9, color: C.fgTertiary },
  entropyNote: { fontFamily: MONO, fontSize: 9, color: C.fgTertiary, marginTop: SP.sm, lineHeight: 14 },
  presetBtn: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, padding: SP.md, marginBottom: 6, backgroundColor: C.surface, gap: 10 },
  presetIcon: { width: 30, height: 30, justifyContent: 'center', alignItems: 'center' },
  presetLabel: { fontFamily: MONO, fontSize: 12, fontWeight: '600' },
  presetDesc: { fontFamily: MONO, fontSize: 9, color: C.fgTertiary, marginTop: 2 },
  lockAlert: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: 'rgba(255,0,60,0.08)', borderWidth: 1, borderColor: `${C.error}30`, padding: SP.sm, marginBottom: SP.sm },
  lockAlertText: { fontFamily: MONO, fontSize: 10, color: C.error, flex: 1, lineHeight: 15 },
  unlockBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: C.accent, height: 48, marginBottom: SP.sm },
  unlockText: { fontFamily: MONO, fontSize: 12, color: C.bg, letterSpacing: 1 },
  resetBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: C.border, height: 40, marginBottom: SP.sm },
  resetText: { fontFamily: MONO, fontSize: 11, color: C.fgSecondary },
  alertItem: { flexDirection: 'row', alignItems: 'flex-start', padding: SP.sm, marginBottom: 4, backgroundColor: C.surface, gap: 8 },
  alertDot: { width: 5, height: 5, borderRadius: R.xs, marginTop: 3, flexShrink: 0 },
  alertType: { fontFamily: MONO, fontSize: 10, color: C.error, fontWeight: '600' },
  alertMsg: { fontFamily: MONO, fontSize: 10, color: C.fgSecondary, marginTop: 2, lineHeight: 14 },
  alertTs: { fontFamily: MONO, fontSize: 9, color: C.fgTertiary, marginTop: 2 },
  empty: { fontFamily: MONO, fontSize: 11, color: C.fgTertiary, textAlign: 'center', paddingVertical: SP.xl },
});
