/**
 * IONA Radar — Mesh topology + Audit Trail + Mesh+ controls
 * Tabs: RADAR | AUDIT | MESH+ | RF | APPS
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  RefreshControl, Animated, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import Svg, { Circle, Line, Text as SvgText, G } from 'react-native-svg';
import { C, MONO, R, SP, GRID, RESET } from '@/src/theme';
import { api } from '@/src/utils/api';
import { haptic } from '@/src/utils/haptics';
import { BridgeStatusBar } from '@/src/components/GridOverlay';

const { width: W } = Dimensions.get('window');
const RADAR_SIZE = Math.min(W - 48, 300);
const RC = RADAR_SIZE / 2;

type Tab = 'radar' | 'audit' | 'mesh' | 'rf' | 'apps';

// ── Radar SVG ─────────────────────────────────────────────────────────────────
function RadarMap({ nodes, density }: { nodes: any[]; density: number }) {
  const spinAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.timing(spinAnim, { toValue: 1, duration: 8000, useNativeDriver: true })
    ).start();
  }, []);
  const spin = spinAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <View style={{ alignItems: 'center', marginVertical: SP.md }}>
      <View style={{ width: RADAR_SIZE, height: RADAR_SIZE, backgroundColor: '#030a03', borderWidth: 1, borderColor: `${C.success}20` }}>
        <Svg width={RADAR_SIZE} height={RADAR_SIZE}>
          {/* Concentric rings */}
          {[0.25, 0.5, 0.75, 1.0].map((r, i) => (
            <Circle key={i} cx={RC} cy={RC} r={RC * r} fill="none"
              stroke={C.success} strokeWidth="0.5" opacity={0.2} />
          ))}
          {/* Cross-hairs */}
          <Line x1={RC} y1={0} x2={RC} y2={RADAR_SIZE} stroke={C.success} strokeWidth="0.5" opacity={0.15} />
          <Line x1={0} y1={RC} x2={RADAR_SIZE} y2={RC} stroke={C.success} strokeWidth="0.5" opacity={0.15} />

          {/* Peer nodes */}
          {nodes.filter(n => n.id !== 'SELF').map((node, i) => {
            const rad = (node.angle_deg * Math.PI) / 180;
            const dist = (node.map_distance / 100) * (RC - 12);
            const nx = RC + dist * Math.cos(rad);
            const ny = RC + dist * Math.sin(rad);
            const color = node.trust_score > 0.7 ? '#00FF41'
              : node.trust_score > 0.4 ? '#F59E0B' : '#FF003C';
            return (
              <G key={i}>
                <Circle cx={nx} cy={ny} r={5} fill={color} opacity={0.9} />
                <SvgText x={nx + 7} y={ny + 4} fill={color} fontSize="7" fontFamily={MONO as string}>
                  {Math.round(node.trust_score * 100)}%
                </SvgText>
              </G>
            );
          })}

          {/* Self — center */}
          <Circle cx={RC} cy={RC} r={8} fill="none" stroke={C.success} strokeWidth="1.5" />
          <Circle cx={RC} cy={RC} r={3} fill={C.success} />
          <SvgText x={RC + 12} y={RC + 4} fill={C.success} fontSize="7" fontFamily={MONO as string}>SELF</SvgText>
        </Svg>

        {/* Rotating sweep line */}
        <Animated.View style={[rm.sweep, { transform: [{ rotate: spin }] }]} />
      </View>
      <Text style={rm.density}>NETWORK DENSITY: {Math.round(density * 100)}%</Text>
    </View>
  );
}
const rm = StyleSheet.create({
  sweep: {
    position: 'absolute',
    top: RC,
    left: RC,
    width: RC,
    height: 1,
    backgroundColor: C.success,
    opacity: 0.3,
    transformOrigin: '0% 50%',
  },
  density: { fontFamily: MONO, fontSize: 9, color: C.success, letterSpacing: 2, marginTop: SP.sm },
});

