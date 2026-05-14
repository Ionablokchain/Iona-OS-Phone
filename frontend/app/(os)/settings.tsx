import React, { useState, useEffect } from 'react';
import { haptic } from '@/src/utils/haptics';
import { View, Text, TouchableOpacity, StyleSheet, Switch, ScrollView, Animated } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { C, MONO } from '@/src/theme';
import { api } from '@/src/utils/api';
import { useAuth } from '@/src/context/AuthContext';

function SettingToggle({ testID, icon, iconColor, label, desc, value, onToggle, trackOn }: any) {
  return (
    <View style={s.settingRow}>
      <View style={s.settingLeft}>
        <View style={[s.settingIcon, { borderColor: `${iconColor}40` }]}>
          <Feather name={icon} size={18} color={value ? iconColor : C.fgSecondary} />
        </View>
        <View>
          <Text style={s.settingLabel}>{label}</Text>
          {desc ? <Text style={s.settingDesc}>{desc}</Text> : null}
        </View>
      </View>
      <Switch testID={testID} value={value} onValueChange={onToggle}
        trackColor={{ true: trackOn || C.success, false: 'rgba(255,255,255,0.1)' }}
        thumbColor={C.fg} />
    </View>
  );
}

function SettingNav({ testID, icon, iconColor, label, desc, value, onPress }: any) {
  return (
    <TouchableOpacity testID={testID} style={s.settingRow} onPress={onPress} activeOpacity={0.6}>
      <View style={s.settingLeft}>
        <View style={[s.settingIcon, { borderColor: `${iconColor}40` }]}>
          <Feather name={icon} size={18} color={iconColor} />
        </View>
        <View>
          <Text style={s.settingLabel}>{label}</Text>
          {desc ? <Text style={s.settingDesc}>{desc}</Text> : null}
        </View>
      </View>
      <View style={s.navRight}>
        {value ? <Text style={s.navValue}>{value}</Text> : null}
        <Feather name="chevron-right" size={18} color={C.fgSecondary} />
      </View>
    </TouchableOpacity>
  );
}

function SliderRow({ label, value, onInc, onDec, unit, color }: any) {
  return (
    <View style={s.sliderRow}>
      <Text style={s.sliderLabel}>{label}</Text>
      <View style={s.sliderControls}>
        <TouchableOpacity onPress={onDec} style={s.sliderBtn}><Text style={s.sliderBtnText}>−</Text></TouchableOpacity>
        <View style={s.sliderTrack}>
          <View style={[s.sliderFill, { width: `${value}%`, backgroundColor: color || C.accent }]} />
        </View>
        <TouchableOpacity onPress={onInc} style={s.sliderBtn}><Text style={s.sliderBtnText}>+</Text></TouchableOpacity>
        <Text style={s.sliderValue}>{value}{unit}</Text>
      </View>
    </View>
  );
}

