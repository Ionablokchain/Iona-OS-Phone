import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  TextInput, Modal, KeyboardAvoidingView, Platform, Share,
  Dimensions, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { C, MONO } from '@/src/theme';
import { api } from '@/src/utils/api';
import { useAuth } from '@/src/context/AuthContext';
import { haptic } from '@/src/utils/haptics';

const { width: W } = Dimensions.get('window');
const CHART_W = W - 48;

function genPriceHistory(base: number, points = 30) {
  const arr: number[] = [base];
  for (let i = 1; i < points; i++) {
    const prev = arr[i - 1];
    arr.push(Math.max(prev + (Math.random() - 0.46) * prev * 0.04, 1));
  }
  return arr;
}

function MiniChart({ data, color }: { data: number[]; color: string }) {
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  return (
    <View style={{ width: CHART_W, height: 56 }}>
      {data.map((v, i) => {
        if (i === 0) return null;
        const x1 = ((i - 1) / (data.length - 1)) * CHART_W;
        const x2 = (i / (data.length - 1)) * CHART_W;
        const y1 = 52 - ((data[i - 1] - min) / range) * 48;
        const y2 = 52 - ((v - min) / range) * 48;
        const dx = x2 - x1; const dy = y2 - y1;
        const len = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx) * 180 / Math.PI;
        return (
          <View key={i} style={{
            position: 'absolute', left: x1, top: y1,
            width: len, height: 2, backgroundColor: color, opacity: 0.9,
            transform: [{ rotate: `${angle}deg` }, { translateY: -1 }],
          }} />
        );
      })}
      <View style={{
        position: 'absolute',
        left: CHART_W - 5,
        top: 52 - ((data[data.length - 1] - min) / range) * 48 - 4,
        width: 8, height: 8, borderRadius: 0, backgroundColor: color,
      }} />
    </View>
  );
}

const PERIODS = ['1D', '1W', '1M', '3M', 'ALL'];
type Tab = 'wallet' | 'explorer' | 'validators';

