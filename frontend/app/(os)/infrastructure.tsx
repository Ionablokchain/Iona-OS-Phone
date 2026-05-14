import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  TextInput, RefreshControl, Animated, Vibration,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { gestureEngine, GESTURE_MAP, GESTURE_LABELS, GestureType } from '@/src/utils/gestureEngine';
import { useVoiceEngine } from '@/src/utils/voiceEngine';
import { C, MONO, R, SP, GRID, RESET } from '@/src/theme';
import { api } from '@/src/utils/api';
import { haptic } from '@/src/utils/haptics';
import { BridgeStatusBar, OracleWidget } from '@/src/components/GridOverlay';

type Tab = 'msg' | 'vfs' | 'oracle' | 'wasm' | 'neural';

const PRIORITY_COLOR: Record<string, string> = {
  critical: C.error, high: '#F59E0B', normal: C.blue, low: C.fgSecondary,
};

export default function InfrastructureScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('msg');
  const [inbox, setInbox] = useState<any>(null);
  const [vfs, setVfs] = useState<any>(null);
  const [oracle, setOracle] = useState<any>(null);
  const [sandbox, setSandbox] = useState<any>(null);
  const [neural, setNeural] = useState<any>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  // VFS form
  const [vfsPath, setVfsPath] = useState('/home/iona/test.txt');
  const [vfsContent, setVfsContent] = useState('');
  const [vfsReadResult, setVfsReadResult] = useState<string | null>(null);
  // WASM form
  const [wasmId, setWasmId] = useState('stability_monitor');
  const [wasmCode, setWasmCode] = useState('read_stability(); write_agent_log();');
  const [wasmPerms, setWasmPerms] = useState(['read_stability', 'write_agent_log']);
  const [wasmResult, setWasmResult] = useState<any>(null);
  // Voice
  const [voiceInput, setVoiceInput] = useState('');
  const [voiceResult, setVoiceResult] = useState<any>(null);
  // Gesture detection
  const [shakeCount, setShakeCount] = useState(0);
  const [gestureResult, setGestureResult] = useState<any>(null);
  const pollRef = useRef<any>(null);

  const loadAll = async () => {
    try {
      const [msg, v, o, s, n] = await Promise.all([
        api.getInbox(),
        api.getVfsStatus(),
        api.getOracleFeeds(),
        api.sandboxStatus(),
        api.neuralStatus(),
      ]);
      setInbox(msg);
      setVfs(v);
      setOracle(o);
      setSandbox(s);
      setNeural(n);
    } catch {}
  };

  useEffect(() => {
    loadAll();
    pollRef.current = setInterval(loadAll, 3000);
    return () => {
      clearInterval(pollRef.current);
      accelSub.current?.remove();
    };
  }, []);

  // Real gesture engine — calibrated accelerometer + gyroscope
  const [calibrated, setCalibrated] = useState(false);
  const { isNativeAvailable: voiceNative, processText: processVoiceText } = useVoiceEngine();

  useEffect(() => {
    if (tab === 'neural') {
      gestureEngine.start();
      // Poll calibration status
      const calPoll = setInterval(() => {
        const { calibrated: cal } = gestureEngine.getCalibrationStatus();
        setCalibrated(cal);
        if (cal) clearInterval(calPoll);
      }, 200);
      // Listen for gestures
      const unsub = gestureEngine.onGesture(async (event) => {
        haptic.heavy();
        setShakeCount(0);
        const r = await api.neuralGesture(event.gesture, event.accel_data);
        setGestureResult({ ...r, confidence: event.confidence });
        await loadAll();
      });
      return () => {
        gestureEngine.stop();
        unsub();
        clearInterval(calPoll);
      };
    } else {
      gestureEngine.stop();
    }
  }, [tab]);

  const onRefresh = async () => {
    haptic.tap(); setRefreshing(true);
    await loadAll(); setRefreshing(false);
  };

  const handleGesture = async (gesture: string) => {
    try {
      const r = await api.neuralGesture(gesture);
      setGestureResult(r);
      haptic.success();
      await loadAll();
    } catch {}
  };

  const handleVoice = async () => {
    if (!voiceInput.trim()) return;
    haptic.tap(); setLoading('voice');
    try {
      const r = await api.neuralVoice({ transcript: voiceInput, confidence: 0.92 });
      setVoiceResult(r);
      haptic.success();
      await loadAll();
    } catch { haptic.error(); }
    setLoading(null);
  };

  const TABS: { id: Tab; label: string; icon: string; badge?: number }[] = [
    { id: 'msg', label: 'MSG', icon: 'message-circle', badge: inbox?.unread },
    { id: 'vfs', label: 'VFS', icon: 'hard-drive' },
    { id: 'oracle', label: 'ORACLE', icon: 'globe' },
    { id: 'wasm', label: 'WASM', icon: 'box' },
    { id: 'neural', label: 'NEURAL', icon: 'mic' },
  ];

  return (
    <SafeAreaView style={RESET.screen} testID="infra-screen">
      <View style={RESET.header}>
        <TouchableOpacity onPress={() => { haptic.tap(); router.back(); }}>
          <Feather name="arrow-left" size={20} color={C.fgSecondary} />
        </TouchableOpacity>
        <Text style={{ fontFamily: MONO, fontSize: 11, color: C.fg, letterSpacing: 4 }}>INFRASTRUCTURE</Text>
        <OracleWidget />
      </View>

      <BridgeStatusBar />

      <View style={s.tabs}>
        {TABS.map(t => (
          <TouchableOpacity
            key={t.id}
            style={[s.tab, tab === t.id && s.tabActive]}
            onPress={() => { haptic.selection(); setTab(t.id); }}
          >
            <View style={{ position: 'relative' }}>
              <Feather name={t.icon as any} size={13} color={tab === t.id ? C.accent : C.fgSecondary} />
              {t.badge ? (
                <View style={s.badge}><Text style={s.badgeText}>{t.badge}</Text></View>
              ) : null}
            </View>
            <Text style={[s.tabText, tab === t.id && s.tabTextActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={{ paddingHorizontal: SP.lg, paddingTop: SP.sm }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}
      >

        {/* ── MESSAGING TAB ── */}
        {tab === 'msg' && (
          <>
            <View style={[GRID.border, s.card]}>
              <Text style={RESET.sectionLabel}>DOUBLE RATCHET CHANNEL</Text>
              <Text style={s.desc}>
                Agent → Architect: out-of-band alerts via Double Ratchet + Dilithium3.
                Zero metadata. Forward secrecy per message.
              </Text>
              <View style={s.rowData}>
                <Text style={s.rowK}>Ratchet steps</Text>
                <Text style={s.rowV}>{inbox?.ratchet_steps ?? 0}</Text>
              </View>
              <View style={s.rowData}>
                <Text style={s.rowK}>Unread</Text>
                <Text style={[s.rowV, { color: (inbox?.unread ?? 0) > 0 ? C.accent : C.fg }]}>{inbox?.unread ?? 0}</Text>
              </View>
              <View style={s.rowData}>
                <Text style={s.rowK}>Last alert</Text>
                <Text style={s.rowV}>{inbox?.last_alert?.slice(11, 19) || 'none'}</Text>
              </View>
              <TouchableOpacity style={s.actionBtn} onPress={async () => { haptic.tap(); await api.sendTestMessage(); await loadAll(); }}>
                <Text style={s.actionText}>Send Test Message</Text>
              </TouchableOpacity>
            </View>
            <Text style={RESET.sectionLabel}>INBOX ({inbox?.messages?.length ?? 0})</Text>
            {(inbox?.messages || []).map((m: any) => (
              <TouchableOpacity
                key={m.id}
                style={[s.msgItem, !m.read && { borderColor: `${PRIORITY_COLOR[m.priority] || C.blue}40`, backgroundColor: `${PRIORITY_COLOR[m.priority] || C.blue}05` }]}
                onPress={async () => { await api.markRead(m.id); await loadAll(); }}
              >
                <View style={[s.msgDot, { backgroundColor: PRIORITY_COLOR[m.priority] || C.blue }]} />
                <View style={{ flex: 1 }}>
                  <View style={s.msgHeader}>
                    <Text style={[s.msgType, { color: PRIORITY_COLOR[m.priority] }]}>{m.msg_type.toUpperCase()}</Text>
                    <Text style={s.msgTs}>{m.received_at?.slice(11, 19)} · {m.delivery} · ratchet#{m.ratchet_step}</Text>
                  </View>
                  <Text style={s.msgBody} numberOfLines={2}>{m.preview}</Text>
                  <Text style={s.msgSig}>Dilithium3: {m.dilithium_sig?.slice(0, 20)}...</Text>
                </View>
                {!m.read && <View style={s.unreadDot} />}
              </TouchableOpacity>
            ))}
            {!inbox?.messages?.length && <Text style={s.empty}>No messages. Agent will send alerts automatically.</Text>}
          </>
        )}

        {/* ── VFS TAB ── */}
        {tab === 'vfs' && (
          <>
            <View style={[GRID.border, s.card, vfs?.frozen && { borderColor: `${C.error}40` }]}>
              <View style={s.vfsHeader}>
                <Text style={RESET.sectionLabel}>QUANTUM-SAFE VFS</Text>
                <View style={[s.mountBadge, { borderColor: vfs?.frozen ? `${C.error}40` : `${C.success}40` }]}>
                  <View style={[s.mountDot, { backgroundColor: vfs?.frozen ? C.error : C.success }]} />
                  <Text style={[s.mountText, { color: vfs?.frozen ? C.error : C.success }]}>
                    {vfs?.frozen ? 'FROZEN' : 'MOUNTED'}
                  </Text>
                </View>
              </View>
              {vfs?.frozen && (
                <View style={s.freezeAlert}>
                  <Feather name="lock" size={12} color={C.error} />
                  <Text style={s.freezeText}>{vfs.freeze_reason}</Text>
                </View>
              )}
              {[
                ['Encryption', vfs?.encryption || 'AES-256-GCM'],
                ['Key version', `v${vfs?.key_version ?? 1}`],
                ['Key rotations', String(vfs?.key_rotations ?? 0)],
                ['Last rotation', vfs?.last_key_rotation?.slice(11, 19) || 'pending'],
                ['Files', String(vfs?.file_count ?? 0)],
                ['RAM keys wiped', vfs?.ram_keys_wiped ? 'YES' : 'No'],
              ].map(([k, v]) => (
                <View key={k} style={s.rowData}>
                  <Text style={s.rowK}>{k}</Text>
                  <Text style={[s.rowV, k === 'RAM keys wiped' && vfs?.ram_keys_wiped ? { color: C.error } : {}]}>{v}</Text>
                </View>
              ))}
              {vfs?.frozen && (
                <TouchableOpacity style={[s.actionBtn, { backgroundColor: C.accentDim }]} onPress={async () => { haptic.heavy(); await api.vfsThaw(); await loadAll(); }}>
                  <Text style={[s.actionText, { color: C.accent }]}>Thaw VFS (Re-mount after verification)</Text>
                </TouchableOpacity>
              )}
            </View>
            <View style={[GRID.border, s.card]}>
              <Text style={RESET.sectionLabel}>WRITE FILE</Text>
              <TextInput style={s.input} value={vfsPath} onChangeText={setVfsPath} placeholder="/path/to/file" placeholderTextColor={C.fgTertiary} autoCapitalize="none" />
              <TextInput style={[s.input, { height: 60, textAlignVertical: 'top', paddingTop: 10 }]} value={vfsContent} onChangeText={setVfsContent} placeholder="File content..." placeholderTextColor={C.fgTertiary} multiline />
              <TouchableOpacity style={s.actionBtn} onPress={async () => { if (!vfsContent) return; haptic.tap(); await api.vfsWrite(vfsPath, vfsContent); await loadAll(); }}>
                <Text style={s.actionText}>Encrypt & Write</Text>
              </TouchableOpacity>
            </View>
            <View style={[GRID.border, s.card]}>
              <Text style={RESET.sectionLabel}>READ FILE</Text>
              <TextInput style={s.input} value={vfsPath} onChangeText={setVfsPath} placeholder="/path/to/file" placeholderTextColor={C.fgTertiary} autoCapitalize="none" />
              <TouchableOpacity style={s.actionBtn} onPress={async () => { haptic.tap(); const r = await api.vfsRead(vfsPath).catch(() => null); setVfsReadResult(r?.content ?? 'Not found or decryption failed'); }}>
                <Text style={s.actionText}>Decrypt & Read</Text>
              </TouchableOpacity>
              {vfsReadResult !== null && (
                <View style={s.readResult}>
                  <Text style={s.readResultText}>{vfsReadResult}</Text>
                </View>
              )}
            </View>
          </>
        )}

        {/* ── ORACLE TAB ── */}
        {tab === 'oracle' && (
          <>
            <View style={[GRID.border, s.card]}>
              <View style={s.oracleHeader}>
                <Text style={RESET.sectionLabel}>ORACLE BRIDGE</Text>
                <View style={[s.healthBadge, { borderColor: `${oracle?.health_score > 0.7 ? C.success : C.warning}40` }]}>
                  <Text style={[s.healthScore, { color: oracle?.health_score > 0.7 ? C.success : C.warning }]}>
                    HEALTH {Math.round((oracle?.health_score ?? 1) * 100)}%
                  </Text>
                </View>
              </View>
              <Text style={s.desc}>3-of-3 validator consensus. BFT median aggregation. Dilithium3-signed feeds.</Text>
              <Text style={s.lastRefresh}>Last refresh: {oracle?.last_refresh?.slice(11, 19) || '--'}</Text>
            </View>
            {Object.entries(oracle?.feeds || {}).map(([feedId, feed]: any) => (
              <View key={feedId} style={[GRID.border, s.oracleFeed, { borderColor: feed.verified ? `${C.success}20` : `${C.error}20` }]}>
                <View style={s.feedHeader}>
                  <Text style={s.feedSymbol}>{feed.symbol}</Text>
                  <View style={[s.feedVerBadge, { backgroundColor: feed.verified ? `${C.success}12` : `${C.error}12` }]}>
                    <Feather name={feed.verified ? 'check-circle' : 'x-circle'} size={10} color={feed.verified ? C.success : C.error} />
                    <Text style={[s.feedVerText, { color: feed.verified ? C.success : C.error }]}>
                      {feed.sig_count}/{feed.bft_threshold} sigs
                    </Text>
                  </View>
                </View>
                <Text style={s.feedValue}>{feed.value?.toLocaleString(undefined, { minimumFractionDigits: feed.symbol === 'NETWORK' ? 3 : 2 })}</Text>
                <View style={s.feedSources}>
                  {(feed.sources || []).map((v: number, i: number) => (
                    <Text key={i} style={s.feedSource}>{v?.toFixed(feed.symbol === 'NETWORK' ? 3 : 0)}</Text>
                  ))}
                </View>
                <Text style={s.feedSpread}>spread: {feed.spread} · {feed.last_updated?.slice(11, 19)}</Text>
              </View>
            ))}
          </>
        )}

        {/* ── WASM TAB ── */}
        {tab === 'wasm' && (
          <>
            <View style={[GRID.border, s.card]}>
              <Text style={RESET.sectionLabel}>WASM SANDBOX</Text>
              <Text style={s.desc}>Isolated execution. AI monitors resources. Unauthorized permission access = instant termination.</Text>
              <View style={s.rowData}>
                <Text style={s.rowK}>Total runs</Text>
                <Text style={s.rowV}>{sandbox?.total_runs ?? 0}</Text>
              </View>
              <View style={s.rowData}>
                <Text style={s.rowK}>Terminated</Text>
                <Text style={[s.rowV, { color: (sandbox?.terminated_count ?? 0) > 0 ? C.error : C.fg }]}>{sandbox?.terminated_count ?? 0}</Text>
              </View>
              <View style={s.rowData}>
                <Text style={s.rowK}>Active modules</Text>
                <Text style={s.rowV}>{Object.keys(sandbox?.modules || {}).length}</Text>
              </View>
            </View>
            <View style={[GRID.border, s.card]}>
              <Text style={RESET.sectionLabel}>REGISTER + RUN MODULE</Text>
              <TextInput style={s.input} value={wasmId} onChangeText={setWasmId} placeholder="module_id" placeholderTextColor={C.fgTertiary} autoCapitalize="none" />
              <TextInput style={[s.input, { height: 50 }]} value={wasmCode} onChangeText={setWasmCode} placeholder="code..." placeholderTextColor={C.fgTertiary} multiline />
              <Text style={s.permLabel}>PERMISSIONS: {wasmPerms.join(', ')}</Text>
              <View style={s.permGrid}>
                {['read_stability', 'read_metrics', 'hal_thermal', 'write_agent_log', 'network_read', 'wallet_read'].map(p => (
                  <TouchableOpacity
                    key={p}
                    style={[s.permBtn, wasmPerms.includes(p) && { backgroundColor: `${C.accent}20`, borderColor: `${C.accent}40` }]}
                    onPress={() => {
                      haptic.tap();
                      setWasmPerms(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]);
                    }}
                  >
                    <Text style={[s.permBtnText, wasmPerms.includes(p) && { color: C.accent }]}>{p}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={s.wasmBtns}>
                <TouchableOpacity style={[s.wasmBtn, { flex: 1 }]} onPress={async () => { if (!wasmId) return; haptic.tap(); await api.sandboxRegister({ module_id: wasmId, code: wasmCode, permissions: wasmPerms }); await loadAll(); }}>
                  <Text style={s.wasmBtnText}>Register</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.wasmBtn, { flex: 1, backgroundColor: C.accentDim, borderColor: `${C.accent}40` }]} onPress={async () => {
                  if (!wasmId) return; haptic.medium();
                  const r = await api.sandboxRun({ module_id: wasmId, args: { log_message: `[${wasmId}] executed` } });
                  setWasmResult(r); haptic.success();
                }}>
                  <Text style={[s.wasmBtnText, { color: C.accent }]}>Run</Text>
                </TouchableOpacity>
              </View>
              {wasmResult && (
                <View style={[s.wasmResult, { borderColor: wasmResult.terminated ? `${C.error}40` : `${C.success}40` }]}>
                  <Text style={[s.wasmResultTitle, { color: wasmResult.terminated ? C.error : C.success }]}>
                    {wasmResult.terminated ? '⛔ TERMINATED' : '✓ EXECUTED'}
                  </Text>
                  {wasmResult.terminated
                    ? <Text style={s.wasmResultText}>{wasmResult.reason}</Text>
                    : <>
                        <Text style={s.wasmResultText}>Time: {wasmResult.exec_time_ms}ms  Mem: {wasmResult.memory_kb}KB</Text>
                        <Text style={s.wasmResultText}>Output: {JSON.stringify(wasmResult.output, null, 0)}</Text>
                      </>
                  }
                </View>
              )}
            </View>
            {Object.entries(sandbox?.modules || {}).map(([id, mod]: any) => (
              <View key={id} style={[GRID.border, s.moduleItem]}>
                <View style={[s.moduleDot, { backgroundColor: mod.status === 'terminated' ? C.error : C.success }]} />
                <View style={{ flex: 1 }}>
                  <Text style={s.moduleId}>{id}</Text>
                  <Text style={s.moduleMeta}>calls={mod.resource_usage?.calls} cpu={mod.resource_usage?.cpu_ms?.toFixed(0)}ms perms={mod.permissions?.join(',')}</Text>
                </View>
                <Text style={[s.moduleStatus, { color: mod.status === 'terminated' ? C.error : mod.status === 'running' ? C.warning : C.success }]}>{mod.status.toUpperCase()}</Text>
              </View>
            ))}
          </>
        )}

        {/* ── NEURAL TAB ── */}
        {tab === 'neural' && (
          <>
            {/* Gesture live indicator */}
            <View style={[GRID.border, s.card, { borderColor: shakeCount > 0 ? `${C.accent}50` : C.border }]}>
              <Text style={RESET.sectionLabel}>GESTURE DETECTOR (ACCELEROMETER)</Text>
              <Text style={s.desc}>Shake your device to trigger gestures. No cloud — fully local.</Text>
              <View style={s.shakeRow}>
                <Text style={[s.shakeCount, { color: shakeCount > 0 ? C.accent : C.fgTertiary }]}>{shakeCount}/3</Text>
                <Text style={s.shakeLabel}>shakes detected</Text>
                {shakeCount > 0 && <Text style={[s.shakeLabel, { color: C.accent }]}>Keep shaking!</Text>}
              </View>
              {gestureResult && (
                <View style={[s.gestResult, { borderColor: `${C.success}30` }]}>
                  <Text style={s.gestResultTitle}>↗ {gestureResult.gesture} → {gestureResult.action}</Text>
                  <Text style={s.gestResultBody}>{gestureResult.result?.result}</Text>
                </View>
              )}
              <Text style={RESET.sectionLabel}>TEST GESTURES</Text>
              {[
                { gesture: 'shake_3x', label: 'Shake ×3', color: C.error, desc: 'Emergency Reset' },
                { gesture: 'tilt_left_3x', label: 'Tilt ←×3', color: C.success, desc: 'Force Realign' },
                { gesture: 'tilt_right_3x', label: 'Tilt →×3', color: C.blue, desc: 'ECO Mode' },
                { gesture: 'flip_up_2x', label: 'Flip ↑×2', color: C.purple, desc: 'Start Learning' },
                { gesture: 'tap_back_4x', label: 'Tap ×4', color: C.warning, desc: 'VFS Freeze' },
              ].map(g => (
                <TouchableOpacity
                  key={g.gesture}
                  style={[s.gestBtn, { borderColor: `${g.color}25` }]}
                  onPress={() => { haptic.medium(); handleGesture(g.gesture); }}
                >
                  <View style={[s.gestIcon, { backgroundColor: `${g.color}10` }]}>
                    <Text style={[s.gestIconText, { color: g.color }]}>{g.label}</Text>
                  </View>
                  <Text style={s.gestDesc}>{g.desc}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={[GRID.border, s.card]}>
              <Text style={RESET.sectionLabel}>VOICE COMMAND (LOCAL STT)</Text>
              <Text style={s.desc}>Type or dictate — runs Whisper.cpp / Vosk on-device. No cloud.</Text>
              <TextInput
                style={s.input}
                value={voiceInput}
                onChangeText={setVoiceInput}
                placeholder='e.g. "IONA lockdown" or "status stability"'
                placeholderTextColor={C.fgTertiary}
                onSubmitEditing={handleVoice}
              />
              <TouchableOpacity style={s.actionBtn} onPress={handleVoice} disabled={loading === 'voice'}>
                <Feather name="mic" size={14} color={C.fg} style={{ marginRight: 6 }} />
                <Text style={s.actionText}>{loading === 'voice' ? 'Processing...' : 'Send Voice Command'}</Text>
              </TouchableOpacity>
              {voiceResult && (
                <View style={[s.voiceResult, { borderColor: voiceResult.ok ? `${C.success}30` : `${C.error}30` }]}>
                  {voiceResult.ok
                    ? <>
                        <Text style={[s.voiceResultTitle, { color: C.success }]}>✓ "{voiceResult.matched}" → {voiceResult.action}</Text>
                        <Text style={s.voiceResultBody}>{voiceResult.result?.result}</Text>
                      </>
                    : <Text style={[s.voiceResultTitle, { color: C.error }]}>No match: {voiceResult.reason}</Text>
                  }
                </View>
              )}
              <Text style={RESET.sectionLabel}>AVAILABLE COMMANDS</Text>
              <View style={s.cmdGrid}>
                {(neural?.voice_commands || []).slice(0, 12).map((cmd: string) => (
                  <TouchableOpacity
                    key={cmd}
                    style={s.cmdChip}
                    onPress={() => { haptic.tap(); setVoiceInput(`IONA ${cmd}`); }}
                  >
                    <Text style={s.cmdChipText}>{cmd}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
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
  tabText: { fontFamily: MONO, fontSize: 9, color: C.fgSecondary, letterSpacing: 0.5 },
  tabTextActive: { color: C.accent },
  badge: { position: 'absolute', top: -4, right: -6, width: 12, height: 12, backgroundColor: C.accent, borderRadius: R.xs, justifyContent: 'center', alignItems: 'center' },
  badgeText: { fontFamily: MONO, fontSize: 7, color: C.bg },
  card: { padding: SP.md, backgroundColor: C.surface, marginBottom: SP.sm },
  desc: { fontFamily: MONO, fontSize: 10, color: C.fgSecondary, lineHeight: 16, marginBottom: SP.sm },
  rowData: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: C.borderSubtle },
  rowK: { fontFamily: MONO, fontSize: 10, color: C.fgSecondary },
  rowV: { fontFamily: MONO, fontSize: 10, color: C.fg },
  actionBtn: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: C.border, height: 38, marginTop: SP.sm },
  actionText: { fontFamily: MONO, fontSize: 11, color: C.fg },
  // Messages
  msgItem: { ...GRID.border, padding: SP.sm, marginBottom: 5, backgroundColor: C.surface, flexDirection: 'row', gap: 8 },
  msgDot: { width: 5, height: 5, borderRadius: R.xs, marginTop: 4, flexShrink: 0 },
  msgHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  msgType: { fontFamily: MONO, fontSize: 9, fontWeight: '700', letterSpacing: 1 },
  msgTs: { fontFamily: MONO, fontSize: 8, color: C.fgTertiary },
  msgBody: { fontFamily: MONO, fontSize: 11, color: C.fg, lineHeight: 16 },
  msgSig: { fontFamily: MONO, fontSize: 8, color: C.fgTertiary, marginTop: 2 },
  unreadDot: { width: 7, height: 7, borderRadius: R.xs, backgroundColor: C.accent, alignSelf: 'center', flexShrink: 0 },
  // VFS
  vfsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SP.xs },
  mountBadge: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, paddingHorizontal: 7, paddingVertical: 3 },
  mountDot: { width: 5, height: 5, borderRadius: R.xs, marginRight: 5 },
  mountText: { fontFamily: MONO, fontSize: 9, letterSpacing: 1 },
  freezeAlert: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, backgroundColor: `${C.error}08`, borderWidth: 1, borderColor: `${C.error}30`, padding: SP.sm, marginBottom: SP.sm },
  freezeText: { fontFamily: MONO, fontSize: 10, color: C.error, flex: 1, lineHeight: 15 },
  input: { height: 42, borderWidth: 1, borderColor: C.border, paddingHorizontal: SP.md, color: C.fg, fontFamily: MONO, fontSize: 12, marginBottom: SP.sm, backgroundColor: C.bg },
  readResult: { borderWidth: 1, borderColor: `${C.success}30`, backgroundColor: `${C.success}05`, padding: SP.sm, marginTop: SP.sm },
  readResultText: { fontFamily: MONO, fontSize: 11, color: C.success },
  // Oracle
  oracleHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SP.xs },
  healthBadge: { borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  healthScore: { fontFamily: MONO, fontSize: 9, letterSpacing: 1 },
  lastRefresh: { fontFamily: MONO, fontSize: 9, color: C.fgTertiary, marginTop: SP.xs },
  oracleFeed: { padding: SP.md, backgroundColor: C.surface, marginBottom: SP.sm },
  feedHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  feedSymbol: { fontFamily: MONO, fontSize: 10, color: C.fgSecondary, letterSpacing: 2 },
  feedVerBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 6, paddingVertical: 2, borderRadius: R.none },
  feedVerText: { fontFamily: MONO, fontSize: 9 },
  feedValue: { fontFamily: MONO, fontSize: 24, color: C.fg, fontWeight: '200', marginBottom: 4 },
  feedSources: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  feedSource: { fontFamily: MONO, fontSize: 9, color: C.fgTertiary },
  feedSpread: { fontFamily: MONO, fontSize: 9, color: C.fgTertiary },
  // WASM
  permLabel: { fontFamily: MONO, fontSize: 9, color: C.fgSecondary, letterSpacing: 1, marginBottom: SP.sm },
  permGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginBottom: SP.sm },
  permBtn: { borderWidth: 1, borderColor: C.border, paddingHorizontal: 7, paddingVertical: 4, borderRadius: R.none },
  permBtnText: { fontFamily: MONO, fontSize: 9, color: C.fgSecondary },
  wasmBtns: { flexDirection: 'row', gap: 8 },
  wasmBtn: { height: 38, borderWidth: 1, borderColor: C.border, justifyContent: 'center', alignItems: 'center' },
  wasmBtnText: { fontFamily: MONO, fontSize: 11, color: C.fg },
  wasmResult: { borderWidth: 1, padding: SP.sm, marginTop: SP.sm },
  wasmResultTitle: { fontFamily: MONO, fontSize: 11, fontWeight: '700', marginBottom: 3 },
  wasmResultText: { fontFamily: MONO, fontSize: 10, color: C.fgSecondary, lineHeight: 16 },
  moduleItem: { flexDirection: 'row', alignItems: 'center', padding: SP.sm, marginBottom: 4, backgroundColor: C.surface, gap: 8 },
  moduleDot: { width: 6, height: 6, borderRadius: R.xs, flexShrink: 0 },
  moduleId: { fontFamily: MONO, fontSize: 12, color: C.fg, fontWeight: '600' },
  moduleMeta: { fontFamily: MONO, fontSize: 9, color: C.fgTertiary, marginTop: 2 },
  moduleStatus: { fontFamily: MONO, fontSize: 9, letterSpacing: 1 },
  // Gesture
  shakeRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: SP.sm },
  shakeCount: { fontFamily: MONO, fontSize: 32, fontWeight: '100' },
  shakeLabel: { fontFamily: MONO, fontSize: 11, color: C.fgSecondary },
  gestResult: { borderWidth: 1, padding: SP.sm, marginBottom: SP.sm },
  gestResultTitle: { fontFamily: MONO, fontSize: 11, fontWeight: '700', color: C.success },
  gestResultBody: { fontFamily: MONO, fontSize: 10, color: C.fgSecondary, marginTop: 2 },
  gestBtn: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, padding: SP.md, marginBottom: 5, backgroundColor: C.surface, gap: 12 },
  gestIcon: { paddingHorizontal: 10, paddingVertical: 6 },
  gestIconText: { fontFamily: MONO, fontSize: 11, fontWeight: '700' },
  gestDesc: { fontFamily: MONO, fontSize: 11, color: C.fgSecondary },
  // Voice
  voiceResult: { borderWidth: 1, padding: SP.sm, marginTop: SP.sm },
  voiceResultTitle: { fontFamily: MONO, fontSize: 11, fontWeight: '700', marginBottom: 2 },
  voiceResultBody: { fontFamily: MONO, fontSize: 10, color: C.fgSecondary },
  cmdGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 5, marginTop: SP.sm },
  cmdChip: { borderWidth: 1, borderColor: C.border, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: C.surface },
  cmdChipText: { fontFamily: MONO, fontSize: 9, color: C.fgSecondary },
  empty: { fontFamily: MONO, fontSize: 11, color: C.fgTertiary, textAlign: 'center', paddingVertical: SP.xl },
});
