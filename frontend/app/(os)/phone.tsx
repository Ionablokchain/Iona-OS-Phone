import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList,
  Dimensions, Animated, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { C, MONO } from '@/src/theme';
import { api } from '@/src/utils/api';
import { haptic } from '@/src/utils/haptics';

const { width } = Dimensions.get('window');
const KEY_SIZE = (width - 56) / 3;

type Tab = 'dialer' | 'history' | 'contacts';

export default function PhoneScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('dialer');
  const [number, setNumber] = useState('');
  const [calls, setCalls] = useState<any[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [calling, setCalling] = useState(false);
  const [callingName, setCallingName] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const callTimer = useRef<any>(null);
  const [callSeconds, setCallSeconds] = useState(0);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (calling) {
      callTimer.current = setInterval(() => setCallSeconds(s => s + 1), 1000);
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.08, duration: 600, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
        ])
      ).start();
    } else {
      if (callTimer.current) clearInterval(callTimer.current);
      setCallSeconds(0);
      pulseAnim.setValue(1);
    }
    return () => { if (callTimer.current) clearInterval(callTimer.current); };
  }, [calling]);

  const load = async () => {
    const [c, ct] = await Promise.all([
      api.getCalls().catch(() => []),
      api.getContacts().catch(() => []),
    ]);
    setCalls(c);
    setContacts(ct);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const handleKey = (k: string) => {
    haptic.tap();
    if (k === 'del') { setNumber(n => n.slice(0, -1)); return; }
    if (k === 'call') {
      if (!number) return;
      startCall(number, 'Unknown');
      return;
    }
    setNumber(n => n + k);
  };

  const startCall = (phone: string, name: string) => {
    haptic.medium();
    setCalling(true);
    setCallingName(name);
    // Auto end after 4s (simulation)
    setTimeout(() => {
      haptic.tap();
      setCalling(false);
      api.createCall({ contact_name: name, phone, call_type: 'outgoing', duration_seconds: callSeconds }).catch(() => {});
      load();
    }, 4000);
  };

  const endCall = () => {
    haptic.heavy();
    setCalling(false);
    api.createCall({ contact_name: callingName, phone: number, call_type: 'outgoing', duration_seconds: callSeconds }).catch(() => {});
    load();
  };

  const formatDuration = (s: number) => {
    if (s === 0) return '--:--';
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const formatCallSeconds = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];

  // Active call screen
  if (calling) {
    return (
      <SafeAreaView style={s.callScreen}>
        <LinearGradient colors={['rgba(0,255,65,0.15)', 'rgba(5,5,5,0.98)']} style={StyleSheet.absoluteFill} />
        <View style={s.callTop}>
          <Text style={s.callLabel}>CALLING</Text>
          <Text style={s.callName}>{callingName}</Text>
          <Text style={s.callNumber}>{number}</Text>
          <Text style={s.callTimer}>{formatCallSeconds(callSeconds)}</Text>
        </View>
        <Animated.View style={[s.callRipple, { transform: [{ scale: pulseAnim }] }]}>
          <View style={s.callAvatar}>
            <Text style={s.callAvatarText}>{callingName[0]?.toUpperCase() || '#'}</Text>
          </View>
        </Animated.View>
        <View style={s.callActions}>
          <TouchableOpacity style={s.callActionBtn} onPress={() => haptic.tap()}>
            <Feather name="mic-off" size={22} color={C.fg} />
            <Text style={s.callActionLabel}>Mute</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.callEndBtn]} onPress={endCall}>
            <Feather name="phone-off" size={28} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity style={s.callActionBtn} onPress={() => haptic.tap()}>
            <Feather name="speaker" size={22} color={C.fg} />
            <Text style={s.callActionLabel}>Speaker</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.container} testID="phone-screen">
      <View style={s.header}>
        <TouchableOpacity testID="phone-back" onPress={() => { haptic.tap(); router.back(); }}>
          <Feather name="arrow-left" size={22} color={C.fgSecondary} />
        </TouchableOpacity>
        <Text style={s.title}>PHONE</Text>
        <View style={{ width: 22 }} />
      </View>

      {/* Tabs */}
      <View style={s.tabs}>
        {(['dialer', 'history', 'contacts'] as Tab[]).map(t => (
          <TouchableOpacity
            key={t}
            style={[s.tab, tab === t && s.tabActive]}
            onPress={() => { haptic.selection(); setTab(t); }}
          >
            <Text style={[s.tabText, tab === t && s.tabTextActive]}>
              {t.toUpperCase()}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'dialer' && (
        <View style={s.dialerContainer}>
          <View style={s.numberDisplay}>
            <Text style={s.numberText} numberOfLines={1} adjustsFontSizeToFit>
              {number || '·  ·  ·'}
            </Text>
            {number.length > 0 && (
              <TouchableOpacity onPress={() => { haptic.tap(); setNumber(n => n.slice(0, -1)); }} style={s.deleteBtn}>
                <Feather name="delete" size={20} color={C.fgSecondary} />
              </TouchableOpacity>
            )}
          </View>
          <View style={s.pad}>
            {keys.map(k => (
              <TouchableOpacity key={k} testID={`dial-${k}`} style={s.key} onPress={() => handleKey(k)} activeOpacity={0.5}>
                <Text style={s.keyText}>{k}</Text>
                {k === '2' && <Text style={s.keySubText}>ABC</Text>}
                {k === '3' && <Text style={s.keySubText}>DEF</Text>}
                {k === '4' && <Text style={s.keySubText}>GHI</Text>}
                {k === '5' && <Text style={s.keySubText}>JKL</Text>}
                {k === '6' && <Text style={s.keySubText}>MNO</Text>}
                {k === '7' && <Text style={s.keySubText}>PQRS</Text>}
                {k === '8' && <Text style={s.keySubText}>TUV</Text>}
                {k === '9' && <Text style={s.keySubText}>WXYZ</Text>}
              </TouchableOpacity>
            ))}
          </View>
          <View style={s.callRow}>
            <TouchableOpacity
              testID="dial-call"
              style={[s.callBtn, !number && s.callBtnDisabled]}
              onPress={() => handleKey('call')}
              disabled={!number}
            >
              <Feather name="phone" size={28} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {tab === 'history' && (
        <FlatList
          data={calls}
          keyExtractor={item => item.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={s.callItem}
              testID={`call-${item.id}`}
              onPress={() => { haptic.tap(); setNumber(item.phone); setTab('dialer'); }}
            >
              <View style={[s.callIcon, {
                backgroundColor: item.call_type === 'missed' ? 'rgba(255,0,60,0.1)' : 'rgba(0,255,65,0.08)'
              }]}>
                <Feather
                  name={item.call_type === 'incoming' ? 'phone-incoming' : item.call_type === 'missed' ? 'phone-missed' : 'phone-outgoing'}
                  size={18}
                  color={item.call_type === 'missed' ? C.error : C.success}
                />
              </View>
              <View style={s.callInfo}>
                <Text style={[s.callName, item.call_type === 'missed' && { color: C.error }]}>{item.contact_name}</Text>
                <Text style={s.callPhone}>{item.phone}</Text>
              </View>
              <View style={s.callMeta}>
                <Text style={s.callDuration}>{formatDuration(item.duration_seconds)}</Text>
                <Text style={s.callTime}>
                  {new Date(item.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                </Text>
              </View>
            </TouchableOpacity>
          )}
          ListEmptyComponent={<Text style={s.empty}>NO CALL HISTORY</Text>}
        />
      )}

      {tab === 'contacts' && (
        <FlatList
          data={contacts}
          keyExtractor={item => item.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={s.contactItem}
              onPress={() => { haptic.tap(); setNumber(item.phone); setTab('dialer'); }}
            >
              <View style={[s.contactAvatar, { borderColor: item.avatar_color || C.accent }]}>
                <Text style={[s.contactAvatarText, { color: item.avatar_color || C.accent }]}>
                  {item.name?.[0]?.toUpperCase() || '?'}
                </Text>
              </View>
              <View style={s.contactInfo}>
                <Text style={s.contactName}>{item.name}</Text>
                <Text style={s.contactPhone}>{item.phone}</Text>
              </View>
              <TouchableOpacity
                style={s.contactCallBtn}
                onPress={() => { haptic.medium(); startCall(item.phone, item.name); }}
              >
                <Feather name="phone" size={20} color={C.success} />
              </TouchableOpacity>
            </TouchableOpacity>
          )}
          ListEmptyComponent={<Text style={s.empty}>NO CONTACTS</Text>}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  callScreen: { flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'space-between', paddingVertical: 60 },
  callTop: { alignItems: 'center' },
  callLabel: { fontFamily: MONO, fontSize: 11, color: C.success, letterSpacing: 4, marginBottom: 8 },
  callName: { fontSize: 32, fontWeight: '800', color: C.fg },
  callNumber: { fontFamily: MONO, fontSize: 15, color: C.fgSecondary, marginTop: 4 },
  callTimer: { fontFamily: MONO, fontSize: 20, color: C.success, marginTop: 12 },
  callRipple: { width: 140, height: 140, borderRadius: 0, borderWidth: 1, borderColor: 'rgba(0,255,65,0.2)', justifyContent: 'center', alignItems: 'center' },
  callAvatar: { width: 110, height: 110, borderRadius: 0, backgroundColor: 'rgba(0,255,65,0.12)', borderWidth: 2, borderColor: C.success, justifyContent: 'center', alignItems: 'center' },
  callAvatarText: { fontSize: 48, fontWeight: '800', color: C.success },
  callActions: { flexDirection: 'row', alignItems: 'center', width: '100%', justifyContent: 'space-around', paddingHorizontal: 32 },
  callActionBtn: { alignItems: 'center', gap: 6 },
  callActionLabel: { fontFamily: MONO, fontSize: 11, color: C.fgSecondary },
  callEndBtn: { width: 72, height: 72, borderRadius: 0, backgroundColor: C.error, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  title: { fontFamily: MONO, fontSize: 14, color: C.fg, letterSpacing: 4 },
  tabs: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: C.border },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabActive: { borderBottomWidth: 2, borderBottomColor: C.accent },
  tabText: { fontFamily: MONO, fontSize: 11, color: C.fgSecondary, letterSpacing: 1 },
  tabTextActive: { color: C.accent },
  dialerContainer: { flex: 1 },
  numberDisplay: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 28, paddingVertical: 20, borderBottomWidth: 1, borderBottomColor: C.border, minHeight: 80 },
  numberText: { flex: 1, fontFamily: MONO, fontSize: 38, color: C.fg, fontWeight: '200', letterSpacing: 2, textAlign: 'center' },
  deleteBtn: { padding: 8 },
  pad: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', paddingHorizontal: 20, paddingTop: 8, gap: 6 },
  key: { width: KEY_SIZE, height: KEY_SIZE * 0.65, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', borderRadius: 0, backgroundColor: 'rgba(255,255,255,0.03)' },
  keyText: { fontFamily: MONO, fontSize: 28, color: C.fg, fontWeight: '300' },
  keySubText: { fontFamily: MONO, fontSize: 8, color: C.fgSecondary, letterSpacing: 1, marginTop: 1 },
  callRow: { alignItems: 'center', paddingVertical: 20 },
  callBtn: { width: 72, height: 72, borderRadius: 0, backgroundColor: C.success, justifyContent: 'center', alignItems: 'center', shadowColor: C.success, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 12, elevation: 8 },
  callBtnDisabled: { backgroundColor: 'rgba(255,255,255,0.1)' },
  callItem: { flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: C.border },
  callIcon: { width: 42, height: 42, borderRadius: 0, justifyContent: 'center', alignItems: 'center', marginRight: 14 },
  callInfo: { flex: 1 },
  callName: { fontSize: 16, color: C.fg, fontWeight: '600' },
  callPhone: { fontFamily: MONO, fontSize: 12, color: C.fgSecondary, marginTop: 2 },
  callMeta: { alignItems: 'flex-end' },
  callDuration: { fontFamily: MONO, fontSize: 13, color: C.fg },
  callTime: { fontFamily: MONO, fontSize: 11, color: C.fgSecondary, marginTop: 2 },
  contactItem: { flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: C.border },
  contactAvatar: { width: 44, height: 44, borderRadius: 0, borderWidth: 1.5, justifyContent: 'center', alignItems: 'center', marginRight: 14 },
  contactAvatarText: { fontFamily: MONO, fontSize: 18, fontWeight: '700' },
  contactInfo: { flex: 1 },
  contactName: { fontSize: 16, color: C.fg, fontWeight: '600' },
  contactPhone: { fontFamily: MONO, fontSize: 12, color: C.fgSecondary, marginTop: 2 },
  contactCallBtn: { width: 44, height: 44, borderRadius: 0, backgroundColor: 'rgba(0,255,65,0.1)', justifyContent: 'center', alignItems: 'center' },
  empty: { fontFamily: MONO, fontSize: 13, color: C.fgSecondary, textAlign: 'center', marginTop: 60, letterSpacing: 2 },
});
