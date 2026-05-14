import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  RefreshControl, TextInput, Modal, Dimensions, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { C, MONO, R, SP, RESET, GRID } from '@/src/theme';
import { api } from '@/src/utils/api';
import { haptic } from '@/src/utils/haptics';
import { BridgeStatusBar } from '@/src/components/GridOverlay';

const { width: W } = Dimensions.get('window');

type Tab = 'hal' | 'mesh' | 'security' | 'blackbox' | 'logs';

// ── Thermal Pressure Bar ──────────────────────────────────────────────────────
function ThermalBar({ temp, pressure, throttling }: { temp: number; pressure: string; throttling: boolean }) {
  const pct = Math.min(100, Math.max(0, (temp - 20) / (95 - 20) * 100));
  const color = pressure === 'critical' ? C.error : pressure === 'moderate' ? C.warning : C.success;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (throttling) {
      Animated.loop(Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.4, duration: 500, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
      ])).start();
    } else { pulseAnim.setValue(1); }
  }, [throttling]);

  return (
    <View style={tb.wrap}>
      <View style={tb.header}>
        <View style={tb.titleRow}>
          <Feather name="thermometer" size={14} color={color} />
          <Text style={[tb.title, { color }]}>THERMAL PRESSURE</Text>
          {throttling && (
            <Animated.View style={[tb.throttleBadge, { opacity: pulseAnim }]}>
              <Text style={tb.throttleText}>THROTTLING</Text>
            </Animated.View>
          )}
        </View>
        <Text style={[tb.temp, { color }]}>{temp.toFixed(1)}°C</Text>
      </View>
      <View style={tb.track}>
        <View style={[tb.fill, { width: `${pct}%` as any, backgroundColor: color }]} />
        {/* Threshold markers */}
        <View style={[tb.marker, { left: `${(75-20)/(95-20)*100}%` as any }]} />
        <View style={[tb.marker, { left: `${(85-20)/(95-20)*100}%` as any, backgroundColor: C.error }]} />
      </View>
      <View style={tb.labels}>
        <Text style={tb.label}>20°</Text>
        <Text style={tb.label}>75° warn</Text>
        <Text style={tb.label}>85° crit</Text>
        <Text style={tb.label}>95°</Text>
      </View>
      <Text style={tb.pressure}>
        Pressure: {pressure.toUpperCase()} | Poll: {throttling ? '1000-2000ms' : '500ms'}
      </Text>
    </View>
  );
}
const tb = StyleSheet.create({
  wrap: { ...GRID.border, padding: SP.md, marginBottom: SP.sm, backgroundColor: C.surface },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SP.sm },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  title: { fontFamily: MONO, fontSize: 10, letterSpacing: 2 },
  throttleBadge: { backgroundColor: 'rgba(255,0,60,0.15)', borderWidth: 1, borderColor: `${C.error}40`, paddingHorizontal: 6, paddingVertical: 2, borderRadius: R.none },
  throttleText: { fontFamily: MONO, fontSize: 8, color: C.error, letterSpacing: 1 },
  temp: { fontFamily: MONO, fontSize: 24, fontWeight: '200' },
  track: { height: 6, backgroundColor: C.borderSubtle, marginBottom: 4, position: 'relative' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0 },
  marker: { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: C.warning },
  labels: { flexDirection: 'row', justifyContent: 'space-between' },
  label: { fontFamily: MONO, fontSize: 8, color: C.fgTertiary },
  pressure: { fontFamily: MONO, fontSize: 9, color: C.fgSecondary, marginTop: SP.sm },
});

