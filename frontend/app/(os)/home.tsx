import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  ImageBackground, Dimensions, TextInput, Animated,
  PanResponder, Modal,
} from 'react-native';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import * as Battery from 'expo-battery';
import * as Network from 'expo-network';
import * as Location from 'expo-location';
import { C, MONO } from '@/src/theme';
import { useAuth } from '@/src/context/AuthContext';
import { useMusic } from '@/src/context/MusicContext';
import { useNotifications } from '@/src/context/NotificationsContext';
import { haptic } from '@/src/utils/haptics';
import { useSystemBridge } from '@/src/context/SystemBridgeContext';
import { SimBadge, BridgeStatusBar } from '@/src/components/GridOverlay';
import { MiniPlayer } from '@/src/components/MiniPlayer';
import { NotificationCenter } from '@/src/components/NotificationCenter';
import { InAppToast } from '@/src/components/InAppToast';

const { width: W, height: H } = Dimensions.get('window');
const ICON_SIZE = 52;

const apps = [
  { id: 'phone',      label: 'Phone',    icon: 'phone',          color: '#00FF41', route: '/(os)/phone' },
  { id: 'messages',   label: 'Messages', icon: 'message-square', color: '#FF4B00', route: '/(os)/messages' },
  { id: 'wallet',     label: 'Wallet',   icon: 'credit-card',    color: '#F59E0B', route: '/(os)/wallet' },
  { id: 'camera',     label: 'Camera',   icon: 'camera',         color: '#6366F1', route: '/(os)/camera' },
  { id: 'music',      label: 'Music',    icon: 'music',          color: '#EC4899', route: '/(os)/music' },
  { id: 'maps',       label: 'Maps',     icon: 'map-pin',        color: '#EF4444', route: '/(os)/maps' },
  { id: 'contacts',   label: 'Contacts', icon: 'users',          color: '#3B82F6', route: '/(os)/contacts' },
  { id: 'nodes',      label: 'Agent',    icon: 'cpu',            color: '#00FF41', route: '/(os)/nodes' },
  { id: 'browser',    label: 'Browser',  icon: 'globe',          color: '#06B6D4', route: '/(os)/browser' },
  { id: 'terminal',   label: 'Terminal', icon: 'terminal',       color: '#00FF41', route: '/(os)/terminal' },
  { id: 'calculator', label: 'Calc',     icon: 'hash',           color: '#8B5CF6', route: '/(os)/calculator' },
  { id: 'calendar',   label: 'Calendar', icon: 'calendar',       color: '#F59E0B', route: '/(os)/calendar' },
  { id: 'game',       label: 'Game',     icon: 'play',           color: '#EC4899', route: '/(os)/game' },
  { id: 'settings',   label: 'Settings', icon: 'settings',       color: '#A1A1AA', route: '/(os)/settings' },
];

function chunk(arr: any[], n: number) {
  const r = [];
  for (let i = 0; i < arr.length; i += n) r.push(arr.slice(i, i + n));
  return r;
}

