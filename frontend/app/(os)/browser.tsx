import React, { useState, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, TextInput, ScrollView, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { C, MONO } from '@/src/theme';

type PageData = {
  title: string;
  url: string;
  content: React.ReactNode;
};

const BOOKMARKS = [
  { title: 'IONA Chain', url: 'iona://chain', icon: 'box', color: C.accent },
  { title: 'Wallet', url: 'iona://wallet', icon: 'credit-card', color: '#F59E0B' },
  { title: 'Explorer', url: 'iona://explorer', icon: 'search', color: C.success },
  { title: 'Dev Docs', url: 'iona://docs', icon: 'book', color: C.blue },
  { title: 'News', url: 'iona://news', icon: 'rss', color: '#EC4899' },
  { title: 'Community', url: 'iona://community', icon: 'users', color: '#8B5CF6' },
];

function PageHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <View style={s.pageHeader}>
      <Text style={s.pageTitle}>{title}</Text>
      <Text style={s.pageSubtitle}>{subtitle}</Text>
    </View>
  );
}

function InfoCard({ icon, label, value, color }: { icon: string; label: string; value: string; color: string }) {
  return (
    <View style={s.infoCard}>
      <Feather name={icon as any} size={18} color={color} />
      <Text style={s.infoLabel}>{label}</Text>
      <Text style={s.infoValue}>{value}</Text>
    </View>
  );
}