// ── Dead Man's Switch Countdown ───────────────────────────────────────────────
function DeadManSwitch({ sec }: { sec: any }) {
  const isArmed = sec?.dead_mans_switch_active;
  const remaining = sec?.remaining_seconds ?? 600;
  const pct = Math.max(0, (remaining / 600) * 100);
  const color = isArmed ? (remaining < 120 ? C.error : C.warning) : C.success;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (isArmed && remaining < 120) {
      Animated.loop(Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.04, duration: 300, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
      ])).start();
    } else { pulseAnim.setValue(1); }
  }, [isArmed, remaining < 120]);

  const mins = Math.floor(remaining / 60);
  const secs = Math.floor(remaining % 60);

  return (
    <Animated.View style={[dms.wrap, { borderColor: `${color}40`, transform: [{ scale: pulseAnim }] }]}>
      <View style={dms.header}>
        <Text style={dms.title}>DEAD MAN'S SWITCH</Text>
        <View style={[dms.badge, { backgroundColor: `${color}12`, borderColor: `${color}30` }]}>
          <View style={[dms.dot, { backgroundColor: color }]} />
          <Text style={[dms.badgeText, { color }]}>{isArmed ? 'ARMED' : 'SAFE'}</Text>
        </View>
      </View>
      {isArmed ? (
        <>
          <Text style={[dms.countdown, { color }]}>{String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}</Text>
          <Text style={dms.sub}>until auto-vault transfer</Text>
          <View style={dms.track}>
            <View style={[dms.fill, { width: `${pct}%` as any, backgroundColor: color }]} />
          </View>
        </>
      ) : (
        <Text style={dms.idle}>Stability nominal — threshold {sec?.dead_mans_threshold ?? 1.10}</Text>
      )}
      <Text style={dms.vault}>
        Vault: {sec?.safe_vault_address ? sec.safe_vault_address.slice(0, 22) + '...' : 'not configured'}
      </Text>
    </Animated.View>
  );
}
const dms = StyleSheet.create({
  wrap: { borderWidth: 1, padding: SP.md, marginBottom: SP.sm, backgroundColor: C.surface },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SP.sm },
  title: { fontFamily: MONO, fontSize: 10, color: C.fgSecondary, letterSpacing: 2 },
  badge: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  dot: { width: 5, height: 5, borderRadius: R.xs, marginRight: 5 },
  badgeText: { fontFamily: MONO, fontSize: 9, letterSpacing: 1 },
  countdown: { fontFamily: MONO, fontSize: 48, fontWeight: '100', letterSpacing: -2 },
  sub: { fontFamily: MONO, fontSize: 10, color: C.fgSecondary, marginBottom: SP.sm },
  track: { height: 3, backgroundColor: C.borderSubtle, marginBottom: SP.sm },
  fill: { height: 3 },
  idle: { fontFamily: MONO, fontSize: 12, color: C.success, paddingVertical: SP.lg },
  vault: { fontFamily: MONO, fontSize: 9, color: C.fgTertiary, marginTop: SP.xs },
});