export default function HomeScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { currentTrack } = useMusic();
  const { unreadCount } = useNotifications();

  const [time, setTime] = useState('');
  const [dateStr, setDateStr] = useState('');
  const [battery, setBattery] = useState(100);
  const [charging, setCharging] = useState(false);
  const [wifiConnected, setWifiConnected] = useState(true);
  const [showNotifCenter, setShowNotifCenter] = useState(false);
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [longPressApp, setLongPressApp] = useState<any>(null);
  const [weather, setWeather] = useState<{ temp: number; condition: string; icon: string } | null>(null);
  const [toast, setToast] = useState<any>(null);
  const [agentStability, setAgentStability] = useState<number>(1.42);
  const [agentStatus, setAgentStatus] = useState<string>('Idle');

  // Swipe down for notifications
  const swipeY = useRef(new Animated.Value(0)).current;
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => g.dy > 12 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderRelease: (_, g) => {
        if (g.dy > 50) {
          haptic.selection();
          setShowNotifCenter(true);
        }
      },
    })
  ).current;

  // Clock
  useEffect(() => {
    const update = () => {
      const now = new Date();
      setTime(now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }));
      setDateStr(now.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short' }));
    };
    update();
    const i = setInterval(update, 1000);
    return () => clearInterval(i);
  }, []);

  // Battery
  useEffect(() => {
    let sub: any;
    (async () => {
      try {
        const level = await Battery.getBatteryLevelAsync();
        setBattery(Math.round(level * 100));
        const state = await Battery.getBatteryStateAsync();
        setCharging(state === Battery.BatteryState.CHARGING || state === Battery.BatteryState.FULL);
        sub = Battery.addBatteryLevelListener(({ batteryLevel }) => setBattery(Math.round(batteryLevel * 100)));
      } catch {}
    })();
    return () => sub?.remove();
  }, []);

  // Agent status polling — live stability on home
  useEffect(() => {
    const poll = async () => {
      try {
        const d = await api.getAgentStatus();
        setAgentStability(d.stability_index);
        setAgentStatus(d.agent_status);
      } catch {}
    };
    poll();
    const i = setInterval(poll, 2000);
    return () => clearInterval(i);
  }, []);
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          setWeather({ temp: 18, condition: 'Clear', icon: 'sun' });
          return;
        }
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
        const { latitude, longitude } = loc.coords;
        const res = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true`
        );
        if (res.ok) {
          const data = await res.json();
          const wmo = data.current_weather?.weathercode ?? 0;
          const temp = Math.round(data.current_weather?.temperature ?? 18);
          const condition = wmo <= 1 ? 'Clear' : wmo <= 3 ? 'Cloudy' : wmo <= 67 ? 'Rain' : 'Snow';
          const icon = wmo <= 1 ? 'sun' : wmo <= 3 ? 'cloud' : wmo <= 67 ? 'cloud-rain' : 'cloud-snow';
          setWeather({ temp, condition, icon });
        }
      } catch {
        setWeather({ temp: 18, condition: 'Clear', icon: 'sun' });
      }
    })();
  }, []);

  // Demo toast after 3s
  useEffect(() => {
    const t = setTimeout(() => {
      setToast({
        app: 'Messages',
        appIcon: 'message-square',
        appColor: '#FF4B00',
        title: 'Alex Carter',
        body: 'Yeah, running great. Block height 849k+',
      });
    }, 3000);
    return () => clearTimeout(t);
  }, []);

  const batteryColor = battery > 20 ? C.success : '#EF4444';
  const rows = chunk(apps, 4);

  // Search results
  const searchResults = searchQuery.length > 0
    ? apps.filter(a => a.label.toLowerCase().includes(searchQuery.toLowerCase()))
    : [];

  const handleAppPress = (app: any) => {
    haptic.tap();
    app.route && router.push(app.route as any);
  };

  const handleAppLongPress = (app: any) => {
    haptic.medium();
    setLongPressApp(app);
  };

  return (
    <ImageBackground source={require('../../assets/wallpaper.png')} style={s.bg} resizeMode="cover">
      <LinearGradient colors={['rgba(5,5,5,0.55)', 'rgba(5,5,5,0.82)', 'rgba(5,5,5,0.96)']} style={s.overlay}>
        <SafeAreaView style={s.container} testID="home-screen" {...panResponder.panHandlers}>

          {/* ── Status Bar ── */}
          <View style={s.statusBar}>
            <Text style={s.statusTime}>{time}</Text>
            <TouchableOpacity style={s.statusCenter} onPress={() => { haptic.tap(); setShowNotifCenter(true); }}>
              <View style={s.brandDot} />
              <Text style={s.statusBrand}>IONA</Text>
            </TouchableOpacity>
            <View style={s.statusRight}>
              {unreadCount > 0 && (
                <TouchableOpacity onPress={() => { haptic.tap(); setShowNotifCenter(true); }}>
                  <View style={s.notifBadge}>
                    <Text style={s.notifText}>{unreadCount}</Text>
                  </View>
                </TouchableOpacity>
              )}
              <Feather name={wifiConnected ? 'wifi' : 'wifi-off'} size={13} color={wifiConnected ? C.fg : C.fgSecondary} style={{ marginLeft: 5 }} />
              <View style={s.batteryWrap}>
                <View style={[s.batteryFill, { width: `${battery}%` as any, backgroundColor: batteryColor }]} />
              </View>
              {charging && <Feather name="zap" size={10} color={C.success} style={{ marginLeft: 2 }} />}
              <Text style={[s.batteryPct, { color: batteryColor }]}>{battery}%</Text>
            </View>
          </View>

          {/* ── Greeting ── */}
          <View style={s.header}>
            <Text style={s.dateText}>{dateStr}</Text>
            <View style={s.greetRow}>
              <Text style={s.greeting}>Hello, {user?.username || 'User'}</Text>
              <TouchableOpacity style={s.searchTrigger} onPress={() => { haptic.tap(); setSearchVisible(true); }}>
                <Feather name="search" size={18} color={C.fgSecondary} />
              </TouchableOpacity>
            </View>
          </View>

          {/* ── Quick Stats + Weather ── */}
          <View style={s.statsRow}>
            <View style={s.statCard}>
              <LinearGradient colors={['rgba(255,75,0,0.14)', 'rgba(255,75,0,0.02)']} style={s.statGrad}>
                <Feather name="credit-card" size={14} color={C.accent} />
                <Text style={s.statValue}>{(user?.wallet_balance || 0).toLocaleString()}</Text>
                <Text style={s.statLabel}>IONA</Text>
              </LinearGradient>
            </View>
            <View style={s.statCard}>
              <LinearGradient colors={['rgba(0,255,65,0.12)', 'rgba(0,255,65,0.02)']} style={s.statGrad}>
                <Feather name="cpu" size={14} color={
                  Math.abs(agentStability - 1.42) < 0.05 ? C.success : '#F59E0B'
                } />
                <Text style={s.statValue}>{agentStability.toFixed(3)}</Text>
                <Text style={s.statLabel}>ΨSTAB</Text>
              </LinearGradient>
            </View>
            {weather ? (
              <View style={s.statCard}>
                <LinearGradient colors={['rgba(6,182,212,0.12)', 'rgba(6,182,212,0.02)']} style={s.statGrad}>
                  <Feather name={weather.icon as any} size={14} color="#06B6D4" />
                  <Text style={s.statValue}>{weather.temp}°</Text>
                  <Text style={s.statLabel}>{weather.condition.toUpperCase()}</Text>
                </LinearGradient>
              </View>
            ) : (
              <View style={s.statCard}>
                <LinearGradient colors={['rgba(99,102,241,0.12)', 'rgba(99,102,241,0.02)']} style={s.statGrad}>
                  <Feather name="shield" size={14} color="#6366F1" />
                  <Text style={s.statValue}>PQ</Text>
                  <Text style={s.statLabel}>SECURE</Text>
                </LinearGradient>
              </View>
            )}
          </View>

          {/* ── App Grid ── */}
          <ScrollView style={s.gridScroll} showsVerticalScrollIndicator={false}>
            {rows.map((row, ri) => (
              <View key={ri} style={s.gridRow}>
                {row.map((app: any) => (
                  <TouchableOpacity
                    key={app.id}
                    testID={`app-${app.id}`}
                    style={s.appItem}
                    onPress={() => handleAppPress(app)}
                    onLongPress={() => handleAppLongPress(app)}
                    delayLongPress={400}
                    activeOpacity={0.65}
                  >
                    <LinearGradient
                      colors={[`${app.color}1A`, `${app.color}06`]}
                      style={[s.appIcon, { borderColor: `${app.color}45` }]}
                    >
                      <Feather name={app.icon as any} size={22} color={app.color} />
                    </LinearGradient>
                    <Text style={s.appLabel}>{app.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ))}
            <View style={{ height: currentTrack ? 80 : 20 }} />
          </ScrollView>

          {/* ── Blur Dock ── */}
          <View style={s.dock}>
            <BlurView intensity={60} tint="dark" style={s.dockBlur}>
              <View style={s.dockInner}>
                {[
                  { id: 'phone',    icon: 'phone',         color: C.success,    route: '/(os)/phone' },
                  { id: 'messages', icon: 'message-square', color: C.accent,    route: '/(os)/messages' },
                  { id: 'camera',   icon: 'camera',        color: '#6366F1',    route: '/(os)/camera' },
                  { id: 'music',    icon: 'music',         color: '#EC4899',    route: '/(os)/music' },
                  { id: 'settings', icon: 'settings',      color: C.fgSecondary, route: '/(os)/settings' },
                ].map(item => (
                  <TouchableOpacity
                    key={item.id}
                    testID={`dock-${item.id}`}
                    style={s.dockItem}
                    onPress={() => { haptic.tap(); router.push(item.route as any); }}
                    activeOpacity={0.6}
                  >
                    <Feather name={item.icon as any} size={22} color={item.color} />
                    {item.id === 'messages' && unreadCount > 0 && <View style={s.dockBadge} />}
                  </TouchableOpacity>
                ))}
              </View>
            </BlurView>
          </View>

        </SafeAreaView>

        {/* ── Mini Music Player ── */}
        <MiniPlayer />

        {/* ── Notification Center ── */}
        <NotificationCenter
          visible={showNotifCenter}
          onClose={() => setShowNotifCenter(false)}
        />

        {/* ── In-App Toast ── */}
        {toast && (
          <InAppToast
            visible={!!toast}
            app={toast.app}
            appIcon={toast.appIcon}
            appColor={toast.appColor}
            title={toast.title}
            body={toast.body}
            onPress={() => { router.push('/(os)/messages'); }}
            onDismiss={() => setToast(null)}
          />
        )}

        {/* ── Search Modal ── */}
        <Modal visible={searchVisible} transparent animationType="fade" onRequestClose={() => setSearchVisible(false)}>
          <BlurView intensity={80} tint="dark" style={s.searchOverlay}>
            <SafeAreaView style={s.searchContainer}>
              <View style={s.searchBar}>
                <Feather name="search" size={18} color={C.fgSecondary} style={{ marginRight: 10 }} />
                <TextInput
                  style={s.searchInput}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholder="Search apps, contacts..."
                  placeholderTextColor={C.fgSecondary}
                  autoFocus
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <TouchableOpacity onPress={() => { haptic.tap(); setSearchVisible(false); setSearchQuery(''); }}>
                  <Text style={s.searchCancel}>Cancel</Text>
                </TouchableOpacity>
              </View>

              {searchQuery.length > 0 && (
                <View style={s.searchResults}>
                  {searchResults.length === 0 ? (
                    <Text style={s.searchEmpty}>No results for "{searchQuery}"</Text>
                  ) : (
                    searchResults.map(app => (
                      <TouchableOpacity
                        key={app.id}
                        style={s.searchResultItem}
                        onPress={() => {
                          haptic.tap();
                          setSearchVisible(false);
                          setSearchQuery('');
                          router.push(app.route as any);
                        }}
                      >
                        <View style={[s.searchResultIcon, { backgroundColor: `${app.color}18` }]}>
                          <Feather name={app.icon as any} size={20} color={app.color} />
                        </View>
                        <Text style={s.searchResultLabel}>{app.label}</Text>
                        <Feather name="chevron-right" size={16} color={C.fgSecondary} />
                      </TouchableOpacity>
                    ))
                  )}
                </View>
              )}

              {!searchQuery && (
                <View style={s.searchSuggestions}>
                  <Text style={s.suggestTitle}>RECENT</Text>
                  {apps.slice(0, 5).map(app => (
                    <TouchableOpacity
                      key={app.id}
                      style={s.searchResultItem}
                      onPress={() => {
                        haptic.tap();
                        setSearchVisible(false);
                        router.push(app.route as any);
                      }}
                    >
                      <View style={[s.searchResultIcon, { backgroundColor: `${app.color}18` }]}>
                        <Feather name={app.icon as any} size={20} color={app.color} />
                      </View>
                      <Text style={s.searchResultLabel}>{app.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </SafeAreaView>
          </BlurView>
        </Modal>

        {/* ── Long Press Context Menu ── */}
        {longPressApp && (
          <Modal visible transparent animationType="fade" onRequestClose={() => setLongPressApp(null)}>
            <TouchableOpacity style={s.ctxOverlay} activeOpacity={1} onPress={() => { haptic.tap(); setLongPressApp(null); }}>
              <BlurView intensity={60} tint="dark" style={s.ctxMenu}>
                <View style={s.ctxHeader}>
                  <View style={[s.ctxIcon, { backgroundColor: `${longPressApp.color}18` }]}>
                    <Feather name={longPressApp.icon} size={24} color={longPressApp.color} />
                  </View>
                  <Text style={s.ctxTitle}>{longPressApp.label}</Text>
                </View>
                {[
                  { icon: 'external-link', label: 'Open', action: () => { router.push(longPressApp.route as any); } },
                  { icon: 'info', label: 'App Info', action: () => {} },
                  { icon: 'star', label: 'Add to Favourites', action: () => {} },
                ].map((item, i) => (
                  <TouchableOpacity
                    key={i}
                    style={s.ctxItem}
                    onPress={() => { haptic.tap(); setLongPressApp(null); item.action(); }}
                  >
                    <Feather name={item.icon as any} size={18} color={C.fg} />
                    <Text style={s.ctxItemText}>{item.label}</Text>
                  </TouchableOpacity>
                ))}
              </BlurView>
            </TouchableOpacity>
          </Modal>
        )}

      </LinearGradient>
    </ImageBackground>
  );
}

const s = StyleSheet.create({
  bg: { flex: 1 },
  overlay: { flex: 1 },
  container: { flex: 1 },
  // Status bar
  statusBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 6 },
  statusTime: { fontFamily: MONO, fontSize: 12, color: C.fg, width: 44 },
  statusCenter: { flexDirection: 'row', alignItems: 'center' },
  brandDot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: C.accent, marginRight: 5 },
  statusBrand: { fontFamily: MONO, fontSize: 10, color: C.accent, letterSpacing: 3 },
  statusRight: { flexDirection: 'row', alignItems: 'center' },
  notifBadge: { width: 17, height: 17, borderRadius: 0.5, backgroundColor: C.accent, justifyContent: 'center', alignItems: 'center', marginRight: 4 },
  notifText: { fontFamily: MONO, fontSize: 9, color: C.fg, fontWeight: '700' },
  batteryWrap: { width: 22, height: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)', borderRadius: 2, overflow: 'hidden', marginLeft: 6 },
  batteryFill: { height: '100%', borderRadius: 2 },
  batteryPct: { fontFamily: MONO, fontSize: 9, marginLeft: 3 },
  // Header
  header: { paddingHorizontal: 16, paddingTop: 2, paddingBottom: 8 },
  dateText: { fontFamily: MONO, fontSize: 11, color: C.fgSecondary, letterSpacing: 2, textTransform: 'uppercase' },
  greetRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  greeting: { fontSize: 26, fontWeight: '800', color: C.fg, marginTop: 2 },
  searchTrigger: { width: 38, height: 38, borderRadius: 0, backgroundColor: 'rgba(255,255,255,0.08)', justifyContent: 'center', alignItems: 'center' },
  // Stats
  statsRow: { flexDirection: 'row', paddingHorizontal: 14, marginBottom: 10 },
  statCard: { flex: 1, marginHorizontal: 3, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', borderRadius: 0, overflow: 'hidden' },
  statGrad: { padding: 10, alignItems: 'flex-start' },
  statValue: { fontFamily: MONO, fontSize: 16, color: C.fg, fontWeight: '600', marginTop: 3 },
  statLabel: { fontFamily: MONO, fontSize: 8, color: C.fgSecondary, letterSpacing: 2, marginTop: 1 },
  // Grid
  gridScroll: { flex: 1 },
  gridRow: { flexDirection: 'row', justifyContent: 'space-evenly', marginBottom: 14 },
  appItem: { width: 72, alignItems: 'center' },
  appIcon: { width: ICON_SIZE, height: ICON_SIZE, borderWidth: 1, borderRadius: 0, justifyContent: 'center', alignItems: 'center' },
  appLabel: { fontFamily: MONO, fontSize: 9, color: C.fgSecondary, marginTop: 5, letterSpacing: 0.5, textAlign: 'center' },
  // Dock with blur
  dock: { paddingHorizontal: 14, paddingBottom: 6 },
  dockBlur: { borderRadius: 0, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  dockInner: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 12 },
  dockItem: { width: 52, height: 52, justifyContent: 'center', alignItems: 'center' },
  dockBadge: { position: 'absolute', top: 9, right: 9, width: 7, height: 7, borderRadius: 2.5, backgroundColor: C.accent },
  // Search
  searchOverlay: { flex: 1 },
  searchContainer: { flex: 1, paddingHorizontal: 16, paddingTop: 12 },
  searchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 0, paddingHorizontal: 14, height: 48, marginBottom: 16 },
  searchInput: { flex: 1, fontFamily: MONO, fontSize: 15, color: C.fg },
  searchCancel: { fontFamily: MONO, fontSize: 13, color: C.accent, marginLeft: 8 },
  searchResults: { backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 0, overflow: 'hidden' },
  searchResultItem: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  searchResultIcon: { width: 36, height: 36, borderRadius: 0, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  searchResultLabel: { flex: 1, fontSize: 16, color: C.fg, fontWeight: '500' },
  searchEmpty: { fontFamily: MONO, fontSize: 13, color: C.fgSecondary, textAlign: 'center', padding: 30 },
  searchSuggestions: { backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 0, overflow: 'hidden' },
  suggestTitle: { fontFamily: MONO, fontSize: 10, color: C.fgSecondary, letterSpacing: 2, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6 },
  // Context menu
  ctxOverlay: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.6)' },
  ctxMenu: { width: 240, borderRadius: 0, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  ctxHeader: { flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)' },
  ctxIcon: { width: 40, height: 40, borderRadius: 0, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  ctxTitle: { fontSize: 17, fontWeight: '700', color: C.fg },
  ctxItem: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  ctxItemText: { fontSize: 15, color: C.fg, marginLeft: 12 },
});