function buildPage(url: string): PageData | null {
  const clean = url.toLowerCase().trim();

  if (clean === 'iona://chain' || clean === '' || clean === 'iona://home') {
    return {
      title: 'IONA Blockchain',
      url: 'iona://chain',
      content: (
        <View>
          <PageHeader title="IONA Blockchain" subtitle="Decentralized Mobile-First Network" />
          <LinearGradient colors={['rgba(255,75,0,0.1)', 'rgba(255,75,0,0.02)']} style={s.heroCard}>
            <Text style={s.heroTitle}>Welcome to IONA</Text>
            <Text style={s.heroDesc}>
              A next-generation mobile blockchain built on bare-metal Rust kernel with Tendermint BFT consensus.
            </Text>
          </LinearGradient>
          <View style={s.statsGrid}>
            <InfoCard icon="box" label="Block Height" value="#849,002" color={C.accent} />
            <InfoCard icon="server" label="Validators" value="4 Active" color={C.success} />
            <InfoCard icon="activity" label="TPS" value="1,200" color={C.blue} />
            <InfoCard icon="clock" label="Finality" value="< 1s" color="#F59E0B" />
          </View>
          <Text style={s.sectionLabel}>FEATURES</Text>
          {['Tendermint BFT Consensus', 'IonaFS Journaled Filesystem', 'Bare-metal Rust Kernel', 'Sub-second Finality'].map((f, i) => (
            <View key={i} style={s.featureRow}>
              <View style={s.featureDot} />
              <Text style={s.featureText}>{f}</Text>
            </View>
          ))}
        </View>
      ),
    };
  }

  if (clean === 'iona://wallet') {
    return {
      title: 'IONA Wallet Web',
      url: 'iona://wallet',
      content: (
        <View>
          <PageHeader title="IONA Wallet" subtitle="Manage your tokens securely" />
          <LinearGradient colors={['rgba(245,158,11,0.1)', 'rgba(245,158,11,0.02)']} style={s.heroCard}>
            <Feather name="credit-card" size={32} color="#F59E0B" />
            <Text style={[s.heroTitle, { marginTop: 8 }]}>Your Balance</Text>
            <Text style={s.walletBalance}>12,404.50 IONA</Text>
          </LinearGradient>
          <Text style={s.sectionLabel}>RECENT ACTIVITY</Text>
          {[
            { type: 'Received', amount: '+500.00', time: '2 days ago', color: C.success },
            { type: 'Sent', amount: '-100.00', time: '3 days ago', color: C.accent },
            { type: 'Staking Reward', amount: '+4.50', time: '5 days ago', color: C.blue },
          ].map((tx, i) => (
            <View key={i} style={s.txRow}>
              <Text style={s.txType}>{tx.type}</Text>
              <View style={s.txRight}>
                <Text style={[s.txAmount, { color: tx.color }]}>{tx.amount}</Text>
                <Text style={s.txTime}>{tx.time}</Text>
              </View>
            </View>
          ))}
        </View>
      ),
    };
  }

  if (clean === 'iona://explorer') {
    return {
      title: 'Block Explorer',
      url: 'iona://explorer',
      content: (
        <View>
          <PageHeader title="Block Explorer" subtitle="Browse blocks and transactions" />
          <Text style={s.sectionLabel}>LATEST BLOCKS</Text>
          {[849002, 849001, 849000, 848999, 848998].map((h) => (
            <View key={h} style={s.blockRow}>
              <View style={s.blockIcon}>
                <Feather name="box" size={16} color={C.accent} />
              </View>
              <View style={s.blockInfo}>
                <Text style={s.blockHeight}>Block #{h.toLocaleString()}</Text>
                <Text style={s.blockMeta}>{Math.floor(Math.random() * 20 + 5)} txns · {(Math.random() * 0.5 + 0.1).toFixed(2)}s ago</Text>
              </View>
              <Text style={s.blockSize}>{(Math.random() * 500 + 100).toFixed(0)} KB</Text>
            </View>
          ))}
        </View>
      ),
    };
  }

  if (clean === 'iona://docs') {
    return {
      title: 'Developer Docs',
      url: 'iona://docs',
      content: (
        <View>
          <PageHeader title="IONA Dev Docs" subtitle="Build on the IONA platform" />
          <Text style={s.sectionLabel}>GETTING STARTED</Text>
          {[
            { title: 'Introduction to IONA OS', desc: 'Overview of the mobile blockchain OS' },
            { title: 'Kernel Architecture', desc: 'Bare-metal Rust kernel internals' },
            { title: 'Smart Contracts', desc: 'Write and deploy IONA contracts' },
            { title: 'Wallet SDK', desc: 'Integrate IONA payments' },
            { title: 'Node Setup', desc: 'Run your own validator node' },
            { title: 'API Reference', desc: 'REST & WebSocket endpoints' },
          ].map((doc, i) => (
            <TouchableOpacity key={i} style={s.docRow} activeOpacity={0.6}>
              <View style={s.docIcon}>
                <Feather name="file-text" size={16} color={C.blue} />
              </View>
              <View style={s.docInfo}>
                <Text style={s.docTitle}>{doc.title}</Text>
                <Text style={s.docDesc}>{doc.desc}</Text>
              </View>
              <Feather name="chevron-right" size={16} color={C.fgSecondary} />
            </TouchableOpacity>
          ))}
        </View>
      ),
    };
  }

  if (clean === 'iona://news') {
    return {
      title: 'IONA News',
      url: 'iona://news',
      content: (
        <View>
          <PageHeader title="IONA News" subtitle="Latest from the ecosystem" />
          {[
            { title: 'IONA OS v0.6.0 Released', date: 'Jun 15, 2025', tag: 'Release' },
            { title: 'Tendermint BFT Integration Complete', date: 'Jun 10, 2025', tag: 'Tech' },
            { title: 'Validator Program Launches', date: 'Jun 5, 2025', tag: 'Network' },
            { title: 'IonaFS: A New Filesystem for Mobile', date: 'May 28, 2025', tag: 'Research' },
          ].map((news, i) => (
            <TouchableOpacity key={i} style={s.newsRow} activeOpacity={0.6}>
              <View style={s.newsTag}>
                <Text style={s.newsTagText}>{news.tag}</Text>
              </View>
              <Text style={s.newsTitle}>{news.title}</Text>
              <Text style={s.newsDate}>{news.date}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ),
    };
  }

  if (clean === 'iona://community') {
    return {
      title: 'Community',
      url: 'iona://community',
      content: (
        <View>
          <PageHeader title="IONA Community" subtitle="Connect with builders" />
          <View style={s.statsGrid}>
            <InfoCard icon="users" label="Members" value="12,847" color="#8B5CF6" />
            <InfoCard icon="message-square" label="Posts" value="4,291" color={C.accent} />
            <InfoCard icon="git-branch" label="Repos" value="186" color={C.success} />
            <InfoCard icon="award" label="Validators" value="42" color="#F59E0B" />
          </View>
          <Text style={s.sectionLabel}>CHANNELS</Text>
          {['General', 'Development', 'Validators', 'Trading', 'Support'].map((ch, i) => (
            <TouchableOpacity key={i} style={s.channelRow} activeOpacity={0.6}>
              <Text style={s.channelHash}>#</Text>
              <Text style={s.channelName}>{ch.toLowerCase()}</Text>
              <View style={s.channelOnline}>
                <View style={s.onlineDot} />
                <Text style={s.onlineText}>{Math.floor(Math.random() * 200 + 20)}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      ),
    };
  }

  // 404 page
  return {
    title: 'Not Found',
    url: url,
    content: (
      <View style={s.errorPage}>
        <Feather name="alert-circle" size={48} color={C.error} />
        <Text style={s.errorTitle}>Page Not Found</Text>
        <Text style={s.errorDesc}>The URL "{url}" could not be resolved on the IONA network.</Text>
        <Text style={s.errorHint}>Try: iona://chain, iona://wallet, iona://explorer</Text>
      </View>
    ),
  };
}

export default function BrowserScreen() {
  const router = useRouter();
  const [url, setUrl] = useState('iona://chain');
  const [urlInput, setUrlInput] = useState('iona://chain');
  const [loading, setLoading] = useState(false);
  const [historyStack, setHistoryStack] = useState<string[]>(['iona://chain']);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [showBookmarks, setShowBookmarks] = useState(false);

  const page = buildPage(url);

  const navigate = (newUrl: string) => {
    setLoading(true);
    const cleanUrl = newUrl.trim();
    setUrlInput(cleanUrl);
    setTimeout(() => {
      setUrl(cleanUrl);
      const newStack = [...historyStack.slice(0, historyIndex + 1), cleanUrl];
      setHistoryStack(newStack);
      setHistoryIndex(newStack.length - 1);
      setLoading(false);
    }, 300);
  };

  const goBack = () => {
    if (historyIndex > 0) {
      const idx = historyIndex - 1;
      setHistoryIndex(idx);
      const prevUrl = historyStack[idx];
      setUrl(prevUrl);
      setUrlInput(prevUrl);
    }
  };

  const goForward = () => {
    if (historyIndex < historyStack.length - 1) {
      const idx = historyIndex + 1;
      setHistoryIndex(idx);
      const nextUrl = historyStack[idx];
      setUrl(nextUrl);
      setUrlInput(nextUrl);
    }
  };

  const refresh = () => {
    setLoading(true);
    setTimeout(() => setLoading(false), 400);
  };

  return (
    <SafeAreaView style={s.container} testID="browser-screen">
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity testID="browser-back-nav" onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color={C.fgSecondary} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Browser</Text>
        <TouchableOpacity testID="browser-bookmarks-btn" onPress={() => setShowBookmarks(!showBookmarks)}>
          <Feather name={showBookmarks ? 'x' : 'bookmark'} size={20} color={C.fgSecondary} />
        </TouchableOpacity>
      </View>

      {/* URL Bar */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={s.urlBar}>
          <TouchableOpacity onPress={goBack} disabled={historyIndex <= 0} style={s.navBtn}>
            <Feather name="chevron-left" size={20} color={historyIndex > 0 ? C.fg : C.fgSecondary} />
          </TouchableOpacity>
          <TouchableOpacity onPress={goForward} disabled={historyIndex >= historyStack.length - 1} style={s.navBtn}>
            <Feather name="chevron-right" size={20} color={historyIndex < historyStack.length - 1 ? C.fg : C.fgSecondary} />
          </TouchableOpacity>
          <View style={s.urlInputWrap}>
            <Feather name="lock" size={12} color={C.success} style={{ marginRight: 6 }} />
            <TextInput
              testID="browser-url-input"
              style={s.urlInput}
              value={urlInput}
              onChangeText={setUrlInput}
              placeholder="Enter URL..."
              placeholderTextColor={C.fgSecondary}
              returnKeyType="go"
              onSubmitEditing={() => navigate(urlInput)}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {loading && <ActivityIndicator size="small" color={C.accent} />}
          </View>
          <TouchableOpacity onPress={refresh} style={s.navBtn}>
            <Feather name="refresh-cw" size={18} color={C.fgSecondary} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* Bookmarks Panel */}
      {showBookmarks && (
        <View style={s.bookmarksPanel}>
          <Text style={s.bookmarksTitle}>BOOKMARKS</Text>
          <View style={s.bookmarksGrid}>
            {BOOKMARKS.map((bm, i) => (
              <TouchableOpacity key={i} style={s.bookmarkItem}
                onPress={() => { navigate(bm.url); setShowBookmarks(false); }} activeOpacity={0.6}>
                <View style={[s.bookmarkIcon, { borderColor: `${bm.color}40` }]}>
                  <Feather name={bm.icon as any} size={18} color={bm.color} />
                </View>
                <Text style={s.bookmarkLabel} numberOfLines={1}>{bm.title}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {/* Page Content */}
      <ScrollView style={s.content} contentContainerStyle={s.contentInner} showsVerticalScrollIndicator={false}>
        {loading ? (
          <View style={s.loadingPage}>
            <ActivityIndicator size="large" color={C.accent} />
            <Text style={s.loadingText}>Loading...</Text>
          </View>
        ) : (
          page?.content
        )}
        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Tab Bar */}
      <View style={s.tabBar}>
        <TouchableOpacity style={s.tabBtn} onPress={() => navigate('iona://chain')}>
          <Feather name="home" size={18} color={url === 'iona://chain' ? C.accent : C.fgSecondary} />
        </TouchableOpacity>
        <TouchableOpacity style={s.tabBtn} onPress={() => setShowBookmarks(!showBookmarks)}>
          <Feather name="grid" size={18} color={showBookmarks ? C.accent : C.fgSecondary} />
        </TouchableOpacity>
        <View style={s.tabCount}>
          <Text style={s.tabCountText}>1</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10 },
  headerTitle: { fontSize: 16, fontWeight: '700', color: C.fg },
  urlBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingBottom: 8 },
  navBtn: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center' },
  urlInputWrap: { flex: 1, flexDirection: 'row', alignItems: 'center', height: 38, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 0, paddingHorizontal: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  urlInput: { flex: 1, fontFamily: MONO, fontSize: 12, color: C.fg, height: 38 },
  content: { flex: 1 },
  contentInner: { padding: 16 },
  bookmarksPanel: { backgroundColor: C.surface, padding: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' },
  bookmarksTitle: { fontFamily: MONO, fontSize: 10, color: C.fgSecondary, letterSpacing: 3, marginBottom: 12 },
  bookmarksGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  bookmarkItem: { width: '33.33%', alignItems: 'center', marginBottom: 16 },
  bookmarkIcon: { width: 44, height: 44, borderRadius: 0, borderWidth: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.03)', marginBottom: 4 },
  bookmarkLabel: { fontFamily: MONO, fontSize: 10, color: C.fgSecondary },
  tabBar: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', paddingVertical: 8, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)' },
  tabBtn: { width: 48, height: 36, justifyContent: 'center', alignItems: 'center', marginHorizontal: 16 },
  tabCount: { width: 24, height: 24, borderRadius: 0, borderWidth: 1.5, borderColor: C.fgSecondary, justifyContent: 'center', alignItems: 'center', marginHorizontal: 16 },
  tabCountText: { fontFamily: MONO, fontSize: 11, color: C.fgSecondary, fontWeight: '700' },
  // Page styles
  pageHeader: { marginBottom: 16 },
  pageTitle: { fontSize: 22, fontWeight: '800', color: C.fg },
  pageSubtitle: { fontFamily: MONO, fontSize: 12, color: C.fgSecondary, marginTop: 2, letterSpacing: 1 },
  heroCard: { borderRadius: 0, padding: 20, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', marginBottom: 16 },
  heroTitle: { fontSize: 18, fontWeight: '700', color: C.fg },
  heroDesc: { fontFamily: MONO, fontSize: 12, color: C.fgSecondary, lineHeight: 18, marginTop: 6 },
  walletBalance: { fontFamily: MONO, fontSize: 28, color: '#F59E0B', fontWeight: '200', marginTop: 4 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 16 },
  infoCard: { width: '48%', backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 0, padding: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', marginBottom: 8, marginRight: '2%' },
  infoLabel: { fontFamily: MONO, fontSize: 9, color: C.fgSecondary, letterSpacing: 1, marginTop: 6 },
  infoValue: { fontFamily: MONO, fontSize: 16, color: C.fg, fontWeight: '600', marginTop: 2 },
  sectionLabel: { fontFamily: MONO, fontSize: 10, color: C.fgSecondary, letterSpacing: 3, marginBottom: 10, marginTop: 8 },
  featureRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  featureDot: { width: 6, height: 6, borderRadius: 2, backgroundColor: C.accent, marginRight: 10 },
  featureText: { fontFamily: MONO, fontSize: 13, color: C.fg },
  txRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.04)' },
  txType: { fontFamily: MONO, fontSize: 13, color: C.fg },
  txRight: { alignItems: 'flex-end' },
  txAmount: { fontFamily: MONO, fontSize: 14, fontWeight: '600' },
  txTime: { fontFamily: MONO, fontSize: 10, color: C.fgSecondary, marginTop: 2 },
  blockRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.04)' },
  blockIcon: { width: 34, height: 34, borderRadius: 0, backgroundColor: 'rgba(255,75,0,0.1)', justifyContent: 'center', alignItems: 'center', marginRight: 10 },
  blockInfo: { flex: 1 },
  blockHeight: { fontFamily: MONO, fontSize: 13, color: C.fg },
  blockMeta: { fontFamily: MONO, fontSize: 10, color: C.fgSecondary, marginTop: 1 },
  blockSize: { fontFamily: MONO, fontSize: 11, color: C.fgSecondary },
  docRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.04)' },
  docIcon: { width: 34, height: 34, borderRadius: 0, backgroundColor: 'rgba(59,130,246,0.1)', justifyContent: 'center', alignItems: 'center', marginRight: 10 },
  docInfo: { flex: 1 },
  docTitle: { fontSize: 14, color: C.fg, fontWeight: '600' },
  docDesc: { fontFamily: MONO, fontSize: 11, color: C.fgSecondary, marginTop: 1 },
  newsRow: { padding: 14, backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 0, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', marginBottom: 10 },
  newsTag: { backgroundColor: 'rgba(255,75,0,0.12)', borderRadius: 0, paddingHorizontal: 8, paddingVertical: 2, alignSelf: 'flex-start', marginBottom: 6 },
  newsTagText: { fontFamily: MONO, fontSize: 9, color: C.accent, letterSpacing: 1 },
  newsTitle: { fontSize: 15, fontWeight: '600', color: C.fg },
  newsDate: { fontFamily: MONO, fontSize: 11, color: C.fgSecondary, marginTop: 4 },
  channelRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.04)' },
  channelHash: { fontFamily: MONO, fontSize: 16, color: C.fgSecondary, width: 24 },
  channelName: { fontFamily: MONO, fontSize: 14, color: C.fg, flex: 1 },
  channelOnline: { flexDirection: 'row', alignItems: 'center' },
  onlineDot: { width: 6, height: 6, borderRadius: 2, backgroundColor: C.success, marginRight: 4 },
  onlineText: { fontFamily: MONO, fontSize: 11, color: C.fgSecondary },
  errorPage: { alignItems: 'center', paddingTop: 60 },
  errorTitle: { fontSize: 22, fontWeight: '700', color: C.fg, marginTop: 16 },
  errorDesc: { fontFamily: MONO, fontSize: 12, color: C.fgSecondary, textAlign: 'center', marginTop: 8, lineHeight: 18 },
  errorHint: { fontFamily: MONO, fontSize: 11, color: C.accent, marginTop: 16 },
  loadingPage: { alignItems: 'center', paddingTop: 80 },
  loadingText: { fontFamily: MONO, fontSize: 12, color: C.fgSecondary, marginTop: 12 },
});
