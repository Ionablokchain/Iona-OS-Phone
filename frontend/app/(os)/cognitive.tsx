/**
 * Cognitive Witness Authentication
 * 4x4 grid of abstract geometric symbols.
 * User taps a memorized sequence → generates ZK witness hash.
 * Sequence never stored — only its SHA3-256 hash.
 * Also includes Duress PIN setup and Sovereign Time display.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  TextInput, Animated, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { C, MONO, R, SP, GRID, RESET } from '@/src/theme';
import { api } from '@/src/utils/api';
import { haptic } from '@/src/utils/haptics';
import { BridgeStatusBar } from '@/src/components/GridOverlay';

const { width: W } = Dimensions.get('window');
const CELL = Math.floor((W - 48 - 12) / 4);

type Tab = 'cognitive' | 'duress' | 'time' | 'shard' | 'recruit';

// ─── Symbol cell ──────────────────────────────────────────────────────────────
function SymbolCell({ symbol, row, col, selected, order, onPress }: {
  symbol: string; row: number; col: number;
  selected: boolean; order: number; onPress: () => void;
}) {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const onPressAnim = () => {
    haptic.tap();
    Animated.sequence([
      Animated.timing(scaleAnim, { toValue: 0.85, duration: 80, useNativeDriver: true }),
      Animated.timing(scaleAnim, { toValue: 1, duration: 120, useNativeDriver: true }),
    ]).start();
    onPress();
  };
  return (
    <TouchableOpacity onPress={onPressAnim} activeOpacity={0.8}>
      <Animated.View style={[sc.cell, selected && sc.cellSelected, { transform: [{ scale: scaleAnim }] }]}>
        <Text style={[sc.symbol, selected && { color: C.accent }]}>{symbol}</Text>
        {selected && order > 0 && (
          <View style={sc.order}><Text style={sc.orderText}>{order}</Text></View>
        )}
      </Animated.View>
    </TouchableOpacity>
  );
}
const sc = StyleSheet.create({
  cell: { width: CELL, height: CELL, borderWidth: 1, borderColor: C.border, justifyContent: 'center', alignItems: 'center', backgroundColor: C.surface, margin: 1.5 },
  cellSelected: { borderColor: `${C.accent}60`, backgroundColor: `${C.accent}10` },
  symbol: { fontSize: CELL * 0.42, color: C.fgSecondary },
  order: { position: 'absolute', top: 3, right: 4, width: 14, height: 14, backgroundColor: C.accent, borderRadius: R.xs, justifyContent: 'center', alignItems: 'center' },
  orderText: { fontFamily: MONO, fontSize: 8, color: C.bg, fontWeight: '700' },
});

// ─── Time display ─────────────────────────────────────────────────────────────
function SovereignClock({ timeData }: { timeData: any }) {
  const [display, setDisplay] = useState('--:--:--');
  useEffect(() => {
    if (!timeData?.sovereign_time_ms) return;
    const tick = () => {
      const now = timeData.sovereign_time_ms + (Date.now() - Date.now());
      setDisplay(new Date(timeData.sovereign_time_ms).toISOString().slice(11, 19));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [timeData]);
  const consensus = timeData?.consensus;
  const ok = consensus?.ok;
  return (
    <View style={[ck.wrap, { borderColor: ok ? `${C.success}30` : `${C.warning}30` }]}>
      <Text style={ck.time}>{display}</Text>
      <Text style={ck.label}>SOVEREIGN TIME (UTC)</Text>
      <View style={ck.row}>
        <View style={[ck.dot, { backgroundColor: ok ? C.success : C.warning }]} />
        <Text style={[ck.status, { color: ok ? C.success : C.warning }]}>
          {ok ? `CONSENSUS (${Math.round((consensus?.quorum_pct || 0) * 100)}% quorum)` : 'SOLO (no peers)'}
        </Text>
      </View>
      {[
        ['Offset',   `${timeData?.offset_ms ?? 0}ms`],
        ['Samples',  String(timeData?.sample_count ?? 0)],
        ['Rejected', String(timeData?.rejected_jumps ?? 0)],
        ['Stratum',  String(timeData?.stratum ?? 3)],
      ].map(([k, v]) => (
        <View key={k} style={ck.dataRow}>
          <Text style={ck.dataK}>{k}</Text>
          <Text style={ck.dataV}>{v}</Text>
        </View>
      ))}
    </View>
  );
}
const ck = StyleSheet.create({
  wrap: { ...GRID.border, padding: SP.md, backgroundColor: '#060606', alignItems: 'center' },
  time: { fontFamily: MONO, fontSize: 36, color: C.success, fontWeight: '100', letterSpacing: 4 },
  label: { fontFamily: MONO, fontSize: 8, color: C.fgTertiary, letterSpacing: 3, marginTop: 4, marginBottom: SP.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: SP.sm },
  dot: { width: 6, height: 6, borderRadius: R.xs },
  status: { fontFamily: MONO, fontSize: 10 },
  dataRow: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', paddingVertical: 3, borderBottomWidth: 1, borderBottomColor: C.borderSubtle },
  dataK: { fontFamily: MONO, fontSize: 9, color: C.fgSecondary },
  dataV: { fontFamily: MONO, fontSize: 9, color: C.fg },
});

// ─── Main ──────────────────────────────────────────────────────────────────────
export default function CognitiveAuthScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('cognitive');
  const [grid, setGrid] = useState<string[][]>([]);
  const [sequence, setSequence] = useState<{ row: number; col: number; symbol: string; order: number }[]>([]);
  const [authResult, setAuthResult] = useState<any>(null);
  const [duressStatus, setDuressStatus] = useState<any>(null);
  const [timeData, setTimeData] = useState<any>(null);
  const [shardStatus, setShardStatus] = useState<any>(null);
  const [recruitStatus, setRecruitStatus] = useState<any>(null);
  const [scrubStatus, setScrubStatus] = useState<any>(null);
  // Duress setup form
  const [realPin, setRealPin] = useState('');
  const [duressPin, setDuressPin] = useState('');
  const [duressResult, setDuressResult] = useState<any>(null);
  // Disperse form
  const [disperseData, setDisperseData] = useState('');
  const [disperseResult, setDisperseResult] = useState<any>(null);
  const [loading, setLoading] = useState<string | null>(null);

  const loadAll = async () => {
    try {
      const [ds, td, ss, rs, scr] = await Promise.all([
        api.getDuressStatus(),
        api.getTimeConsensus(),
        api.getShardStatus(),
        api.getRecruitmentStatus(),
        api.getScrubStatus(),
      ]);
      setDuressStatus(ds);
      setTimeData(td);
      setShardStatus(ss);
      setRecruitStatus(rs);
      setScrubStatus(scr);
      if (ds.cognitive_grid?.length) setGrid(ds.cognitive_grid);
    } catch {}
  };

  const refreshGrid = async () => {
    const g = await api.getCognitiveGrid();
    if (g.grid) setGrid(g.grid);
    setSequence([]);
    setAuthResult(null);
  };

  useEffect(() => {
    loadAll();
    refreshGrid();
  }, []);

  const tapCell = (row: number, col: number, symbol: string) => {
    const existing = sequence.findIndex(s => s.row === row && s.col === col);
    if (existing >= 0) {
      setSequence(prev => prev.filter((_, i) => i !== existing));
    } else if (sequence.length < 8) {
      setSequence(prev => [...prev, { row, col, symbol, order: prev.length + 1 }]);
    }
  };

  const submitCognitive = async () => {
    if (sequence.length < 3) { haptic.error(); return; }
    haptic.medium(); setLoading('cognitive');
    try {
      const result = await api.cognitiveAuth(sequence.map(s => ({ row: s.row, col: s.col, symbol: s.symbol })));
      setAuthResult(result);
      haptic.success();
    } catch { haptic.error(); }
    setLoading(null);
  };

  const setupDuress = async () => {
    if (!realPin || !duressPin || realPin === duressPin) { haptic.error(); return; }
    haptic.medium(); setLoading('duress');
    try {
      const result = await api.duressSetup({
        real_pin: realPin,
        duress_pin: duressPin,
        cognitive_sequence: sequence.map(s => ({ row: s.row, col: s.col, symbol: s.symbol })),
      });
      setDuressResult(result);
      haptic.success();
      await loadAll();
    } catch { haptic.error(); }
    setLoading(null);
  };

  const disperseGenesis = async () => {
    if (!disperseData) { haptic.error(); return; }
    haptic.medium(); setLoading('disperse');
    try {
      const data_hex = Buffer.from(disperseData).toString('hex');
      const result = await api.fsDisperse({ data_hex, label: 'genesis_capsule', threshold: 4, total: 10 });
      setDisperseResult(result);
      haptic.success();
      await loadAll();
    } catch { haptic.error(); }
    setLoading(null);
  };

  const runScrub = async () => {
    haptic.tap(); setLoading('scrub');
    await api.fsScrub();
    setTimeout(() => { loadAll(); setLoading(null); }, 2000);
  };

  const offerStorage = async () => {
    haptic.medium(); setLoading('recruit');
    try {
      await api.offerStorage({ offer_kb: 64, ttl_hours: 24, routing_priority: 2 });
      haptic.success();
      await loadAll();
    } catch { haptic.error(); }
    setLoading(null);
  };

  const TABS: { id: Tab; label: string; icon: string }[] = [
    { id: 'cognitive', label: 'AUTH',   icon: 'grid' },
    { id: 'duress',    label: 'DURESS', icon: 'alert-triangle' },
    { id: 'time',      label: 'TIME',   icon: 'clock' },
    { id: 'shard',     label: 'SHARD',  icon: 'share-2' },
    { id: 'recruit',   label: 'MESH+',  icon: 'users' },
  ];

  return (
    <SafeAreaView style={RESET.screen} testID="cognitive-screen">
      <View style={RESET.header}>
        <TouchableOpacity onPress={() => { haptic.tap(); router.back(); }}>
          <Feather name="arrow-left" size={20} color={C.fgSecondary} />
        </TouchableOpacity>
        <Text style={{ fontFamily: MONO, fontSize: 11, color: C.fg, letterSpacing: 4 }}>SOVEREIGN AUTH</Text>
        <View style={[s.badge, { borderColor: duressStatus?.duress_armed ? `${C.success}40` : `${C.fgTertiary}20` }]}>
          <Text style={[s.badgeText, { color: duressStatus?.duress_armed ? C.success : C.fgTertiary }]}>
            {duressStatus?.duress_armed ? 'ARMED' : 'SETUP'}
          </Text>
        </View>
      </View>
      <BridgeStatusBar />

      <View style={s.tabs}>
        {TABS.map(t => (
          <TouchableOpacity key={t.id} style={[s.tab, tab === t.id && s.tabActive]}
            onPress={() => { haptic.selection(); setTab(t.id); }}>
            <Feather name={t.icon as any} size={12} color={tab === t.id ? C.accent : C.fgSecondary} />
            <Text style={[s.tabText, tab === t.id && s.tabTextActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView contentContainerStyle={{ paddingHorizontal: SP.lg, paddingTop: SP.sm }} showsVerticalScrollIndicator={false}>

        {/* ── COGNITIVE TAB ── */}
        {tab === 'cognitive' && (
          <>
            <View style={[GRID.border, s.card]}>
              <Text style={RESET.sectionLabel}>COGNITIVE WITNESS GRID</Text>
              <Text style={s.desc}>
                Tap 3-8 symbols in your memorized sequence. Never stored — only the hash.
                Generates ZK witness for identity without biometrics.
              </Text>
            </View>
            {/* 4×4 Grid */}
            <View style={s.gridWrap}>
              {(grid.length ? grid : Array(4).fill(Array(4).fill('◆'))).map((row: string[], ri: number) => (
                <View key={ri} style={s.gridRow}>
                  {row.map((sym: string, ci: number) => {
                    const sel = sequence.find(s2 => s2.row === ri && s2.col === ci);
                    return <SymbolCell key={ci} symbol={sym} row={ri} col={ci}
                      selected={!!sel} order={sel?.order || 0}
                      onPress={() => tapCell(ri, ci, sym)} />;
                  })}
                </View>
              ))}
            </View>
            <View style={s.seqDisplay}>
              <Text style={s.seqLabel}>SEQUENCE ({sequence.length}/8):</Text>
              <Text style={s.seqText}>{sequence.map(s2 => s2.symbol).join(' → ') || 'Tap symbols above'}</Text>
            </View>
            <View style={s.btnRow}>
              <TouchableOpacity style={[s.halfBtn, { borderColor: C.border }]} onPress={() => { haptic.tap(); setSequence([]); setAuthResult(null); }}>
                <Text style={s.halfBtnText}>CLEAR</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.halfBtn, { borderColor: `${C.accent}30` }]} onPress={refreshGrid}>
                <Text style={[s.halfBtnText, { color: C.accent }]}>NEW GRID</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={[s.submitBtn, sequence.length < 3 && { opacity: 0.4 }]}
              onPress={submitCognitive} disabled={sequence.length < 3 || loading === 'cognitive'}>
              <Text style={s.submitText}>{loading === 'cognitive' ? 'VERIFYING...' : 'VERIFY COGNITIVE WITNESS'}</Text>
            </TouchableOpacity>
            {authResult && (
              <View style={[GRID.border, s.resultCard, { borderColor: authResult.authenticated ? `${C.success}40` : `${C.error}40` }]}>
                <Feather name={authResult.authenticated ? 'check-circle' : 'x-circle'} size={20}
                  color={authResult.authenticated ? C.success : C.error} />
                <Text style={[s.resultText, { color: authResult.authenticated ? C.success : C.error }]}>
                  {authResult.authenticated ? 'WITNESS VERIFIED' : `FAILED (attempt ${authResult.attempts})`}
                </Text>
                {authResult.authenticated && <Text style={s.resultSub}>ZK-compatible witness generated</Text>}
              </View>
            )}
          </>
        )}

        {/* ── DURESS TAB ── */}
        {tab === 'duress' && (
          <>
            <View style={[GRID.border, s.card]}>
              <Text style={RESET.sectionLabel}>DURESS SYSTEM</Text>
              <Text style={s.desc}>Real PIN unlocks normally. Panic PIN silently activates honeypot + wipes enclave.</Text>
              {[
                ['Duress armed',    duressStatus?.duress_armed ? 'YES' : 'NO'],
                ['Cognitive armed', duressStatus?.cognitive_armed ? 'YES' : 'NO'],
                ['Honeypot mode',   duressStatus?.honeypot_mode ? 'ACTIVE' : 'Off'],
                ['Triggered at',    duressStatus?.triggered_at?.slice(11,19) || 'never'],
              ].map(([k, v]) => (
                <View key={k} style={s.row}>
                  <Text style={s.rowK}>{k}</Text>
                  <Text style={[s.rowV, k === 'Honeypot mode' && duressStatus?.honeypot_mode ? { color: C.error } : {}]}>{v}</Text>
                </View>
              ))}
            </View>
            <View style={[GRID.border, s.card]}>
              <Text style={RESET.sectionLabel}>CONFIGURE</Text>
              <TextInput style={s.input} value={realPin} onChangeText={setRealPin}
                placeholder="Real PIN" placeholderTextColor={C.fgTertiary} secureTextEntry />
              <TextInput style={s.input} value={duressPin} onChangeText={setDuressPin}
                placeholder="Panic PIN (different from real)" placeholderTextColor={C.fgTertiary} secureTextEntry />
              <Text style={s.desc}>Set cognitive sequence in AUTH tab first, then save here.</Text>
              <TouchableOpacity style={[s.submitBtn, (!realPin || !duressPin || realPin === duressPin) && { opacity: 0.4 }]}
                onPress={setupDuress} disabled={!realPin || !duressPin || realPin === duressPin || loading === 'duress'}>
                <Text style={s.submitText}>{loading === 'duress' ? 'SAVING...' : 'SAVE DURESS CONFIGURATION'}</Text>
              </TouchableOpacity>
              {duressResult && <Text style={[s.resultText, { color: C.success, marginTop: SP.sm }]}>✓ Duress system armed</Text>}
            </View>
          </>
        )}

        {/* ── TIME TAB ── */}
        {tab === 'time' && (
          <>
            <SovereignClock timeData={timeData} />
            <View style={[GRID.border, s.card, { marginTop: SP.sm }]}>
              <Text style={RESET.sectionLabel}>BFT TIME CONSENSUS</Text>
              <Text style={s.desc}>
                Time derived from mesh peer consensus, not external NTP.
                Rejects jumps &gt; 10s without 2/3 quorum.
                Protects Dilithium3 signature validity windows.
              </Text>
              <View style={s.row}><Text style={s.rowK}>Consensus count</Text><Text style={s.rowV}>{timeData?.consensus_count ?? 0}</Text></View>
              <View style={s.row}><Text style={s.rowK}>Rejected jumps</Text><Text style={s.rowV}>{timeData?.rejected_jumps ?? 0}</Text></View>
              <View style={s.row}><Text style={s.rowK}>Max jump allowed</Text><Text style={s.rowV}>10s (quorum required)</Text></View>
              <TouchableOpacity style={s.submitBtn} onPress={async () => { haptic.tap(); const t = await api.getTimeConsensus(); setTimeData(t); }}>
                <Text style={s.submitText}>REFRESH CONSENSUS</Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        {/* ── SHARD TAB ── */}
        {tab === 'shard' && (
          <>
            <View style={[GRID.border, s.card]}>
              <Text style={RESET.sectionLabel}>SHADOW MIRRORING</Text>
              <Text style={s.desc}>
                Fragment + disperse data across 10 mesh peers (4-of-10 erasure coding).
                Only ZK-proof holder can reconstitute.
              </Text>
              {[
                ['Shard sets', String(shardStatus?.shard_sets ?? 0)],
                ['Dispersed', String(shardStatus?.total_dispersed ?? 0)],
                ['Recovered', String(shardStatus?.total_recovered ?? 0)],
              ].map(([k, v]) => (
                <View key={k} style={s.row}><Text style={s.rowK}>{k}</Text><Text style={s.rowV}>{v}</Text></View>
              ))}
            </View>
            <View style={[GRID.border, s.card]}>
              <Text style={RESET.sectionLabel}>DISPERSE DATA</Text>
              <TextInput style={s.input} value={disperseData} onChangeText={setDisperseData}
                placeholder="Data to protect (e.g. genesis capsule JSON)" placeholderTextColor={C.fgTertiary} multiline />
              <TouchableOpacity style={[s.submitBtn, !disperseData && { opacity: 0.4 }]}
                onPress={disperseGenesis} disabled={!disperseData || loading === 'disperse'}>
                <Text style={s.submitText}>{loading === 'disperse' ? 'DISPERSING...' : 'FRAGMENT & DISPERSE (4-of-10)'}</Text>
              </TouchableOpacity>
              {disperseResult && (
                <View style={s.disperseResult}>
                  <Text style={[s.resultText, { color: C.success }]}>✓ {disperseResult.shards_created} shards dispersed</Text>
                  <Text style={s.resultSub}>ID: {disperseResult.shard_set_id?.slice(0, 16)}...</Text>
                  <Text style={s.resultSub}>Threshold: {disperseResult.threshold}-of-{disperseResult.shards_created}</Text>
                </View>
              )}
            </View>
            <View style={[GRID.border, s.card]}>
              <Text style={RESET.sectionLabel}>FILESYSTEM INTEGRITY</Text>
              {[
                ['Blocks checked',  String(scrubStatus?.blocks_checked ?? 0)],
                ['Corrupt',         String(scrubStatus?.blocks_corrupt ?? 0)],
                ['Recovered',       String(scrubStatus?.blocks_recovered ?? 0)],
                ['Recovery rate',   `${Math.round((scrubStatus?.recovery_rate ?? 0) * 100)}%`],
                ['Last scrub',      scrubStatus?.last_full_scrub?.slice(11,19) || 'never'],
              ].map(([k, v]) => (
                <View key={k} style={s.row}><Text style={s.rowK}>{k}</Text><Text style={s.rowV}>{v}</Text></View>
              ))}
              <TouchableOpacity style={[s.submitBtn, { marginTop: SP.sm }]} onPress={runScrub} disabled={loading === 'scrub' || scrubStatus?.running}>
                <Text style={s.submitText}>{scrubStatus?.running || loading === 'scrub' ? 'SCRUBBING...' : 'RUN INTEGRITY SCRUB'}</Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        {/* ── RECRUIT TAB ── */}
        {tab === 'recruit' && (
          <>
            <View style={[GRID.border, s.card]}>
              <Text style={RESET.sectionLabel}>VIRAL RECRUITMENT</Text>
              <Text style={s.desc}>
                Offer storage to mesh peers in exchange for routing priority.
                Anonymous exchange — no identity revealed.
              </Text>
              {[
                ['Offers made',    String(recruitStatus?.offers_made ?? 0)],
                ['Accepted',       String(recruitStatus?.offers_accepted ?? 0)],
                ['Donated',        `${recruitStatus?.donated_kb ?? 0} KB`],
                ['Received',       `${recruitStatus?.received_kb ?? 0} KB`],
                ['Trust boost',    `+${(recruitStatus?.trust_boost_earned ?? 0).toFixed(3)}`],
              ].map(([k, v]) => (
                <View key={k} style={s.row}><Text style={s.rowK}>{k}</Text><Text style={s.rowV}>{v}</Text></View>
              ))}
            </View>
            <TouchableOpacity style={s.submitBtn} onPress={offerStorage} disabled={loading === 'recruit'}>
              <Text style={s.submitText}>{loading === 'recruit' ? 'BROADCASTING...' : 'OFFER 64KB (+2 ROUTING PRIORITY)'}</Text>
            </TouchableOpacity>
            {(recruitStatus?.active_offers || []).map((offer: any, i: number) => (
              <View key={i} style={[GRID.border, s.offerCard]}>
                <Text style={s.offerLabel}>{offer.offer_kb}KB available · priority +{offer.routing_priority}</Text>
                <Text style={s.offerMeta}>Expires: {offer.expires_at?.slice(11,19)} · {offer.status}</Text>
              </View>
            ))}
          </>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: C.border },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3, paddingVertical: SP.sm },
  tabActive: { borderBottomWidth: 2, borderBottomColor: C.accent },
  tabText: { fontFamily: MONO, fontSize: 8, color: C.fgSecondary, letterSpacing: 0.5 },
  tabTextActive: { color: C.accent },
  badge: { borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontFamily: MONO, fontSize: 9, letterSpacing: 1 },
  card: { padding: SP.md, backgroundColor: C.surface, marginBottom: SP.sm },
  desc: { fontFamily: MONO, fontSize: 10, color: C.fgSecondary, lineHeight: 16, marginBottom: SP.sm },
  gridWrap: { alignItems: 'center', marginBottom: SP.md },
  gridRow: { flexDirection: 'row' },
  seqDisplay: { ...GRID.border, padding: SP.sm, backgroundColor: '#060606', marginBottom: SP.sm },
  seqLabel: { fontFamily: MONO, fontSize: 8, color: C.fgTertiary, letterSpacing: 2, marginBottom: 4 },
  seqText: { fontFamily: MONO, fontSize: 13, color: C.fg },
  btnRow: { flexDirection: 'row', gap: 8, marginBottom: SP.sm },
  halfBtn: { flex: 1, height: 36, borderWidth: 1, justifyContent: 'center', alignItems: 'center' },
  halfBtnText: { fontFamily: MONO, fontSize: 10, color: C.fgSecondary },
  submitBtn: { height: 46, borderWidth: 1, borderColor: `${C.accent}40`, backgroundColor: C.accentDim, justifyContent: 'center', alignItems: 'center', marginBottom: SP.sm },
  submitText: { fontFamily: MONO, fontSize: 11, color: C.accent, letterSpacing: 1 },
  resultCard: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: SP.md, marginBottom: SP.sm },
  resultText: { fontFamily: MONO, fontSize: 13, fontWeight: '600' },
  resultSub: { fontFamily: MONO, fontSize: 10, color: C.fgSecondary, marginTop: 2 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: C.borderSubtle },
  rowK: { fontFamily: MONO, fontSize: 10, color: C.fgSecondary },
  rowV: { fontFamily: MONO, fontSize: 10, color: C.fg },
  input: { height: 44, borderWidth: 1, borderColor: C.border, paddingHorizontal: SP.md, color: C.fg, fontFamily: MONO, fontSize: 13, marginBottom: SP.sm, backgroundColor: C.bg },
  disperseResult: { borderWidth: 1, borderColor: `${C.success}30`, padding: SP.sm, marginTop: SP.sm },
  offerCard: { padding: SP.sm, backgroundColor: C.surface, marginBottom: 4 },
  offerLabel: { fontFamily: MONO, fontSize: 11, color: C.fg, fontWeight: '600' },
  offerMeta: { fontFamily: MONO, fontSize: 9, color: C.fgTertiary, marginTop: 2 },
});
