import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Dimensions } from 'react-native';
import { BlurView } from 'expo-blur';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMusic } from '@/src/context/MusicContext';
import { haptic } from '@/src/utils/haptics';
import { C, MONO } from '@/src/theme';

const { width: W } = Dimensions.get('window');

export function MiniPlayer() {
  const router = useRouter();
  const { currentTrack, isPlaying, pause, resume, next } = useMusic();

  if (!currentTrack) return null;

  const ACCENT_COLORS = ['#EC4899', '#8B5CF6', '#06B6D4', '#F59E0B', '#00FF41'];
  const accentColor = ACCENT_COLORS[parseInt(currentTrack.id) % ACCENT_COLORS.length] || '#EC4899';

  return (
    <TouchableOpacity
      style={s.container}
      onPress={() => { haptic.tap(); router.push('/(os)/music'); }}
      activeOpacity={0.95}
    >
      <BlurView intensity={80} tint="dark" style={s.blur}>
        <View style={[s.accent, { backgroundColor: accentColor }]} />
        <View style={s.info}>
          <View style={[s.disc, { borderColor: `${accentColor}60` }]}>
            <Feather name="music" size={12} color={accentColor} />
          </View>
          <View style={s.text}>
            <Text style={s.title} numberOfLines={1}>{currentTrack.title}</Text>
            <Text style={s.artist} numberOfLines={1}>{currentTrack.artist}</Text>
          </View>
        </View>
        <View style={s.controls}>
          <TouchableOpacity
            onPress={() => { haptic.tap(); isPlaying ? pause() : resume(); }}
            style={s.btn}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Feather name={isPlaying ? 'pause' : 'play'} size={18} color={C.fg} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => { haptic.tap(); next(); }}
            style={s.btn}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Feather name="skip-forward" size={18} color={C.fg} />
          </TouchableOpacity>
        </View>
      </BlurView>
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 90,
    left: 12,
    right: 12,
    borderRadius: 0,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
    elevation: 10,
  },
  blur: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10 },
  accent: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, borderRadius: 2 },
  info: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  disc: { width: 32, height: 32, borderRadius: 0, borderWidth: 1.5, justifyContent: 'center', alignItems: 'center', marginRight: 10, backgroundColor: 'rgba(255,255,255,0.05)' },
  text: { flex: 1 },
  title: { fontSize: 13, fontWeight: '600', color: C.fg },
  artist: { fontFamily: MONO, fontSize: 10, color: C.fgSecondary, marginTop: 1 },
  controls: { flexDirection: 'row', alignItems: 'center' },
  btn: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center' },
});