export default function SettingsScreen() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const [settings, setSettings] = useState<any>({
    wifi_enabled: true, mobile_data: true, bluetooth: false,
    brightness: 80, volume: 70, notifications: true,
    do_not_disturb: false, auto_brightness: true, battery_saver: false, firewall: true,
  });

  useEffect(() => { api.getSettings().then(setSettings).catch(() => {}); }, []);

  const toggle = async (key: string) => {
    const updated = { ...settings, [key]: !settings[key] };
    setSettings(updated);
    api.updateSettings(updated).catch(() => {});
  };

  const adjustVal = (key: string, delta: number) => {
    const v = Math.max(0, Math.min(100, (settings[key] || 0) + delta));
    const updated = { ...settings, [key]: v };
    setSettings(updated);
    api.updateSettings(updated).catch(() => {});
  };

  const handleLogout = async () => { await logout(); router.replace('/'); };

  const storageUsed = 18.4;
  const storageTotal = 128;

  return (
    <SafeAreaView style={s.container} testID="settings-screen">
      <View style={s.header}>
        <TouchableOpacity testID="settings-back" onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color={C.fgSecondary} />
        </TouchableOpacity>
        <Text style={s.title}>Settings</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {/* Profile Card */}
        <LinearGradient colors={['rgba(255,75,0,0.1)', 'rgba(255,75,0,0.02)']} style={s.profileCard}>
          <View style={s.avatarCircle}>
            <Text style={s.avatarLetter}>{user?.username?.[0]?.toUpperCase() || 'I'}</Text>
          </View>
          <View style={s.profileInfo}>
            <Text style={s.profileName}>{user?.username || 'User'}</Text>
            <Text style={s.profileAddr} numberOfLines={1}>{user?.wallet_address || '---'}</Text>
          </View>
          <Feather name="chevron-right" size={18} color={C.fgSecondary} />
        </LinearGradient>

        {/* Network */}
        <Text style={s.sectionTitle}>NETWORK</Text>
        <View style={s.card}>
          <SettingToggle testID="wifi-toggle" icon="wifi" iconColor={C.success} label="Wi-Fi" desc="Connected to IONA-NET" value={settings.wifi_enabled} onToggle={() => toggle('wifi_enabled')} />
          <SettingToggle testID="mobile-data-toggle" icon="smartphone" iconColor={C.blue} label="Mobile Data" desc="4G LTE · 24.3 MB used" value={settings.mobile_data} onToggle={() => toggle('mobile_data')} />
          <SettingToggle testID="bluetooth-toggle" icon="bluetooth" iconColor="#8B5CF6" label="Bluetooth" desc={settings.bluetooth ? 'Discoverable' : 'Off'} value={settings.bluetooth} onToggle={() => toggle('bluetooth')} trackOn="#8B5CF6" />
          <SettingNav icon="cast" iconColor="#06B6D4" label="Hotspot" desc="Not active" />
          <SettingNav icon="shield" iconColor={C.success} label="VPN" value="Off" />
        </View>

        {/* Notifications & Sound */}
        <Text style={s.sectionTitle}>NOTIFICATIONS & SOUND</Text>
        <View style={s.card}>
          <SettingToggle testID="notifications-toggle" icon="bell" iconColor={C.accent} label="Notifications" desc="All apps" value={settings.notifications} onToggle={() => toggle('notifications')} trackOn={C.accent} />
          <SettingToggle icon="volume-x" iconColor="#EF4444" label="Do Not Disturb" desc={settings.do_not_disturb ? 'Enabled' : 'Silent mode'} value={settings.do_not_disturb} onToggle={() => toggle('do_not_disturb')} trackOn="#EF4444" />
          <SliderRow label="Volume" value={settings.volume} unit="%" color={C.accent}
            onInc={() => adjustVal('volume', 10)} onDec={() => adjustVal('volume', -10)} />
          <SettingNav icon="music" iconColor="#EC4899" label="Ringtone" value="IONA Pulse" />
        </View>

        {/* Display */}
        <Text style={s.sectionTitle}>DISPLAY</Text>
        <View style={s.card}>
          <SliderRow label="Brightness" value={settings.brightness} unit="%" color="#F59E0B"
            onInc={() => adjustVal('brightness', 10)} onDec={() => adjustVal('brightness', -10)} />
          <SettingNav icon="moon" iconColor="#8B5CF6" label="Dark Mode" value="Always On" />
          <SettingNav icon="type" iconColor={C.fg} label="Font Size" value="Medium" />
          <SettingNav icon="monitor" iconColor="#06B6D4" label="Screen Timeout" value="2 min" />
          <SettingToggle icon="eye" iconColor="#F59E0B" label="Auto Brightness" value={settings.auto_brightness} onToggle={() => toggle('auto_brightness')} trackOn="#F59E0B" />
        </View>

        {/* Storage */}
        <Text style={s.sectionTitle}>STORAGE</Text>
        <View style={s.card}>
          <View style={s.storageRow}>
            <View style={s.storageInfo}>
              <Text style={s.settingLabel}>{storageUsed} GB used of {storageTotal} GB</Text>
              <Text style={s.settingDesc}>{(storageTotal - storageUsed).toFixed(1)} GB available</Text>
            </View>
          </View>
          <View style={s.storageBar}>
            <View style={[s.storageFill, { width: `${(storageUsed / storageTotal) * 100}%` }]} />
          </View>
          <View style={s.storageBreakdown}>
            <View style={s.storageItem}>
              <View style={[s.storageDot, { backgroundColor: C.accent }]} />
              <Text style={s.storageItemText}>Apps: 8.2 GB</Text>
            </View>
            <View style={s.storageItem}>
              <View style={[s.storageDot, { backgroundColor: C.blue }]} />
              <Text style={s.storageItemText}>Media: 5.1 GB</Text>
            </View>
            <View style={s.storageItem}>
              <View style={[s.storageDot, { backgroundColor: C.success }]} />
              <Text style={s.storageItemText}>Blockchain: 3.8 GB</Text>
            </View>
            <View style={s.storageItem}>
              <View style={[s.storageDot, { backgroundColor: C.fgSecondary }]} />
              <Text style={s.storageItemText}>Other: 1.3 GB</Text>
            </View>
          </View>
        </View>

        {/* Battery */}
        <Text style={s.sectionTitle}>BATTERY</Text>
        <View style={s.card}>
          <View style={s.batteryRow}>
            <Feather name="battery-charging" size={28} color={C.success} />
            <View style={s.batteryInfo}>
              <Text style={s.batteryPercent}>87%</Text>
              <Text style={s.settingDesc}>Charging · ~42 min to full</Text>
            </View>
          </View>
          <SettingToggle icon="zap" iconColor="#F59E0B" label="Battery Saver" desc={settings.battery_saver ? 'Active — limiting background' : 'Reduce background activity'} value={settings.battery_saver} onToggle={() => toggle('battery_saver')} trackOn="#F59E0B" />
          <SettingNav icon="bar-chart-2" iconColor={C.success} label="Battery Usage" value="Screen 34%" />
        </View>

        {/* Security */}
        <Text style={s.sectionTitle}>SECURITY</Text>
        <View style={s.card}>
          <SettingNav icon="lock" iconColor={C.accent} label="Screen Lock" value="PIN" />
          <SettingNav icon="key" iconColor="#F59E0B" label="Blockchain Keys" desc="Manage wallet keys" />
          <SettingToggle icon="shield" iconColor={C.success} label="Firewall" desc={settings.firewall ? 'Active protection' : 'Disabled — not recommended'} value={settings.firewall} onToggle={() => toggle('firewall')} />
          <SettingNav icon="eye-off" iconColor="#8B5CF6" label="Privacy" desc="App permissions" />
        </View>

        {/* System */}
        <Text style={s.sectionTitle}>SYSTEM</Text>
        <View style={s.card}>
          <SettingNav icon="cpu" iconColor={C.accent} label="OS Version" value="IONA v0.6.0" />
          <SettingNav icon="hard-drive" iconColor={C.success} label="Kernel" value="x86_64 Rust" />
          <SettingNav icon="git-branch" iconColor="#8B5CF6" label="Consensus" value="Tendermint BFT" />
          <SettingNav icon="database" iconColor="#06B6D4" label="Filesystem" value="IonaFS" />
          <SettingNav icon="layers" iconColor="#F59E0B" label="SDK Version" value="54" />
          <SettingNav icon="info" iconColor={C.fgSecondary} label="About IONA OS" />
        </View>

        {/* Lock device */}
        <TouchableOpacity testID="logout-btn" style={s.logoutBtn} onPress={handleLogout} activeOpacity={0.7}>
          <LinearGradient colors={['rgba(255,0,60,0.2)', 'rgba(255,0,60,0.1)']} style={s.logoutGrad}>
            <Feather name="lock" size={18} color={C.error} />
            <Text style={s.logoutText}>Lock Device</Text>
          </LinearGradient>
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  title: { fontSize: 18, fontWeight: '700', color: C.fg },
  scroll: { paddingHorizontal: 16 },
  profileCard: { flexDirection: 'row', alignItems: 'center', padding: 16, borderRadius: 0, borderWidth: 1, borderColor: 'rgba(255,75,0,0.15)', marginBottom: 20 },
  avatarCircle: { width: 44, height: 44, borderRadius: 0, backgroundColor: C.accent, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  avatarLetter: { fontSize: 20, fontWeight: '800', color: C.bg },
  profileInfo: { flex: 1 },
  profileName: { fontSize: 16, fontWeight: '700', color: C.fg, textTransform: 'capitalize' },
  profileAddr: { fontFamily: MONO, fontSize: 10, color: C.fgSecondary, marginTop: 2 },
  sectionTitle: { fontFamily: MONO, fontSize: 11, color: C.fgSecondary, letterSpacing: 3, marginBottom: 8, marginTop: 4 },
  card: { backgroundColor: 'rgba(255,255,255,0.03)', borderRadius: 0, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', marginBottom: 16, overflow: 'hidden' },
  settingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.04)' },
  settingLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  settingIcon: { width: 34, height: 34, borderRadius: 0, borderWidth: 1, justifyContent: 'center', alignItems: 'center', marginRight: 12, backgroundColor: 'rgba(255,255,255,0.03)' },
  settingLabel: { fontSize: 15, color: C.fg },
  settingDesc: { fontFamily: MONO, fontSize: 11, color: C.fgSecondary, marginTop: 1 },
  navRight: { flexDirection: 'row', alignItems: 'center' },
  navValue: { fontFamily: MONO, fontSize: 12, color: C.fgSecondary, marginRight: 6 },
  sliderRow: { paddingVertical: 12, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.04)' },
  sliderLabel: { fontSize: 15, color: C.fg, marginBottom: 8 },
  sliderControls: { flexDirection: 'row', alignItems: 'center' },
  sliderBtn: { width: 30, height: 30, borderRadius: 0, backgroundColor: 'rgba(255,255,255,0.08)', justifyContent: 'center', alignItems: 'center' },
  sliderBtnText: { fontSize: 18, color: C.fg, fontWeight: '300' },
  sliderTrack: { flex: 1, height: 4, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 2, marginHorizontal: 10, overflow: 'hidden' },
  sliderFill: { height: 4, borderRadius: 2 },
  sliderValue: { fontFamily: MONO, fontSize: 12, color: C.fgSecondary, width: 36, textAlign: 'right' },
  storageRow: { paddingVertical: 12, paddingHorizontal: 14 },
  storageInfo: {},
  storageBar: { height: 8, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 0, marginHorizontal: 14, marginBottom: 10, overflow: 'hidden' },
  storageFill: { height: 8, borderRadius: 0, backgroundColor: C.accent },
  storageBreakdown: { paddingHorizontal: 14, paddingBottom: 12 },
  storageItem: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  storageDot: { width: 8, height: 8, borderRadius: 0, marginRight: 8 },
  storageItemText: { fontFamily: MONO, fontSize: 12, color: C.fgSecondary },
  batteryRow: { flexDirection: 'row', alignItems: 'center', padding: 14, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.04)' },
  batteryInfo: { marginLeft: 12 },
  batteryPercent: { fontSize: 22, fontWeight: '700', color: C.success },
  logoutBtn: { marginTop: 8, borderRadius: 0, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,0,60,0.2)' },
  logoutGrad: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 14 },
  logoutText: { fontSize: 15, fontWeight: '600', color: C.error, marginLeft: 8 },
});