// ── Peer Card ──────────────────────────────────────────────────────────────────
function PeerCard({ peer }: { peer: any }) {
  const trustColor = peer.trust_score > 0.7 ? C.success : peer.trust_score > 0.4 ? C.warning : C.error;
  return (
    <View style={pc.wrap}>
      <View style={pc.header}>
        <View style={[pc.icon, { borderColor: `${trustColor}30` }]}>
          <Feather name={peer.transport === 'BLE' ? 'bluetooth' : 'wifi'} size={16} color={trustColor} />
        </View>
        <View style={pc.info}>
          <Text style={pc.name}>{peer.name}</Text>
          <Text style={pc.addr} numberOfLines={1}>{peer.address}</Text>
        </View>
        <View style={pc.meta}>
          <Text style={[pc.trust, { color: trustColor }]}>{Math.round(peer.trust_score * 100)}%</Text>
          <Text style={pc.transport}>{peer.transport}</Text>
        </View>
      </View>
      <View style={pc.stats}>
        <View style={pc.stat}>
          <Text style={pc.statL}>DIST</Text>
          <Text style={pc.statV}>{peer.distance_m}m</Text>
        </View>
        <View style={pc.stat}>
          <Text style={pc.statL}>LAT</Text>
          <Text style={pc.statV}>{peer.latency_ms}ms</Text>
        </View>
        <View style={pc.stat}>
          <Text style={pc.statL}>STAB</Text>
          <Text style={[pc.statV, { color: Math.abs(peer.stability_index - 1.42) < 0.05 ? C.success : C.warning }]}>
            {peer.stability_index.toFixed(4)}
          </Text>
        </View>
        <View style={[pc.trustBar]}>
          <View style={pc.trustTrack}>
            <View style={[pc.trustFill, { width: `${peer.trust_score * 100}%` as any, backgroundColor: trustColor }]} />
          </View>
        </View>
      </View>
    </View>
  );
}
const pc = StyleSheet.create({
  wrap: { ...GRID.border, padding: SP.md, marginBottom: 6, backgroundColor: C.surface },
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: SP.sm },
  icon: { width: 34, height: 34, borderWidth: 1, justifyContent: 'center', alignItems: 'center', marginRight: 10 },
  info: { flex: 1 },
  name: { fontFamily: MONO, fontSize: 12, color: C.fg, fontWeight: '600' },
  addr: { fontFamily: MONO, fontSize: 9, color: C.fgTertiary, marginTop: 2 },
  meta: { alignItems: 'flex-end' },
  trust: { fontFamily: MONO, fontSize: 16, fontWeight: '600' },
  transport: { fontFamily: MONO, fontSize: 8, color: C.fgTertiary, letterSpacing: 1 },
  stats: { flexDirection: 'row', alignItems: 'center' },
  stat: { width: 60 },
  statL: { fontFamily: MONO, fontSize: 8, color: C.fgTertiary, letterSpacing: 1 },
  statV: { fontFamily: MONO, fontSize: 12, color: C.fg, fontWeight: '600', marginTop: 1 },
  trustBar: { flex: 1 },
  trustTrack: { height: 3, backgroundColor: C.borderSubtle },
  trustFill: { height: 3 },
});

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function SecuritySystemsScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('hal');
  const [hal, setHal] = useState<any>(null);
  const [mesh, setMesh] = useState<any>(null);
  const [security, setSecurity] = useState<any>(null);
  const [checkpoints, setCheckpoints] = useState<any[]>([]);
  const [logAnalysis, setLogAnalysis] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [vaultInput, setVaultInput] = useState('');
  const [showVaultModal, setShowVaultModal] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const pollRef = useRef<any>(null);

  const loadAll = async () => {
    try {
      const [h, m, s, c, la] = await Promise.all([
        api.getHalStatus(),
        api.getMeshPeers(),
        api.getSecurityStatus(),
        api.getCheckpoints(),
        api.analyzeLogs(),
      ]);
      setHal(h);
      setMesh(m);
      setSecurity(s);
      setCheckpoints(c.checkpoints || []);
      setLogAnalysis(la.analysis);
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

  const searchLogs = async () => {
    if (!searchQuery.trim()) return;
    haptic.tap(); setSearching(true);
    try {
      const r = await api.searchLogs(searchQuery);
      setSearchResults(r.results || []);
    } catch {}
    setSearching(false);
  };

  const configureVault = async () => {
    if (!vaultInput.trim()) return;
    haptic.medium();
    try {
      await api.configureVault({ address: vaultInput.trim(), multisig_threshold: 2 });
      haptic.success();
      setShowVaultModal(false);
      setVaultInput('');
      await loadAll();
    } catch { haptic.error(); }
  };

  const sendPhysicalTrigger = async (seq: string[]) => {
    haptic.heavy();
    try {
      const r = await api.physicalTrigger(seq);
      haptic.success();
      await loadAll();
    } catch { haptic.error(); }
  };

  const TABS: { id: Tab; label: string; icon: string }[] = [
    { id: 'hal', label: 'HAL', icon: 'thermometer' },
    { id: 'mesh', label: 'MESH', icon: 'radio' },
    { id: 'security', label: 'SEC', icon: 'shield' },
    { id: 'blackbox', label: 'BOX', icon: 'save' },
    { id: 'logs', label: 'LOGS', icon: 'search' },
  ];

  return (
    <SafeAreaView style={RESET.screen} testID="security-screen">
      <View style={RESET.header}>
        <TouchableOpacity onPress={() => { haptic.tap(); router.back(); }}>
          <Feather name="arrow-left" size={20} color={C.fgSecondary} />
        </TouchableOpacity>
        <Text style={{ fontFamily: MONO, fontSize: 11, color: C.fg, letterSpacing: 4 }}>SYSTEMS</Text>
        <TouchableOpacity onPress={() => { haptic.tap(); api.checkpointNow(); }}>
          <Feather name="save" size={18} color={C.fgSecondary} />
        </TouchableOpacity>
      </View>

      <BridgeStatusBar />

      {/* Tab bar — zero radius */}
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
        {/* ── HAL Tab ── */}
        {tab === 'hal' && hal && (
          <>
            <ThermalBar
              temp={hal.cpu_temp_c}
              pressure={hal.thermal_pressure}
              throttling={hal.thermal_throttling}
            />
            <View style={[GRID.border, { padding: SP.md, backgroundColor: C.surface, marginBottom: SP.sm }]}>
              <Text style={RESET.sectionLabel}>HAL METRICS</Text>
              {[
                ['Poll Interval', `${hal.poll_interval_ms}ms`],
                ['Thermal Events', String(hal.thermal_events)],
                ['Last Event', hal.last_thermal_event?.slice(0, 19) || 'none'],
                ['ECO Forced', hal.eco_mode_forced ? 'YES' : 'No'],
              ].map(([k, v]) => (
                <View key={k} style={s.row}>
                  <Text style={s.rowKey}>{k}</Text>
                  <Text style={s.rowVal}>{v}</Text>
                </View>
              ))}
            </View>
            <Text style={RESET.sectionLabel}>PHYSICAL TRIGGERS</Text>
            {[
              { seq: ['vol_up', 'vol_up', 'vol_up'], label: 'Vol↑ × 3', desc: 'Emergency reset', color: C.error },
              { seq: ['vol_down', 'vol_down', 'vol_up'], label: 'Vol↓↓↑', desc: 'Force realign', color: C.success },
              { seq: ['vol_up', 'vol_down', 'vol_up'], label: 'Vol↑↓↑', desc: 'Toggle ECO/PERF', color: C.blue },
              { seq: ['vol_down', 'vol_up', 'vol_down'], label: 'Vol↓↑↓', desc: 'Start learning', color: C.purple },
            ].map(t => (
              <TouchableOpacity
                key={t.label}
                style={[s.triggerBtn, { borderColor: `${t.color}25` }]}
                onPress={() => sendPhysicalTrigger(t.seq)}
              >
                <View style={[s.triggerIcon, { backgroundColor: `${t.color}10`, borderColor: `${t.color}25` }]}>
                  <Feather name="radio" size={16} color={t.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[s.triggerLabel, { color: t.color }]}>{t.label}</Text>
                  <Text style={s.triggerDesc}>{t.desc}</Text>
                </View>
                <Feather name="chevron-right" size={14} color={C.fgTertiary} />
              </TouchableOpacity>
            ))}
          </>
        )}

        {/* ── MESH Tab ── */}
        {tab === 'mesh' && (
          <>
            <View style={[GRID.border, { padding: SP.md, backgroundColor: C.surface, marginBottom: SP.sm }]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: SP.sm }}>
                <Text style={RESET.sectionLabel}>P2P MESH STATUS</Text>
                <View style={[s.modeBadge, { borderColor: mesh?.offline_mode ? `${C.error}30` : `${C.success}30` }]}>
                  <View style={[s.modeDot, { backgroundColor: mesh?.offline_mode ? C.error : C.success }]} />
                  <Text style={[s.modeText, { color: mesh?.offline_mode ? C.error : C.success }]}>
                    {mesh?.offline_mode ? 'OFFLINE' : 'ONLINE'}
                  </Text>
                </View>
              </View>
              {[
                ['Peers', String(mesh?.peer_count ?? 0)],
                ['Mesh Stability', mesh?.mesh_stability?.toFixed(6) ?? '--'],
                ['Mode', mesh?.offline_mode ? 'P2P FALLBACK' : 'Internet'],
              ].map(([k, v]) => (
                <View key={k} style={s.row}>
                  <Text style={s.rowKey}>{k}</Text>
                  <Text style={s.rowVal}>{v}</Text>
                </View>
              ))}
              <TouchableOpacity
                style={[s.meshBtn, { marginTop: SP.sm }]}
                onPress={async () => { haptic.tap(); const r = await api.requestMeshStability(); await loadAll(); }}
              >
                <Text style={s.meshBtnText}>Request Stability from Best Peer</Text>
              </TouchableOpacity>
            </View>
            <Text style={RESET.sectionLabel}>DISCOVERED PEERS ({mesh?.peers?.length ?? 0})</Text>
            {(mesh?.peers || []).map((p: any, i: number) => (
              <PeerCard key={i} peer={p} />
            ))}
            {(!mesh?.peers?.length) && (
              <View style={s.empty}>
                <Feather name="radio" size={32} color={C.fgTertiary} />
                <Text style={s.emptyText}>No peers discovered</Text>
                <Text style={s.emptySubText}>Scanning via BLE + WiFi-Direct...</Text>
              </View>
            )}
          </>
        )}

        {/* ── SECURITY Tab ── */}
        {tab === 'security' && (
          <>
            <DeadManSwitch sec={security} />
            <View style={[GRID.border, { padding: SP.md, backgroundColor: C.surface, marginBottom: SP.sm }]}>
              <Text style={RESET.sectionLabel}>MULTISIG CONFIG</Text>
              {[
                ['Threshold', `${security?.multisig_threshold ?? 2} signatures required`],
                ['Emergency Count', String(security?.emergency_trigger_count ?? 0)],
                ['Vault Status', security?.vault_transfer_executed ? 'TRANSFERRED' : 'Holding'],
              ].map(([k, v]) => (
                <View key={k} style={s.row}>
                  <Text style={s.rowKey}>{k}</Text>
                  <Text style={s.rowVal}>{v}</Text>
                </View>
              ))}
            </View>
            <TouchableOpacity
              style={[s.vaultConfigBtn, { borderColor: `${C.accent}30` }]}
              onPress={() => { haptic.tap(); setShowVaultModal(true); }}
            >
              <Feather name="lock" size={16} color={C.accent} />
              <Text style={s.vaultConfigText}>
                {security?.safe_vault_address ? 'Update Safe Vault' : 'Configure Safe Vault Address'}
              </Text>
            </TouchableOpacity>
          </>
        )}

        {/* ── BLACKBOX Tab ── */}
        {tab === 'blackbox' && (
          <>
            <View style={[GRID.border, { padding: SP.md, backgroundColor: C.surface, marginBottom: SP.sm }]}>
              <Text style={RESET.sectionLabel}>ENCRYPTED STATE PERSISTENCE</Text>
              <Text style={s.blackboxDesc}>
                Agent state checkpointed every 5 min + on critical events.
                XOR-encrypted with wallet seed derivative. Recovery at boot.
              </Text>
            </View>
            <Text style={RESET.sectionLabel}>CHECKPOINTS ({checkpoints.length})</Text>
            {checkpoints.map((c: any) => (
              <View key={c.id} style={[GRID.border, { padding: SP.sm, marginBottom: 4, backgroundColor: C.surface, flexDirection: 'row' }]}>
                <View style={[s.checkDot, {
                  backgroundColor: c.trigger === 'critical_event' ? C.error :
                    c.trigger === 'manual' ? C.accent :
                    c.trigger === 'dead_mans_switch' ? C.warning : C.success,
                }]} />
                <View style={{ flex: 1 }}>
                  <Text style={s.checkTime}>{c.timestamp?.slice(0, 19)}</Text>
                  <Text style={s.checkTrigger}>{c.trigger} · {c.agent_status} · stab={c.stability_index?.toFixed(4)}</Text>
                </View>
                <Text style={s.checkId}>#{c.id}</Text>
              </View>
            ))}
            {!checkpoints.length && (
              <View style={s.empty}>
                <Feather name="save" size={32} color={C.fgTertiary} />
                <Text style={s.emptyText}>No checkpoints yet</Text>
              </View>
            )}
          </>
        )}

        {/* ── LOGS Tab ── */}
        {tab === 'logs' && (
          <>
            {logAnalysis && (
              <View style={[GRID.border, { padding: SP.md, backgroundColor: C.surface, marginBottom: SP.sm }]}>
                <Text style={RESET.sectionLabel}>LOG ANALYSIS — {logAnalysis.total_entries} entries</Text>
                <Text style={s.dominant}>Dominant: {logAnalysis.dominant?.toUpperCase()}</Text>
                <View style={s.catGrid}>
                  {Object.entries(logAnalysis.categories || {}).map(([cat, count]: any) => (
                    <View key={cat} style={s.catItem}>
                      <Text style={s.catName}>{cat}</Text>
                      <Text style={s.catCount}>{count}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}
            <Text style={RESET.sectionLabel}>SEMANTIC SEARCH</Text>
            <View style={s.searchRow}>
              <TextInput
                style={s.searchInput}
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="agent history --find 'drift spike'"
                placeholderTextColor={C.fgTertiary}
                autoCapitalize="none"
                autoCorrect={false}
                onSubmitEditing={searchLogs}
              />
              <TouchableOpacity
                style={[s.searchBtn, { opacity: searching ? 0.5 : 1 }]}
                onPress={searchLogs}
                disabled={searching}
              >
                <Feather name="search" size={16} color={C.bg} />
              </TouchableOpacity>
            </View>
            {searchResults.map((r: any, i: number) => (
              <View key={i} style={[GRID.border, { padding: SP.sm, marginBottom: 4, backgroundColor: C.surface }]}>
                <View style={s.logResultHeader}>
                  <Text style={[s.logCat, {
                    color: r.severity === 'critical' ? C.error : r.severity === 'warning' ? C.warning : C.success
                  }]}>{r.category.toUpperCase()}</Text>
                  <Text style={s.logTs}>{r.timestamp?.slice(11, 19)}</Text>
                </View>
                <Text style={s.logMsg}>{r.message}</Text>
                {r.drift && (
                  <Text style={s.logDrift}>drift={r.drift?.toFixed(4)} stability={r.stability?.toFixed(4)}</Text>
                )}
              </View>
            ))}
            {searchResults.length === 0 && searchQuery && !searching && (
              <Text style={s.noResults}>No results for "{searchQuery}"</Text>
            )}
          </>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Vault config modal */}
      <Modal visible={showVaultModal} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <View style={s.modalContent}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>CONFIGURE SAFE VAULT</Text>
              <TouchableOpacity onPress={() => { haptic.tap(); setShowVaultModal(false); }}>
                <Feather name="x" size={22} color={C.fg} />
              </TouchableOpacity>
            </View>
            <Text style={s.modalDesc}>
              Assets auto-transfer here if stability drops below 1.10 for 10 minutes without intervention.
            </Text>
            <TextInput
              style={s.vaultInput}
              value={vaultInput}
              onChangeText={setVaultInput}
              placeholder="iona1safe_vault_address..."
              placeholderTextColor={C.fgTertiary}
              autoCapitalize="none"
            />
            <TouchableOpacity
              style={[s.confirmBtn, !vaultInput && { opacity: 0.5 }]}
              onPress={configureVault}
              disabled={!vaultInput}
            >
              <Text style={s.confirmText}>SAVE VAULT ADDRESS</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: C.border },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: SP.sm },
  tabActive: { borderBottomWidth: 2, borderBottomColor: C.accent },
  tabText: { fontFamily: MONO, fontSize: 9, color: C.fgSecondary, letterSpacing: 1 },
  tabTextActive: { color: C.accent },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: C.borderSubtle },
  rowKey: { fontFamily: MONO, fontSize: 11, color: C.fgSecondary },
  rowVal: { fontFamily: MONO, fontSize: 11, color: C.fg },
  modeBadge: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, paddingHorizontal: 7, paddingVertical: 3 },
  modeDot: { width: 5, height: 5, borderRadius: R.xs, marginRight: 5 },
  modeText: { fontFamily: MONO, fontSize: 9, letterSpacing: 1 },
  meshBtn: { backgroundColor: 'rgba(59,130,246,0.1)', borderWidth: 1, borderColor: `${C.blue}30`, padding: SP.sm, alignItems: 'center' },
  meshBtnText: { fontFamily: MONO, fontSize: 11, color: C.blue },
  triggerBtn: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, padding: SP.md, marginBottom: 6, backgroundColor: C.surface, gap: 10 },
  triggerIcon: { width: 34, height: 34, borderWidth: 1, justifyContent: 'center', alignItems: 'center' },
  triggerLabel: { fontFamily: MONO, fontSize: 12, fontWeight: '600' },
  triggerDesc: { fontFamily: MONO, fontSize: 9, color: C.fgSecondary, marginTop: 2 },
  vaultConfigBtn: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, padding: SP.md, backgroundColor: C.surface },
  vaultConfigText: { fontFamily: MONO, fontSize: 12, color: C.accent },
  blackboxDesc: { fontFamily: MONO, fontSize: 11, color: C.fgSecondary, lineHeight: 18 },
  checkDot: { width: 6, height: 6, borderRadius: R.xs, marginRight: 8, marginTop: 4, flexShrink: 0 },
  checkTime: { fontFamily: MONO, fontSize: 11, color: C.fg },
  checkTrigger: { fontFamily: MONO, fontSize: 9, color: C.fgSecondary, marginTop: 2 },
  checkId: { fontFamily: MONO, fontSize: 9, color: C.fgTertiary },
  dominant: { fontFamily: MONO, fontSize: 14, color: C.accent, fontWeight: '600', marginBottom: SP.sm },
  catGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  catItem: { borderWidth: 1, borderColor: C.border, padding: SP.sm, alignItems: 'center', minWidth: 80 },
  catName: { fontFamily: MONO, fontSize: 8, color: C.fgSecondary, letterSpacing: 1 },
  catCount: { fontFamily: MONO, fontSize: 18, color: C.fg, fontWeight: '200', marginTop: 2 },
  searchRow: { flexDirection: 'row', gap: 8, marginBottom: SP.sm },
  searchInput: { flex: 1, height: 40, borderWidth: 1, borderColor: C.border, paddingHorizontal: SP.md, color: C.fg, fontFamily: MONO, fontSize: 12, backgroundColor: C.surface },
  searchBtn: { width: 40, height: 40, backgroundColor: C.success, justifyContent: 'center', alignItems: 'center' },
  logResultHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  logCat: { fontFamily: MONO, fontSize: 9, letterSpacing: 1 },
  logTs: { fontFamily: MONO, fontSize: 9, color: C.fgTertiary },
  logMsg: { fontFamily: MONO, fontSize: 11, color: C.fg, lineHeight: 16 },
  logDrift: { fontFamily: MONO, fontSize: 9, color: C.fgSecondary, marginTop: 3 },
  noResults: { fontFamily: MONO, fontSize: 11, color: C.fgSecondary, textAlign: 'center', paddingVertical: SP.xl },
  empty: { alignItems: 'center', paddingVertical: SP.xxl },
  emptyText: { fontFamily: MONO, fontSize: 12, color: C.fgSecondary, marginTop: SP.sm },
  emptySubText: { fontFamily: MONO, fontSize: 10, color: C.fgTertiary, marginTop: 4 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: C.surface, borderTopWidth: 1, borderTopColor: C.border, padding: SP.xl },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SP.md },
  modalTitle: { fontFamily: MONO, fontSize: 13, color: C.fg, letterSpacing: 3 },
  modalDesc: { fontFamily: MONO, fontSize: 11, color: C.fgSecondary, lineHeight: 18, marginBottom: SP.lg },
  vaultInput: { height: 48, borderWidth: 1, borderColor: C.border, paddingHorizontal: SP.md, color: C.fg, fontFamily: MONO, fontSize: 13, marginBottom: SP.md, backgroundColor: C.bg },
  confirmBtn: { backgroundColor: C.accent, height: 48, justifyContent: 'center', alignItems: 'center' },
  confirmText: { fontFamily: MONO, fontSize: 13, color: C.fg, letterSpacing: 2 },
});