export default function WalletScreen() {
  const router = useRouter();
  const { refreshUser } = useAuth();
  const [wallet, setWallet] = useState<any>(null);
  const [protocol, setProtocol] = useState<any>(null);
  const [validators, setValidators] = useState<any[]>([]);
  const [latestBlock, setLatestBlock] = useState<any>(null);
  const [showSend, setShowSend] = useState(false);
  const [showReceive, setShowReceive] = useState(false);
  const [toAddr, setToAddr] = useState('');
  const [amount, setAmount] = useState('');
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState('');
  const [copied, setCopied] = useState(false);
  const [period, setPeriod] = useState('1M');
  const [tab, setTab] = useState<Tab>('wallet');
  const [refreshing, setRefreshing] = useState(false);
  const [priceData] = useState(() => genPriceHistory(12404, 30));

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    const [w, p, v] = await Promise.all([
      api.getWallet().catch(() => null),
      api.getProtocolStatus().catch(() => null),
      api.getProtocolValidators().catch(() => null),
    ]);
    setWallet(w);
    setProtocol(p);
    if (v?.validators) setValidators(v.validators);
    // Load latest block
    if (p?.block_height) {
      const b = await api.getProtocolBlock(p.block_height).catch(() => null);
      if (b) setLatestBlock(b);
    }
  };

  const onRefresh = async () => {
    haptic.tap();
    setRefreshing(true);
    await loadAll();
    setRefreshing(false);
  };

  const handleSend = async () => {
    if (!toAddr || !amount || parseFloat(amount) <= 0) return;
    haptic.medium();
    setSending(true);
    try {
      const res = await api.sendTokens({ to_address: toAddr, amount: parseFloat(amount) });
      haptic.success();
      setSendResult(`Sent! TX: ${res.transaction.tx_hash.slice(0, 16)}...`);
      setToAddr(''); setAmount('');
      loadAll(); refreshUser();
      setTimeout(() => { setShowSend(false); setSendResult(''); }, 2000);
    } catch (e: any) { haptic.error(); setSendResult(e.message); }
    setSending(false);
  };

  const copyAddress = () => { haptic.tap(); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  const shareAddress = async () => {
    haptic.tap();
    try { await Share.share({ message: `My IONA wallet: ${wallet?.address}` }); } catch {}
  };

  const priceChange = priceData.length > 1
    ? ((priceData[priceData.length - 1] - priceData[0]) / priceData[0] * 100) : 0;
  const isUp = priceChange >= 0;
  const chartColor = isUp ? C.success : C.error;
  const protocolConnected = protocol?.connected !== false;

  return (
    <SafeAreaView style={s.container} testID="wallet-screen">
      <View style={s.header}>
        <TouchableOpacity onPress={() => { haptic.tap(); router.back(); }}>
          <Feather name="arrow-left" size={22} color={C.fgSecondary} />
        </TouchableOpacity>
        <Text style={s.title}>Wallet</Text>
        <View style={[s.protocolBadge, { borderColor: protocolConnected ? `${C.success}40` : `${C.fgSecondary}30` }]}>
          <View style={[s.protocolDot, { backgroundColor: protocolConnected ? C.success : C.fgSecondary }]} />
          <Text style={[s.protocolText, { color: protocolConnected ? C.success : C.fgSecondary }]}>
            {protocolConnected ? 'v37.3' : 'sim'}
          </Text>
        </View>
      </View>

      {/* Tabs */}
      <View style={s.tabs}>
        {(['wallet', 'explorer', 'validators'] as Tab[]).map(t => (
          <TouchableOpacity
            key={t}
            style={[s.tab, tab === t && s.tabActive]}
            onPress={() => { haptic.selection(); setTab(t); }}
          >
            <Text style={[s.tabText, tab === t && s.tabTextActive]}>{t.toUpperCase()}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}
      >
        {tab === 'wallet' && (
          <>
            {/* Balance */}
            <LinearGradient colors={['rgba(255,75,0,0.14)', 'rgba(245,158,11,0.06)', 'rgba(255,75,0,0.02)']} style={s.balanceCard}>
              <Text style={s.balanceLabel}>TOTAL BALANCE</Text>
              <Text style={s.balanceValue} testID="wallet-balance">
                {wallet ? wallet.balance.toLocaleString(undefined, { minimumFractionDigits: 2 }) : '---'}
              </Text>
              <Text style={s.balanceCurrency}>IONA</Text>
              <TouchableOpacity onPress={copyAddress} style={s.addressRow}>
                <Text style={s.addressText} numberOfLines={1}>{wallet?.address || '...'}</Text>
                <Feather name={copied ? 'check' : 'copy'} size={14} color={copied ? C.success : C.fgSecondary} />
              </TouchableOpacity>
            </LinearGradient>

            {/* Protocol info */}
            {protocol && (
              <View style={s.protocolCard}>
                <View style={s.protocolRow}>
                  <View style={s.protocolStat}>
                    <Text style={s.pStatLabel}>BLOCK</Text>
                    <Text style={s.pStatVal}>#{protocol.block_height?.toLocaleString()}</Text>
                  </View>
                  <View style={s.protocolStat}>
                    <Text style={s.pStatLabel}>TPS</Text>
                    <Text style={s.pStatVal}>{protocol.tps}</Text>
                  </View>
                  <View style={s.protocolStat}>
                    <Text style={s.pStatLabel}>FINALITY</Text>
                    <Text style={s.pStatVal}>{protocol.finality}</Text>
                  </View>
                  <View style={s.protocolStat}>
                    <Text style={s.pStatLabel}>VALIDATORS</Text>
                    <Text style={s.pStatVal}>{protocol.validators}</Text>
                  </View>
                </View>
                <View style={s.pqRow}>
                  {['Dilithium3', 'Kyber768', 'SPHINCS+'].map(k => (
                    <View key={k} style={s.pqBadge}>
                      <View style={s.pqDot} />
                      <Text style={s.pqText}>{k}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* Chart */}
            <View style={s.chartCard}>
              <View style={s.chartHeader}>
                <View>
                  <Text style={s.chartTitle}>IONA / USD</Text>
                  <View style={s.chartChange}>
                    <Feather name={isUp ? 'trending-up' : 'trending-down'} size={13} color={chartColor} />
                    <Text style={[s.chartChangePct, { color: chartColor }]}>
                      {isUp ? '+' : ''}{priceChange.toFixed(2)}%
                    </Text>
                  </View>
                </View>
                <View style={s.periodRow}>
                  {PERIODS.map(p => (
                    <TouchableOpacity
                      key={p}
                      style={[s.periodBtn, period === p && { backgroundColor: C.accent }]}
                      onPress={() => { haptic.selection(); setPeriod(p); }}
                    >
                      <Text style={[s.periodText, period === p && { color: C.fg }]}>{p}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
              <MiniChart data={priceData} color={chartColor} />
            </View>

            {/* Actions */}
            <View style={s.actionRow}>
              <TouchableOpacity style={s.actionBtn} onPress={() => { haptic.tap(); setShowSend(true); }}>
                <LinearGradient colors={['rgba(255,75,0,0.15)', 'rgba(255,75,0,0.05)']} style={s.actionGrad}>
                  <Feather name="arrow-up-right" size={22} color={C.accent} />
                  <Text style={[s.actionText, { color: C.accent }]}>Send</Text>
                </LinearGradient>
              </TouchableOpacity>
              <TouchableOpacity style={s.actionBtn} onPress={() => { haptic.tap(); setShowReceive(true); }}>
                <LinearGradient colors={['rgba(0,255,65,0.15)', 'rgba(0,255,65,0.05)']} style={s.actionGrad}>
                  <Feather name="arrow-down-left" size={22} color={C.success} />
                  <Text style={[s.actionText, { color: C.success }]}>Receive</Text>
                </LinearGradient>
              </TouchableOpacity>
              <TouchableOpacity style={s.actionBtn} onPress={shareAddress}>
                <LinearGradient colors={['rgba(59,130,246,0.15)', 'rgba(59,130,246,0.05)']} style={s.actionGrad}>
                  <Feather name="share-2" size={22} color={C.blue} />
                  <Text style={[s.actionText, { color: C.blue }]}>Share</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>

            {/* Transactions */}
            <Text style={s.sectionTitle}>RECENT TRANSACTIONS</Text>
            {(wallet?.transactions || []).map((tx: any) => (
              <View key={tx.id} style={s.txItem}>
                <View style={[s.txIcon, {
                  backgroundColor: tx.from_address === wallet?.address ? 'rgba(255,75,0,0.1)' : 'rgba(0,255,65,0.1)'
                }]}>
                  <Feather
                    name={tx.from_address === wallet?.address ? 'arrow-up-right' : 'arrow-down-left'}
                    size={18}
                    color={tx.from_address === wallet?.address ? C.accent : C.success}
                  />
                </View>
                <View style={s.txInfo}>
                  <Text style={s.txHash} numberOfLines={1}>{tx.tx_hash.slice(0, 18)}...</Text>
                  <Text style={s.txBlock}>Block #{tx.block_height} · {tx.status}</Text>
                </View>
                <Text style={[s.txAmount, { color: tx.from_address === wallet?.address ? C.accent : C.success }]}>
                  {tx.from_address === wallet?.address ? '-' : '+'}{tx.amount}
                </Text>
              </View>
            ))}
            {(!wallet?.transactions?.length) && (
              <View style={s.emptyTx}>
                <Feather name="inbox" size={32} color={C.fgSecondary} />
                <Text style={s.emptyTxText}>No transactions yet</Text>
              </View>
            )}
          </>
        )}

        {tab === 'explorer' && (
          <>
            <Text style={s.sectionTitle}>BLOCK EXPLORER</Text>
            {protocol && (
              <View style={s.explorerHeader}>
                <View style={s.explorerStat}>
                  <Text style={s.expStatLabel}>LATEST BLOCK</Text>
                  <Text style={s.expStatVal}>#{protocol.block_height?.toLocaleString()}</Text>
                </View>
                <View style={s.explorerStat}>
                  <Text style={s.expStatLabel}>NETWORK</Text>
                  <Text style={s.expStatVal}>{protocol.network}</Text>
                </View>
              </View>
            )}
            {/* Latest block detail */}
            {latestBlock && (
              <View style={s.blockCard}>
                <View style={s.blockCardHeader}>
                  <Feather name="box" size={18} color={C.accent} />
                  <Text style={s.blockCardTitle}>Block #{latestBlock.height?.toLocaleString()}</Text>
                  <View style={[s.pqBadge, { marginLeft: 'auto' }]}>
                    <View style={s.pqDot} />
                    <Text style={s.pqText}>{latestBlock.source === 'protocol' ? 'LIVE' : 'SIM'}</Text>
                  </View>
                </View>
                <View style={s.blockRows}>
                  {[
                    ['Hash', `${latestBlock.hash?.slice(0, 20)}...`],
                    ['Proposer', latestBlock.proposer],
                    ['Transactions', String(latestBlock.tx_count)],
                    ['Size', `${latestBlock.size_kb} KB`],
                    ['Stability', String(latestBlock.stability_at_commit)],
                  ].map(([k, v]) => (
                    <View key={k} style={s.blockRow}>
                      <Text style={s.blockRowKey}>{k}</Text>
                      <Text style={s.blockRowVal} numberOfLines={1}>{v}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}
            {/* Previous blocks */}
            <Text style={s.sectionTitle}>RECENT BLOCKS</Text>
            {protocol && Array.from({ length: 5 }, (_, i) => protocol.block_height - i).map(h => (
              <TouchableOpacity
                key={h}
                style={s.blockListItem}
                onPress={async () => {
                  haptic.tap();
                  const b = await api.getProtocolBlock(h).catch(() => null);
                  if (b) setLatestBlock(b);
                }}
              >
                <View style={s.blockListIcon}>
                  <Feather name="box" size={16} color={C.accent} />
                </View>
                <View style={s.blockListInfo}>
                  <Text style={s.blockListHeight}>Block #{h?.toLocaleString()}</Text>
                  <Text style={s.blockListMeta}>Tendermint BFT · stability 1.420</Text>
                </View>
                <Feather name="chevron-right" size={16} color={C.fgSecondary} />
              </TouchableOpacity>
            ))}
          </>
        )}

        {tab === 'validators' && (
          <>
            <Text style={s.sectionTitle}>VALIDATOR SET</Text>
            {protocol && (
              <View style={s.validatorHeader}>
                <Text style={s.valHeaderText}>
                  {validators.filter(v => v.status === 'active').length}/{validators.length} active · 
                  Consensus: {protocol.consensus}
                </Text>
              </View>
            )}
            {validators.map((v, i) => (
              <View key={i} style={s.validatorCard}>
                <View style={s.validatorTop}>
                  <View style={[s.validatorIcon, { borderColor: v.status === 'active' ? `${C.success}40` : `${C.error}40` }]}>
                    <Feather name="server" size={18} color={v.status === 'active' ? C.success : C.error} />
                  </View>
                  <View style={s.validatorInfo}>
                    <Text style={s.validatorName}>{v.name}</Text>
                    <Text style={s.validatorAddr} numberOfLines={1}>{v.address?.slice(0, 22)}...</Text>
                  </View>
                  <View style={[s.valStatus, { backgroundColor: v.status === 'active' ? 'rgba(0,255,65,0.1)' : 'rgba(255,0,60,0.1)' }]}>
                    <Text style={[s.valStatusText, { color: v.status === 'active' ? C.success : C.error }]}>
                      {v.status.toUpperCase()}
                    </Text>
                  </View>
                </View>
                <View style={s.validatorStats}>
                  <View style={s.valStat}>
                    <Text style={s.valStatLabel}>POWER</Text>
                    <Text style={s.valStatVal}>{v.voting_power}</Text>
                  </View>
                  <View style={s.valStat}>
                    <Text style={s.valStatLabel}>UPTIME</Text>
                    <Text style={[s.valStatVal, { color: v.uptime_pct > 95 ? C.success : '#F59E0B' }]}>
                      {v.uptime_pct}%
                    </Text>
                  </View>
                  <View style={s.valStatBar}>
                    <View style={s.valBarTrack}>
                      <View style={[s.valBarFill, {
                        width: `${v.voting_power / 10}%` as any,
                        backgroundColor: v.status === 'active' ? C.success : C.error,
                      }]} />
                    </View>
                    <Text style={s.valBarPct}>{v.voting_power / 10}%</Text>
                  </View>
                </View>
              </View>
            ))}
          </>
        )}
        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Send Modal */}
      <Modal visible={showSend} transparent animationType="slide">
        <KeyboardAvoidingView style={s.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={s.modalContent}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Send IONA</Text>
              <TouchableOpacity onPress={() => { haptic.tap(); setShowSend(false); setSendResult(''); }}>
                <Feather name="x" size={24} color={C.fg} />
              </TouchableOpacity>
            </View>
            <Text style={s.modalLabel}>Recipient Address</Text>
            <TextInput style={s.modalInput} value={toAddr} onChangeText={setToAddr}
              placeholder="iona1..." placeholderTextColor={C.fgSecondary} autoCapitalize="none" />
            <Text style={s.modalLabel}>Amount (IONA)</Text>
            <TextInput style={s.modalInput} value={amount} onChangeText={setAmount}
              placeholder="0.00" placeholderTextColor={C.fgSecondary} keyboardType="numeric" />
            <Text style={s.modalBalance}>Available: {wallet?.balance?.toLocaleString() || 0} IONA</Text>
            {sendResult ? <Text style={s.sendResult}>{sendResult}</Text> : null}
            <TouchableOpacity
              style={[s.confirmBtn, (!toAddr || !amount) && { opacity: 0.5 }]}
              onPress={handleSend} disabled={sending || !toAddr || !amount}
            >
              <LinearGradient colors={[C.accent, '#E04000']} style={s.confirmGrad}>
                <Text style={s.confirmText}>{sending ? 'Sending...' : 'Confirm Send'}</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Receive Modal */}
      <Modal visible={showReceive} transparent animationType="slide">
        <View style={s.modalOverlay}>
          <View style={s.modalContent}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Receive IONA</Text>
              <TouchableOpacity onPress={() => { haptic.tap(); setShowReceive(false); }}>
                <Feather name="x" size={24} color={C.fg} />
              </TouchableOpacity>
            </View>
            <View style={s.qrPlaceholder}>
              <View style={s.qrGrid}>
                {Array.from({ length: 64 }).map((_, i) => (
                  <View key={i} style={[s.qrCell, (i + Math.floor(i / 8)) % 3 === 0 ? s.qrCellFilled : null]} />
                ))}
              </View>
            </View>
            <Text style={s.receiveLabel}>Your Wallet Address</Text>
            <View style={s.receiveAddrBox}>
              <Text style={s.receiveAddr} selectable numberOfLines={2}>{wallet?.address || '...'}</Text>
            </View>
            <View style={s.receiveActions}>
              <TouchableOpacity style={s.receiveBtn} onPress={copyAddress}>
                <Feather name={copied ? 'check' : 'copy'} size={18} color={copied ? C.success : C.fg} />
                <Text style={s.receiveBtnText}>{copied ? 'Copied!' : 'Copy'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.receiveBtn} onPress={shareAddress}>
                <Feather name="share-2" size={18} color={C.fg} />
                <Text style={s.receiveBtnText}>Share</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  title: { fontSize: 18, fontWeight: '700', color: C.fg },
  protocolBadge: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderRadius: 0, paddingHorizontal: 8, paddingVertical: 3 },
  protocolDot: { width: 5, height: 5, borderRadius: 2.5, marginRight: 5 },
  protocolText: { fontFamily: MONO, fontSize: 10, letterSpacing: 1 },
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: C.border, marginHorizontal: 16 },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center' },
  tabActive: { borderBottomWidth: 2, borderBottomColor: C.accent },
  tabText: { fontFamily: MONO, fontSize: 10, color: C.fgSecondary, letterSpacing: 1 },
  tabTextActive: { color: C.accent },
  scroll: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 40 },
  sectionTitle: { fontFamily: MONO, fontSize: 10, color: C.fgSecondary, letterSpacing: 3, marginBottom: 10, marginTop: 4 },
  balanceCard: { borderRadius: 0, padding: 22, borderWidth: 1, borderColor: 'rgba(255,75,0,0.15)', marginBottom: 12 },
  balanceLabel: { fontFamily: MONO, fontSize: 10, color: C.fgSecondary, letterSpacing: 3 },
  balanceValue: { fontFamily: MONO, fontSize: 40, color: C.fg, fontWeight: '200', marginTop: 4 },
  balanceCurrency: { fontFamily: MONO, fontSize: 13, color: C.accent, letterSpacing: 4, marginTop: -2 },
  addressRow: { flexDirection: 'row', alignItems: 'center', marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' },
  addressText: { fontFamily: MONO, fontSize: 11, color: C.fgSecondary, flex: 1, marginRight: 8 },
  protocolCard: { backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 0, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', padding: 14, marginBottom: 12 },
  protocolRow: { flexDirection: 'row', marginBottom: 10 },
  protocolStat: { flex: 1, alignItems: 'center' },
  pStatLabel: { fontFamily: MONO, fontSize: 8, color: C.fgSecondary, letterSpacing: 1, marginBottom: 3 },
  pStatVal: { fontFamily: MONO, fontSize: 13, color: C.fg, fontWeight: '600' },
  pqRow: { flexDirection: 'row', gap: 6 },
  pqBadge: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,255,65,0.08)', borderRadius: 0, paddingHorizontal: 7, paddingVertical: 3 },
  pqDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: C.success, marginRight: 4 },
  pqText: { fontFamily: MONO, fontSize: 9, color: C.success },
  chartCard: { backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 0, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', padding: 14, marginBottom: 12 },
  chartHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 },
  chartTitle: { fontFamily: MONO, fontSize: 10, color: C.fgSecondary, letterSpacing: 2 },
  chartChange: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  chartChangePct: { fontFamily: MONO, fontSize: 13, fontWeight: '600' },
  periodRow: { flexDirection: 'row', gap: 3 },
  periodBtn: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 0, backgroundColor: 'rgba(255,255,255,0.06)' },
  periodText: { fontFamily: MONO, fontSize: 9, color: C.fgSecondary },
  actionRow: { flexDirection: 'row', marginBottom: 18 },
  actionBtn: { flex: 1, marginHorizontal: 3, borderRadius: 0, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  actionGrad: { alignItems: 'center', paddingVertical: 14 },
  actionText: { fontFamily: MONO, fontSize: 11, letterSpacing: 1, marginTop: 5 },
  txItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.04)' },
  txIcon: { width: 38, height: 38, borderRadius: 0, justifyContent: 'center', alignItems: 'center', marginRight: 10 },
  txInfo: { flex: 1 },
  txHash: { fontFamily: MONO, fontSize: 12, color: C.fg },
  txBlock: { fontFamily: MONO, fontSize: 10, color: C.fgSecondary, marginTop: 2 },
  txAmount: { fontFamily: MONO, fontSize: 15, fontWeight: '600' },
  emptyTx: { alignItems: 'center', paddingVertical: 28 },
  emptyTxText: { fontFamily: MONO, fontSize: 12, color: C.fgSecondary, marginTop: 8 },
  // Explorer
  explorerHeader: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  explorerStat: { flex: 1, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 0, padding: 12 },
  expStatLabel: { fontFamily: MONO, fontSize: 9, color: C.fgSecondary, letterSpacing: 1, marginBottom: 4 },
  expStatVal: { fontFamily: MONO, fontSize: 16, color: C.fg, fontWeight: '600' },
  blockCard: { backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 0, borderWidth: 1, borderColor: 'rgba(255,75,0,0.15)', padding: 14, marginBottom: 14 },
  blockCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  blockCardTitle: { fontFamily: MONO, fontSize: 14, color: C.fg, fontWeight: '600' },
  blockRows: { gap: 6 },
  blockRow: { flexDirection: 'row', justifyContent: 'space-between' },
  blockRowKey: { fontFamily: MONO, fontSize: 11, color: C.fgSecondary },
  blockRowVal: { fontFamily: MONO, fontSize: 11, color: C.fg, flex: 1, textAlign: 'right' },
  blockListItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.04)', gap: 10 },
  blockListIcon: { width: 34, height: 34, borderRadius: 0, backgroundColor: 'rgba(255,75,0,0.1)', justifyContent: 'center', alignItems: 'center' },
  blockListInfo: { flex: 1 },
  blockListHeight: { fontFamily: MONO, fontSize: 13, color: C.fg, fontWeight: '600' },
  blockListMeta: { fontFamily: MONO, fontSize: 10, color: C.fgSecondary, marginTop: 2 },
  // Validators
  validatorHeader: { marginBottom: 10 },
  valHeaderText: { fontFamily: MONO, fontSize: 11, color: C.fgSecondary },
  validatorCard: { backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 0, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', padding: 14, marginBottom: 10 },
  validatorTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  validatorIcon: { width: 38, height: 38, borderRadius: 0, borderWidth: 1, justifyContent: 'center', alignItems: 'center', marginRight: 10 },
  validatorInfo: { flex: 1 },
  validatorName: { fontSize: 14, fontWeight: '600', color: C.fg },
  validatorAddr: { fontFamily: MONO, fontSize: 10, color: C.fgSecondary, marginTop: 2 },
  valStatus: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 0 },
  valStatusText: { fontFamily: MONO, fontSize: 9, letterSpacing: 1 },
  validatorStats: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  valStat: {},
  valStatLabel: { fontFamily: MONO, fontSize: 8, color: C.fgSecondary, letterSpacing: 1 },
  valStatVal: { fontFamily: MONO, fontSize: 14, color: C.fg, fontWeight: '600', marginTop: 2 },
  valStatBar: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  valBarTrack: { flex: 1, height: 4, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 2, overflow: 'hidden' },
  valBarFill: { height: 4, borderRadius: 2 },
  valBarPct: { fontFamily: MONO, fontSize: 10, color: C.fgSecondary, width: 32, textAlign: 'right' },
  // Modals
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: C.surface, padding: 24, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: C.fg },
  modalLabel: { fontFamily: MONO, fontSize: 10, color: C.fgSecondary, letterSpacing: 2, marginBottom: 5 },
  modalInput: { height: 50, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', borderRadius: 0, paddingHorizontal: 14, color: C.fg, fontFamily: MONO, fontSize: 14, marginBottom: 12, backgroundColor: 'rgba(255,255,255,0.03)' },
  modalBalance: { fontFamily: MONO, fontSize: 11, color: C.fgSecondary, marginBottom: 12 },
  sendResult: { fontFamily: MONO, fontSize: 12, color: C.success, marginBottom: 12 },
  confirmBtn: { borderRadius: 0, overflow: 'hidden' },
  confirmGrad: { height: 52, justifyContent: 'center', alignItems: 'center' },
  confirmText: { fontFamily: MONO, fontSize: 14, color: C.fg, letterSpacing: 2 },
  qrPlaceholder: { alignSelf: 'center', width: 160, height: 160, backgroundColor: C.fg, padding: 10, borderRadius: 0, marginBottom: 18 },
  qrGrid: { flex: 1, flexDirection: 'row', flexWrap: 'wrap' },
  qrCell: { width: '12.5%', aspectRatio: 1 },
  qrCellFilled: { backgroundColor: C.bg },
  receiveLabel: { fontFamily: MONO, fontSize: 10, color: C.fgSecondary, letterSpacing: 2, textAlign: 'center', marginBottom: 8 },
  receiveAddrBox: { backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 0, padding: 12, marginBottom: 14 },
  receiveAddr: { fontFamily: MONO, fontSize: 12, color: C.fg, textAlign: 'center' },
  receiveActions: { flexDirection: 'row', justifyContent: 'center' },
  receiveBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.08)', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 0, marginHorizontal: 6 },
  receiveBtnText: { fontFamily: MONO, fontSize: 12, color: C.fg, marginLeft: 7 },
});