// ── Audit entry ───────────────────────────────────────────────────────────────
function AuditEntry({ entry }: { entry: any }) {
  const color = entry.severity === 'critical' ? C.error
    : entry.severity === 'warning' ? C.warning : C.fgSecondary;
  return (
    <View style={ae.row}>
      <View style={[ae.dot, { backgroundColor: color }]} />
      <View style={{ flex: 1 }}>
        <View style={ae.header}>
          <Text style={[ae.source, { color }]}>{entry.source}</Text>
          <Text style={ae.op}>{entry.op}</Text>
          <Text style={ae.ts}>{entry.ts?.slice(11, 19)}</Text>
        </View>
        <Text style={ae.detail} numberOfLines={2}>{entry.detail}</Text>
      </View>
    </View>
  );
}
const ae = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: C.borderSubtle, gap: 6 },
  dot: { width: 5, height: 5, borderRadius: R.xs, marginTop: 4, flexShrink: 0 },
  header: { flexDirection: 'row', gap: 8, marginBottom: 2 },
  source: { fontFamily: MONO, fontSize: 9, fontWeight: '700', letterSpacing: 1 },
  op: { fontFamily: MONO, fontSize: 9, color: C.fgSecondary },
  ts: { fontFamily: MONO, fontSize: 9, color: C.fgTertiary, marginLeft: 'auto' },
  detail: { fontFamily: MONO, fontSize: 10, color: C.fg, lineHeight: 15 },
});

