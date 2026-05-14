import React, { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated, Dimensions } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { haptic } from '@/src/utils/haptics';
import { C, MONO } from '@/src/theme';

const { width: W } = Dimensions.get('window');

type ToastProps = {
  visible: boolean;
  app: string;
  appIcon: string;
  appColor: string;
  title: string;
  body: string;
  onPress: () => void;
  onDismiss: () => void;
};

export function InAppToast({ visible, app, appIcon, appColor, title, body, onPress, onDismiss }: ToastProps) {
  const translateY = useRef(new Animated.Value(-120)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      haptic.warning();
      Animated.parallel([
        Animated.spring(translateY, { toValue: 0, useNativeDriver: true, tension: 80, friction: 10 }),
        Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
      const timer = setTimeout(() => dismiss(), 4000);
      return () => clearTimeout(timer);
    }
  }, [visible]);

  const dismiss = () => {
    Animated.parallel([
      Animated.spring(translateY, { toValue: -120, useNativeDriver: true, tension: 80, friction: 10 }),
      Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => onDismiss());
  };

  if (!visible) return null;

  return (
    <Animated.View style={[st.container, { transform: [{ translateY }], opacity }]}>
      <TouchableOpacity activeOpacity={0.9} onPress={() => { dismiss(); onPress(); }}>
        <BlurView intensity={85} tint="dark" style={st.blur}>
          <View style={[st.icon, { backgroundColor: `${appColor}20`, borderColor: `${appColor}40` }]}>
            <Feather name={appIcon as any} size={18} color={appColor} />
          </View>
          <View style={st.content}>
            <View style={st.topRow}>
              <Text style={st.app}>{app}</Text>
              <Text style={st.time}>now</Text>
            </View>
            <Text style={st.title} numberOfLines={1}>{title}</Text>
            <Text style={st.body} numberOfLines={1}>{body}</Text>
          </View>
          <TouchableOpacity style={st.closeBtn} onPress={() => { haptic.tap(); dismiss(); }}>
            <Feather name="x" size={14} color={C.fgSecondary} />
          </TouchableOpacity>
        </BlurView>
      </TouchableOpacity>
    </Animated.View>
  );
}

const st = StyleSheet.create({
  container: {
    position: 'absolute', top: 50, left: 12, right: 12, zIndex: 9999,
    borderRadius: 0, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4, shadowRadius: 20, elevation: 20,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  blur: { flexDirection: 'row', alignItems: 'center', padding: 14 },
  icon: { width: 40, height: 40, borderRadius: 0, borderWidth: 1, justifyContent: 'center', alignItems: 'center', marginRight: 12, flexShrink: 0 },
  content: { flex: 1 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  app: { fontFamily: MONO, fontSize: 10, color: C.fgSecondary, letterSpacing: 1, textTransform: 'uppercase' },
  time: { fontFamily: MONO, fontSize: 10, color: C.fgSecondary },
  title: { fontSize: 14, fontWeight: '700', color: C.fg },
  body: { fontFamily: MONO, fontSize: 12, color: C.fgSecondary, marginTop: 1 },
  closeBtn: { padding: 4, marginLeft: 6 },
});
