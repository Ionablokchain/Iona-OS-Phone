import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ActivityIndicator,
  ImageBackground, Dimensions, Animated,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@/src/context/AuthContext';
import { C, MONO } from '@/src/theme';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import * as LocalAuthentication from 'expo-local-authentication';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { haptic } from '@/src/utils/haptics';

const { width: W, height: H } = Dimensions.get('window');
const KW = (W - 64) / 3;
const KH = KW * 0.6;

export default function LockScreen() {
  const { user, loading, login } = useAuth();
  const router = useRouter();

  // Check first boot
  useEffect(() => {
    AsyncStorage.getItem('iona_onboarded').then(v => {
      if (!v) router.replace('/onboarding');
    });
  }, []);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [time, setTime] = useState('');
  const [date, setDate] = useState('');
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const successAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const update = () => {
      const now = new Date();
      setTime(now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }));
      setDate(now.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' }));
    };
    update();
    const i = setInterval(update, 1000);
    return () => clearInterval(i);
  }, []);

  useEffect(() => {
    if (!loading && user) router.replace('/(os)/home');
  }, [loading, user]);

  useEffect(() => {
    checkBiometric();
  }, []);

  const checkBiometric = async () => {
    try {
      const compatible = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      setBiometricAvailable(compatible && enrolled);
      if (compatible && enrolled) {
        setTimeout(tryBiometric, 600);
      }
    } catch {}
  };

  const tryBiometric = async () => {
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock IONA OS',
        fallbackLabel: 'Use PIN',
        cancelLabel: 'Cancel',
        disableDeviceFallback: false,
      });
      if (result.success) {
        haptic.success();
        flashSuccess(() => {
          login('iona', '1234').then(() => router.replace('/(os)/home')).catch(() => {});
        });
      }
    } catch {}
  };

  const shake = () => {
    haptic.error();
    shakeAnim.setValue(0);
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 12, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -12, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 8, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -8, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start();
  };

  const flashSuccess = (cb: () => void) => {
    Animated.sequence([
      Animated.timing(successAnim, { toValue: 1, duration: 200, useNativeDriver: false }),
      Animated.timing(successAnim, { toValue: 0, duration: 200, useNativeDriver: false }),
    ]).start(cb);
  };

  const handlePress = async (digit: string) => {
    if (digit === 'del') {
      haptic.tap();
      setPin(p => p.slice(0, -1));
      setError('');
      return;
    }
    haptic.tap();
    const newPin = pin + digit;
    setPin(newPin);
    if (newPin.length === 4) {
      try {
        await login('iona', newPin);
        haptic.success();
        flashSuccess(() => router.replace('/(os)/home'));
      } catch {
        shake();
        setError('INCORRECT PIN');
        setTimeout(() => { setPin(''); setError(''); }, 1000);
      }
    }
  };

  if (loading) return (
    <View style={[s.container, { justifyContent: 'center', alignItems: 'center' }]}>
      <ActivityIndicator size="large" color={C.accent} />
    </View>
  );

  const successBg = successAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['rgba(0,255,65,0)', 'rgba(0,255,65,0.3)'],
  });

  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', biometricAvailable ? 'bio' : '', '0', 'del'];

  return (
    <ImageBackground source={require('../assets/lock_bg.png')} style={s.container} resizeMode="cover" testID="lock-screen">
      <LinearGradient colors={['rgba(5,5,5,0.35)', 'rgba(5,5,5,0.75)', 'rgba(5,5,5,0.97)']} style={s.overlay}>
        <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: successBg }]} pointerEvents="none" />

        {/* Clock */}
        <View style={s.topSection}>
          <View style={s.brandRow}>
            <View style={s.brandLine} />
            <Text style={s.brand}>IONA OS</Text>
            <View style={s.brandLine} />
          </View>
          <Text style={s.time}>{time}</Text>
          <Text style={s.date}>{date}</Text>
          <BlurView intensity={20} tint="dark" style={s.statusPill}>
            <View style={s.greenDot} />
            <Text style={s.nodeText}>BLOCKCHAIN SYNCED · #849,002</Text>
          </BlurView>
        </View>

        {/* PIN dots */}
        <Animated.View style={[s.pinSection, { transform: [{ translateX: shakeAnim }] }]}>
          <Text style={[s.pinLabel, error ? { color: C.error } : null]}>
            {error || 'ENTER PIN'}
          </Text>
          <View style={s.dots}>
            {[0, 1, 2, 3].map(i => (
              <View key={i} style={[
                s.dot,
                pin.length > i ? s.dotFilled : null,
                error ? s.dotError : null,
              ]} />
            ))}
          </View>
        </Animated.View>

        {/* Keypad */}
        <View style={s.padWrap}>
          <View style={s.padGrid}>
            {keys.map((k, idx) => {
              if (k === '') return <View key={idx} style={s.keyEmpty} />;
              if (k === 'bio') return (
                <TouchableOpacity key="bio" testID="pin-bio" style={s.key} onPress={() => { haptic.medium(); tryBiometric(); }} activeOpacity={0.5}>
                  <Feather name="cpu" size={22} color={C.fgSecondary} />
                </TouchableOpacity>
              );
              if (k === 'del') return (
                <TouchableOpacity key="del" testID="pin-delete" style={s.key} onPress={() => handlePress('del')} activeOpacity={0.5}>
                  <Feather name="delete" size={20} color={C.fgSecondary} />
                </TouchableOpacity>
              );
              return (
                <TouchableOpacity key={k} testID={`pin-key-${k}`} style={s.key} onPress={() => handlePress(k)} activeOpacity={0.5}>
                  <Text style={s.keyText}>{k}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <TouchableOpacity testID="emergency-btn" style={s.emergencyBtn}>
          <Feather name="phone-call" size={13} color={C.error} />
          <Text style={s.emergencyText}>EMERGENCY</Text>
        </TouchableOpacity>
      </LinearGradient>
    </ImageBackground>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  overlay: { flex: 1, justifyContent: 'space-between', paddingTop: 60, paddingBottom: 24 },
  topSection: { alignItems: 'center' },
  brandRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  brandLine: { width: 28, height: 1, backgroundColor: C.accent },
  brand: { fontFamily: MONO, fontSize: 10, letterSpacing: 8, color: C.accent, marginHorizontal: 10 },
  time: { fontFamily: MONO, fontSize: 72, fontWeight: '100', color: C.fg, letterSpacing: -4 },
  date: { fontFamily: MONO, fontSize: 13, color: C.fgSecondary, letterSpacing: 1, marginTop: 2, textTransform: 'capitalize' },
  statusPill: {
    flexDirection: 'row', alignItems: 'center', marginTop: 12,
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: 0,
    borderWidth: 1, borderColor: 'rgba(0,255,65,0.2)', overflow: 'hidden',
  },
  greenDot: { width: 6, height: 6, borderRadius: 2, backgroundColor: C.success, marginRight: 7 },
  nodeText: { fontFamily: MONO, fontSize: 9, color: C.success, letterSpacing: 2 },
  pinSection: { alignItems: 'center' },
  pinLabel: { fontFamily: MONO, fontSize: 11, color: C.fgSecondary, letterSpacing: 4, marginBottom: 12 },
  dots: { flexDirection: 'row' },
  dot: { width: 14, height: 14, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.25)', marginHorizontal: 10, borderRadius: 0 },
  dotFilled: { backgroundColor: C.accent, borderColor: C.accent },
  dotError: { backgroundColor: C.error, borderColor: C.error },
  padWrap: { alignItems: 'center' },
  padGrid: { flexDirection: 'row', flexWrap: 'wrap', width: KW * 3 + 16, justifyContent: 'space-between' },
  key: {
    width: KW, height: KH,
    justifyContent: 'center', alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    marginBottom: 8, borderRadius: 0,
  },
  keyEmpty: { width: KW, height: KH, marginBottom: 8 },
  keyText: { fontFamily: MONO, fontSize: 26, color: C.fg, fontWeight: '300' },
  emergencyBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  emergencyText: { fontFamily: MONO, fontSize: 9, color: C.error, letterSpacing: 4, marginLeft: 6 },
});
