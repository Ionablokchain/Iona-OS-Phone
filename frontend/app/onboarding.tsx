import React, { useState, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, TextInput,
  Dimensions, Animated, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { C, MONO } from '@/src/theme';
import { haptic } from '@/src/utils/haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@/src/context/AuthContext';

const { width: W, height: H } = Dimensions.get('window');

const STEPS = [
  {
    icon: 'cpu',
    color: C.accent,
    title: 'Welcome to\nIONA OS',
    subtitle: 'A bare-metal blockchain OS.\nBuilt in Rust. Secured by post-quantum cryptography.',
  },
  {
    icon: 'shield',
    color: '#6366F1',
    title: 'Post-Quantum\nSecurity',
    subtitle: 'Your keys are protected by Dilithium3 and Kyber768 — cryptography built for the quantum era.',
  },
  {
    icon: 'server',
    color: C.success,
    title: 'Your Own\nBlockchain Node',
    subtitle: 'Run a full IONA validator node directly on your device. Tendermint BFT consensus.',
  },
  {
    icon: 'user',
    color: '#F59E0B',
    title: 'Create\nYour Profile',
    subtitle: 'Choose a username and set a 4-digit PIN to secure your device.',
    isForm: true,
  },
];

export default function OnboardingScreen() {
  const router = useRouter();
  const { register, login } = useAuth();
  const [step, setStep] = useState(0);
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const slideAnim = useRef(new Animated.Value(0)).current;

  const goNext = () => {
    haptic.tap();
    if (step < STEPS.length - 1) {
      Animated.sequence([
        Animated.timing(slideAnim, { toValue: -W, duration: 200, useNativeDriver: true }),
      ]).start(() => {
        setStep(s => s + 1);
        slideAnim.setValue(W);
        Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 80, friction: 12 }).start();
      });
    }
  };

  const finish = async () => {
    if (!username.trim() || pin.length !== 4) {
      setError('Enter a username and 4-digit PIN');
      haptic.error();
      return;
    }
    setLoading(true);
    setError('');
    try {
      await register(username.trim(), pin);
      haptic.success();
      await AsyncStorage.setItem('iona_onboarded', '1');
      router.replace('/(os)/home');
    } catch (e: any) {
      // Try default user if already exists
      try {
        await login('iona', '1234');
        await AsyncStorage.setItem('iona_onboarded', '1');
        router.replace('/(os)/home');
      } catch {
        setError(e.message || 'Setup failed. Try again.');
        haptic.error();
      }
    }
    setLoading(false);
  };

  const skip = async () => {
    haptic.tap();
    try {
      await login('iona', '1234');
      await AsyncStorage.setItem('iona_onboarded', '1');
      router.replace('/(os)/home');
    } catch {
      router.replace('/');
    }
  };

  const current = STEPS[step];

  return (
    <LinearGradient colors={['#050505', '#0A0A0A']} style={s.container}>
      {/* Skip */}
      <View style={s.topBar}>
        <TouchableOpacity onPress={skip} style={s.skipBtn}>
          <Text style={s.skipText}>Skip</Text>
        </TouchableOpacity>
      </View>

      <Animated.View style={[s.content, { transform: [{ translateX: slideAnim }] }]}>
        {/* Icon */}
        <View style={[s.iconWrap, { borderColor: `${current.color}40`, backgroundColor: `${current.color}12` }]}>
          <Feather name={current.icon as any} size={56} color={current.color} />
        </View>

        {/* Text */}
        <Text style={s.title}>{current.title}</Text>
        <Text style={s.subtitle}>{current.subtitle}</Text>

        {/* Form on last step */}
        {current.isForm && (
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={s.form}>
            <TextInput
              style={s.input}
              value={username}
              onChangeText={setUsername}
              placeholder="Username"
              placeholderTextColor={C.fgSecondary}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <TextInput
              style={s.input}
              value={pin}
              onChangeText={t => setPin(t.replace(/\D/g, '').slice(0, 4))}
              placeholder="4-digit PIN"
              placeholderTextColor={C.fgSecondary}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={4}
            />
            {error ? <Text style={s.error}>{error}</Text> : null}
          </KeyboardAvoidingView>
        )}
      </Animated.View>

      {/* Dots */}
      <View style={s.dots}>
        {STEPS.map((_, i) => (
          <View key={i} style={[s.dot, i === step && { backgroundColor: C.accent, width: 20 }]} />
        ))}
      </View>

      {/* Button */}
      <View style={s.bottom}>
        {step < STEPS.length - 1 ? (
          <TouchableOpacity style={s.nextBtn} onPress={goNext}>
            <LinearGradient colors={[C.accent, '#CC3A00']} style={s.nextGrad}>
              <Text style={s.nextText}>Continue</Text>
              <Feather name="arrow-right" size={18} color={C.fg} style={{ marginLeft: 8 }} />
            </LinearGradient>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[s.nextBtn, loading && { opacity: 0.7 }]}
            onPress={finish}
            disabled={loading}
          >
            <LinearGradient colors={[C.accent, '#CC3A00']} style={s.nextGrad}>
              <Text style={s.nextText}>{loading ? 'Setting up...' : 'Get Started'}</Text>
              {!loading && <Feather name="check" size={18} color={C.fg} style={{ marginLeft: 8 }} />}
            </LinearGradient>
          </TouchableOpacity>
        )}
      </View>
    </LinearGradient>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  topBar: { paddingTop: 60, paddingHorizontal: 24, alignItems: 'flex-end' },
  skipBtn: { padding: 8 },
  skipText: { fontFamily: MONO, fontSize: 13, color: C.fgSecondary, letterSpacing: 1 },
  content: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  iconWrap: { width: 120, height: 120, borderRadius: 0, borderWidth: 1.5, justifyContent: 'center', alignItems: 'center', marginBottom: 36 },
  title: { fontSize: 36, fontWeight: '900', color: C.fg, textAlign: 'center', lineHeight: 42, marginBottom: 16 },
  subtitle: { fontFamily: MONO, fontSize: 14, color: C.fgSecondary, textAlign: 'center', lineHeight: 22, letterSpacing: 0.5 },
  form: { width: '100%', marginTop: 28 },
  input: { height: 54, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', borderRadius: 0, paddingHorizontal: 16, color: C.fg, fontFamily: MONO, fontSize: 16, marginBottom: 12, backgroundColor: 'rgba(255,255,255,0.05)' },
  error: { fontFamily: MONO, fontSize: 12, color: C.error, textAlign: 'center', marginTop: 4 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 8, marginBottom: 24 },
  dot: { width: 8, height: 8, borderRadius: 0, backgroundColor: 'rgba(255,255,255,0.2)', transition: 'width 0.2s' },
  bottom: { paddingHorizontal: 24, paddingBottom: 48 },
  nextBtn: { borderRadius: 0, overflow: 'hidden' },
  nextGrad: { height: 56, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', borderRadius: 0 },
  nextText: { fontFamily: MONO, fontSize: 15, color: C.fg, letterSpacing: 2 },
});