// ── Main ──────────────────────────────────────────────────────────────────────
export default function RadarScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('radar');
  const [radar, setRadar] = useState<any>(null);
  const [audit, setAudit] = useState<any>(null);
  const [snf, setSnf] = useState<any>(null);
  const [routing, setRouting] = useState<any>(null);
  const [rf, setRf] = useState<any>(null);
  const [apps, setApps] = useState<any>(null);
  const [hw, setHw] = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const [auditSource, setAuditSource] = useState('all');
  const pollRef = useRef<any>(null);

  const loadAll = async () => {
    try {
      const [r, a, s, rt, rfs, ap, h] = await Promise.all([
        api.getMeshRadar(),
        api.getAuditTrail(auditSource, 50),
        api.snfStatus(),
        api.getRoutingTable(),
        api.rfStatus(),
        api.appRegistry(),
        api.hwDefenseStatus(),
      ]);
      setRadar(r); setAudit(a); setSnf(s); setRouting(rt);
      setRf(rfs); setApps(ap); setHw(h);
    } catch {}
  };

  useEffect(() => {
    loadAll();
    pollRef.current = setInterval(loadAll, 3000);
    return () => clearInterval(pollRef.current);
  }, [auditSource]);

  const onRefresh = async () => {
    haptic.tap(); setRefreshing(true);
    await loadAll(); setRefreshing(false);
  };

  const setRfProfile = async (profile: string) => {
    haptic.tap();
    await api.rfConfigure({ profile, adaptive: true });
    await loadAll();
  };

  const busScramblerToggle = async () => {
    haptic.medium(); setLoading('bus');
    await api.busScramblerToggle();
    await loadAll(); setLoading(null);
  };

  const acousticScan = async () => {
    haptic.medium(); setLoading('acoustic');
    await api.acousticScan();
    await loadAll(); setLoading(null);
  };

  const TABS: { id: Tab; label: string; icon: string }[] = [
    { id: 'radar', label: 'RADAR', icon: 'radio' },
    { id: 'audit', label: 'AUDIT', icon: 'shield' },
    { id: 'mesh',  label: 'MESH+', icon: 'git-merge' },
    { id: 'rf',    label: 'RF',    icon: 'wifi' },
    { id: 'apps',  label: 'APPS',  icon: 'box' },
  ];

  return (
    <SafeAreaView style={RESET.screen} testID="radar-screen">
      <View style={RESET.header}>
        <TouchableOpacity onPress={() => { haptic.tap(); router.back(); }}>
          <Feather name="arrow-left" size={20} color={C.fgSecondary} />
        </TouchableOpacity>
        <Text style={{ fontFamily: MONO, fontSize: 11, color: C.fg, letterSpacing: 4 }}>RADAR</Text>
        <Text style={{ fontFamily: MONO, fontSize: 9, color: C.fgTertiary }}>
          {radar?.node_count ?? 0} nodes
        </Text>
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

      <ScrollView contentContainerStyle={{ paddingHorizontal: SP.lg, paddingTop: SP.sm }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}>

        {/* ── RADAR TAB ── */}
        {tab === 'radar' && (
          <>
            <RadarMap nodes={radar?.nodes || []} density={radar?.network_density || 0} />
            <Text style={s.note}>{radar?.note}</Text>
            <View style={[GRID.border, s.card]}>
              <Text style={RESET.sectionLabel}>NETWORK TOPOLOGY</Text>
              {[
                ['Nodes', String(radar?.node_count ?? 0)],
                ['Consensus stability', radar?.mesh_consensus?.toFixed(6) ?? '--'],
                ['Offline mode', radar?.offline_mode ? 'YES' : 'No'],
                ['Density', `${Math.round((radar?.network_density || 0) * 100)}%`],
              ].map(([k, v]) => (
                <View key={k} style={s.row}><Text style={s.rowK}>{k}</Text><Text style={s.rowV}>{v}</Text></View>
              ))}
            </View>
            {(radar?.nodes || []).filter((n: any) => n.id !== 'SELF').map((node: any, i: number) => {
              const color = node.trust_score > 0.7 ? C.success : node.trust_score > 0.4 ? C.warning : C.error;
              return (
                <View key={i} style={[GRID.border, s.nodeCard]}>
                  <View style={[s.nodeDot, { backgroundColor: color }]} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.nodeId}>{node.id} · {node.transport}</Text>
                    <Text style={s.nodeMeta}>trust={node.trust_score.toFixed(2)} stab={node.stability} dist={node.map_distance}u</Text>
                  </View>
                  <Text style={[s.nodeTrust, { color }]}>{Math.round(node.trust_score * 100)}%</Text>
                </View>
              );
            })}
          </>
        )}

        {/* ── AUDIT TAB ── */}
        {tab === 'audit' && (
          <>
            <View style={[GRID.border, s.card]}>
              <Text style={RESET.sectionLabel}>AUDIT TRAIL — {audit?.total ?? 0} EVENTS</Text>
              <View style={s.sourceRow}>
                {['all', 'enclave', 'vfs', 'apps', 'mesh'].map(src => (
                  <TouchableOpacity key={src} style={[s.sourceBtn, auditSource === src && s.sourceBtnActive]}
                    onPress={() => { haptic.tap(); setAuditSource(src); }}>
                    <Text style={[s.sourceBtnText, auditSource === src && { color: C.accent }]}>{src.toUpperCase()}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            {(audit?.entries || []).map((e: any, i: number) => <AuditEntry key={i} entry={e} />)}
            {!audit?.entries?.length && <Text style={s.empty}>No security events recorded</Text>}
          </>
        )}

        {/* ── MESH+ TAB ── */}
        {tab === 'mesh' && (
          <>
            <View style={[GRID.border, s.card]}>
              <Text style={RESET.sectionLabel}>EPHEMERAL ROUTING TABLE</Text>
              {[
                ['Routes', String(routing?.route_count ?? 0)],
                ['Total hops', String(routing?.hop_count ?? 0)],
                ['Evictions', String(routing?.evictions ?? 0)],
                ['Route TTL', `${routing?.ttl_ticks ?? 60} ticks`],
              ].map(([k, v]) => (
                <View key={k} style={s.row}><Text style={s.rowK}>{k}</Text><Text style={s.rowV}>{v}</Text></View>
              ))}
              <Text style={s.subNote}>Routes store hop directions only — no identities persisted</Text>
            </View>
            <View style={[GRID.border, s.card]}>
              <Text style={RESET.sectionLabel}>STORE-AND-FORWARD BUFFER</Text>
              {[
                ['Buffered', String(snf?.buffered_packets ?? 0)],
                ['Buffer used', `${snf?.buffer_kb ?? 0} / ${snf?.max_buffer_kb ?? 512} KB`],
                ['Delivered', String(snf?.total_delivered ?? 0)],
                ['Expired', String(snf?.total_expired ?? 0)],
              ].map(([k, v]) => (
                <View key={k} style={s.row}><Text style={s.rowK}>{k}</Text><Text style={s.rowV}>{v}</Text></View>
              ))}
              <Text style={s.subNote}>Encrypted packets held for offline peers. Max TTL: 5 minutes.</Text>
            </View>
          </>
        )}

        {/* ── RF TAB ── */}
        {tab === 'rf' && (
          <>
            <View style={[GRID.border, s.card]}>
              <Text style={RESET.sectionLabel}>RF POWER MANAGER</Text>
              {[
                ['BLE TX', `${rf?.ble_tx_dbm ?? '--'} dBm`],
                ['WiFi TX', `${rf?.wifi_tx_dbm ?? '--'} dBm`],
                ['Range', `~${rf?.range_m ?? '--'}m`],
                ['LPD mode', rf?.lpd_mode ? 'ACTIVE' : 'Off'],
                ['Profile', (rf?.profile ?? '--').toUpperCase()],
              ].map(([k, v]) => (
                <View key={k} style={s.row}>
                  <Text style={s.rowK}>{k}</Text>
                  <Text style={[s.rowV, k === 'LPD mode' && rf?.lpd_mode ? { color: C.success } : {}]}>{v}</Text>
                </View>
              ))}
            </View>
            <Text style={RESET.sectionLabel}>RF PROFILES</Text>
            {Object.entries(rf?.profiles || {}).map(([name, p]: any) => (
              <TouchableOpacity key={name}
                style={[s.rfProfile, rf?.profile === name && { borderColor: `${C.accent}50` }]}
                onPress={() => setRfProfile(name)}>
                <View style={[s.rfDot, { backgroundColor: name === 'ghost' ? C.success : name === 'whisper' ? C.blue : name === 'normal' ? C.warning : C.error }]} />
                <View style={{ flex: 1 }}>
                  <Text style={[s.rfName, rf?.profile === name && { color: C.accent }]}>{name.toUpperCase()}</Text>
                  <Text style={s.rfDesc}>{p.desc}</Text>
                </View>
                {rf?.profile === name && <Feather name="check" size={14} color={C.accent} />}
              </TouchableOpacity>
            ))}
            <View style={[GRID.border, s.card, { marginTop: SP.sm }]}>
              <Text style={RESET.sectionLabel}>HARDWARE DEFENSE</Text>
              {[
                ['Bus scrambler', hw?.bus_scrambler?.active ? 'ACTIVE' : 'Off'],
                ['Seed rotations', String(hw?.bus_scrambler?.seed_rotations ?? 0)],
                ['Acoustic shield', hw?.acoustic_shield?.active ? 'SCANNING' : 'Off'],
                ['Detections', String(hw?.acoustic_shield?.detections ?? 0)],
              ].map(([k, v]) => (
                <View key={k} style={s.row}>
                  <Text style={s.rowK}>{k}</Text>
                  <Text style={[s.rowV, (k === 'Bus scrambler' && hw?.bus_scrambler?.active) || (k === 'Acoustic shield' && hw?.acoustic_shield?.active) ? { color: C.success } : {}]}>{v}</Text>
                </View>
              ))}
              <View style={s.btnRow}>
                <TouchableOpacity style={[s.halfBtn, { borderColor: `${C.accent}30` }]} onPress={busScramblerToggle} disabled={loading === 'bus'}>
                  <Text style={[s.halfBtnText, { color: C.accent }]}>{hw?.bus_scrambler?.active ? 'Disable Scrambler' : 'Enable Scrambler'}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.halfBtn, { borderColor: `${C.warning}30` }]} onPress={acousticScan} disabled={loading === 'acoustic'}>
                  <Text style={[s.halfBtnText, { color: C.warning }]}>{loading === 'acoustic' ? 'Scanning...' : 'Acoustic Scan'}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </>
        )}

        {/* ── APPS TAB ── */}
        {tab === 'apps' && (
          <>
            <View style={[GRID.border, s.card]}>
              <Text style={RESET.sectionLabel}>APP MANIFEST REGISTRY</Text>
              <View style={s.row}>
                <Text style={s.rowK}>Apps registered</Text>
                <Text style={s.rowV}>{apps?.apps?.length ?? 0}</Text>
              </View>
              <View style={s.row}>
                <Text style={s.rowK}>Executions refused</Text>
                <Text style={[s.rowV, (apps?.refused_count ?? 0) > 0 ? { color: C.error } : {}]}>{apps?.refused_count ?? 0}</Text>
              </View>
              <Text style={s.subNote}>Apps require Senate-signed manifest. Hash mismatch = refused.</Text>
            </View>
            {(apps?.apps || []).map((app: any, i: number) => (
              <View key={i} style={[GRID.border, s.appCard]}>
                <View style={{ flex: 1 }}>
                  <Text style={s.appName}>{app.name} <Text style={s.appVer}>v{app.version}</Text></Text>
                  <Text style={s.appPerms}>{app.permissions.join(' · ')}</Text>
                  <Text style={s.appMeta}>runs={app.run_count} · {app.status}</Text>
                </View>
                <Text style={[s.appStatus, { color: app.status === 'registered' ? C.success : C.fgSecondary }]}>
                  {app.status.toUpperCase()}
                </Text>
              </View>
            ))}
            {!apps?.apps?.length && <Text style={s.empty}>No apps registered. Apps require Senate vote.</Text>}
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
  card: { padding: SP.md, backgroundColor: C.surface, marginBottom: SP.sm },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: C.borderSubtle },
  rowK: { fontFamily: MONO, fontSize: 10, color: C.fgSecondary },
  rowV: { fontFamily: MONO, fontSize: 10, color: C.fg },
  note: { fontFamily: MONO, fontSize: 9, color: C.fgTertiary, textAlign: 'center', marginBottom: SP.sm },
  subNote: { fontFamily: MONO, fontSize: 9, color: C.fgTertiary, marginTop: SP.sm, lineHeight: 14 },
  nodeCard: { flexDirection: 'row', alignItems: 'center', padding: SP.sm, marginBottom: 4, backgroundColor: C.surface, gap: 8 },
  nodeDot: { width: 8, height: 8, borderRadius: R.xs, flexShrink: 0 },
  nodeId: { fontFamily: MONO, fontSize: 11, color: C.fg, fontWeight: '600' },
  nodeMeta: { fontFamily: MONO, fontSize: 9, color: C.fgTertiary, marginTop: 2 },
  nodeTrust: { fontFamily: MONO, fontSize: 14, fontWeight: '600' },
  sourceRow: { flexDirection: 'row', gap: 6, marginTop: SP.sm },
  sourceBtn: { borderWidth: 1, borderColor: C.border, paddingHorizontal: 8, paddingVertical: 4 },
  sourceBtnActive: { borderColor: `${C.accent}50`, backgroundColor: C.accentDim },
  sourceBtnText: { fontFamily: MONO, fontSize: 8, color: C.fgSecondary, letterSpacing: 1 },
  empty: { fontFamily: MONO, fontSize: 11, color: C.fgTertiary, textAlign: 'center', paddingVertical: SP.xl },
  rfProfile: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: C.border, padding: SP.md, marginBottom: 5, backgroundColor: C.surface, gap: 10 },
  rfDot: { width: 8, height: 8, borderRadius: R.xs, flexShrink: 0 },
  rfName: { fontFamily: MONO, fontSize: 12, color: C.fg, fontWeight: '600' },
  rfDesc: { fontFamily: MONO, fontSize: 9, color: C.fgTertiary, marginTop: 2 },
  btnRow: { flexDirection: 'row', gap: 8, marginTop: SP.sm },
  halfBtn: { flex: 1, height: 36, borderWidth: 1, justifyContent: 'center', alignItems: 'center' },
  halfBtnText: { fontFamily: MONO, fontSize: 10 },
  appCard: { flexDirection: 'row', alignItems: 'center', padding: SP.sm, marginBottom: 4, backgroundColor: C.surface },
  appName: { fontFamily: MONO, fontSize: 12, color: C.fg, fontWeight: '600' },
  appVer: { color: C.fgTertiary, fontWeight: '400' },
  appPerms: { fontFamily: MONO, fontSize: 9, color: C.blue, marginTop: 2 },
  appMeta: { fontFamily: MONO, fontSize: 9, color: C.fgTertiary, marginTop: 1 },
  appStatus: { fontFamily: MONO, fontSize: 9, letterSpacing: 1 },
});
