import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList,
  Dimensions, Image, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import * as MediaLibrary from 'expo-media-library';
import { LinearGradient } from 'expo-linear-gradient';
import { C, MONO } from '@/src/theme';

const { width: W } = Dimensions.get('window');

type Track = {
  id: string;
  title: string;
  artist: string;
  duration: number;
  uri: string;
  albumArt?: string;
};

// Demo tracks (will show real tracks from library if permission granted)
const DEMO_TRACKS: Track[] = [
  { id: '1', title: 'Genesis Block', artist: 'IONA Chain', duration: 214, uri: '' },
  { id: '2', title: 'Tendermint Flow', artist: 'Consensus Engine', duration: 187, uri: '' },
  { id: '3', title: 'Dilithium Wave', artist: 'Post-Quantum', duration: 263, uri: '' },
  { id: '4', title: 'Bare Metal', artist: 'Kernel Space', duration: 198, uri: '' },
  { id: '5', title: 'IonaFS Sync', artist: 'Storage Layer', duration: 241, uri: '' },
  { id: '6', title: 'BFT Consensus', artist: 'Validator Set', duration: 176, uri: '' },
  { id: '7', title: 'Ring Zero', artist: 'Syscall Handler', duration: 223, uri: '' },
  { id: '8', title: 'Kyber Dreams', artist: 'Crypto Module', duration: 195, uri: '' },
];

const ACCENT_COLORS = ['#EC4899', '#8B5CF6', '#06B6D4', '#F59E0B', '#00FF41'];

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function MusicScreen() {
  const router = useRouter();
  const [permission, requestPermission] = MediaLibrary.usePermissions();
  const [tracks, setTracks] = useState<Track[]>(DEMO_TRACKS);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [tab, setTab] = useState<'player' | 'queue'>('player');
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const [volume, setVolume] = useState(1.0);
  const soundRef = useRef<Audio.Sound | null>(null);
  const progressRef = useRef<any>(null);
  const spinAnim = useRef(new Animated.Value(0)).current;
  const spinLoop = useRef<any>(null);

  const track = tracks[currentIdx];
  const accentColor = ACCENT_COLORS[currentIdx % ACCENT_COLORS.length];

  useEffect(() => {
    Audio.setAudioModeAsync({ playsInSilentModeIOS: true, staysActiveInBackground: true });
    loadLibrary();
    return () => { stopProgress(); soundRef.current?.unloadAsync(); };
  }, []);

  useEffect(() => {
    if (isPlaying) startSpin(); else stopSpin();
  }, [isPlaying]);

  const loadLibrary = async () => {
    if (!permission?.granted) {
      const res = await requestPermission();
      if (!res.granted) return;
    }
    const media = await MediaLibrary.getAssetsAsync({
      mediaType: 'audio',
      first: 50,
      sortBy: MediaLibrary.SortBy.creationTime,
    });
    if (media.assets.length > 0) {
      const real: Track[] = media.assets.map(a => ({
        id: a.id,
        title: a.filename.replace(/\.[^/.]+$/, ''),
        artist: 'Unknown Artist',
        duration: a.duration,
        uri: a.uri,
      }));
      setTracks(real);
    }
  };

  const startSpin = () => {
    spinLoop.current = Animated.loop(
      Animated.timing(spinAnim, { toValue: 1, duration: 8000, useNativeDriver: true })
    );
    spinLoop.current.start();
  };

  const stopSpin = () => {
    spinLoop.current?.stop();
  };

  const startProgress = () => {
    progressRef.current = setInterval(() => {
      setProgress(p => {
        const dur = duration || track.duration;
        if (p >= dur) { handleNext(); return 0; }
        return p + 1;
      });
    }, 1000);
  };

  const stopProgress = () => {
    if (progressRef.current) clearInterval(progressRef.current);
  };

  const playTrack = async (idx: number) => {
    stopProgress();
    await soundRef.current?.unloadAsync();
    soundRef.current = null;
    setProgress(0);
    setCurrentIdx(idx);

    const t = tracks[idx];
    if (t.uri) {
      try {
        const { sound } = await Audio.Sound.createAsync(
          { uri: t.uri },
          { shouldPlay: true, volume },
          (status) => {
            if (status.isLoaded) {
              setDuration(status.durationMillis ? status.durationMillis / 1000 : t.duration);
              if (status.didJustFinish) handleNext();
            }
          }
        );
        soundRef.current = sound;
        setDuration(t.duration);
        setIsPlaying(true);
        startProgress();
      } catch { simulatePlay(t); }
    } else {
      simulatePlay(t);
    }
  };

  const simulatePlay = (t: Track) => {
    setDuration(t.duration);
    setIsPlaying(true);
    startProgress();
  };

  const togglePlay = async () => {
    if (soundRef.current) {
      const status = await soundRef.current.getStatusAsync();
      if (status.isLoaded) {
        if (isPlaying) { await soundRef.current.pauseAsync(); stopProgress(); }
        else { await soundRef.current.playAsync(); startProgress(); }
      }
    } else {
      if (isPlaying) { stopProgress(); }
      else { startProgress(); }
    }
    setIsPlaying(!isPlaying);
  };

  const handleNext = () => {
    const next = shuffle
      ? Math.floor(Math.random() * tracks.length)
      : repeat ? currentIdx : (currentIdx + 1) % tracks.length;
    playTrack(next);
  };

  const handlePrev = () => {
    if (progress > 3) { setProgress(0); return; }
    playTrack((currentIdx - 1 + tracks.length) % tracks.length);
  };

  const spin = spinAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  const progressPct = duration > 0 ? (progress / duration) * 100 : 0;

  return (
    <SafeAreaView style={s.container} testID="music-screen">
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity testID="music-back" onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color={C.fgSecondary} />
        </TouchableOpacity>
        <View style={s.headerTabs}>
          <TouchableOpacity style={[s.hTab, tab === 'player' && s.hTabActive]} onPress={() => setTab('player')}>
            <Text style={[s.hTabText, tab === 'player' && s.hTabTextActive]}>PLAYER</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.hTab, tab === 'queue' && s.hTabActive]} onPress={() => setTab('queue')}>
            <Text style={[s.hTabText, tab === 'queue' && s.hTabTextActive]}>QUEUE</Text>
          </TouchableOpacity>
        </View>
        <View style={{ width: 22 }} />
      </View>

      {tab === 'player' ? (
        <View style={s.playerContainer}>
          {/* Album art */}
          <View style={s.artWrapper}>
            <LinearGradient
              colors={[`${accentColor}30`, `${accentColor}08`, 'transparent']}
              style={s.artGlow}
            />
            <Animated.View style={[s.artDisc, { transform: [{ rotate: spin }], borderColor: `${accentColor}60` }]}>
              <LinearGradient colors={[`${accentColor}20`, C.surface]} style={s.artInner}>
                <Feather name="music" size={48} color={accentColor} />
              </LinearGradient>
              <View style={s.artCenter} />
            </Animated.View>
          </View>

          {/* Track info */}
          <View style={s.trackInfo}>
            <Text style={s.trackTitle} numberOfLines={1}>{track.title}</Text>
            <Text style={s.trackArtist} numberOfLines={1}>{track.artist}</Text>
          </View>

          {/* Progress */}
          <View style={s.progressContainer}>
            <View style={s.progressBar}>
              <View style={[s.progressFill, { width: `${progressPct}%` as any, backgroundColor: accentColor }]} />
              <View style={[s.progressThumb, { left: `${progressPct}%` as any, backgroundColor: accentColor }]} />
            </View>
            <View style={s.progressTimes}>
              <Text style={s.timeText}>{formatTime(progress)}</Text>
              <Text style={s.timeText}>{formatTime(duration || track.duration)}</Text>
            </View>
          </View>

          {/* Controls */}
          <View style={s.controls}>
            <TouchableOpacity testID="music-shuffle" onPress={() => setShuffle(!shuffle)}>
              <Feather name="shuffle" size={20} color={shuffle ? accentColor : C.fgSecondary} />
            </TouchableOpacity>
            <TouchableOpacity testID="music-prev" style={s.ctrlBtn} onPress={handlePrev}>
              <Feather name="skip-back" size={28} color={C.fg} />
            </TouchableOpacity>
            <TouchableOpacity testID="music-play" style={[s.playBtn, { backgroundColor: accentColor }]} onPress={togglePlay} activeOpacity={0.8}>
              <Feather name={isPlaying ? 'pause' : 'play'} size={30} color={C.bg} />
            </TouchableOpacity>
            <TouchableOpacity testID="music-next" style={s.ctrlBtn} onPress={handleNext}>
              <Feather name="skip-forward" size={28} color={C.fg} />
            </TouchableOpacity>
            <TouchableOpacity testID="music-repeat" onPress={() => setRepeat(!repeat)}>
              <Feather name="repeat" size={20} color={repeat ? accentColor : C.fgSecondary} />
            </TouchableOpacity>
          </View>

          {/* Volume */}
          <View style={s.volumeRow}>
            <Feather name="volume" size={16} color={C.fgSecondary} />
            <View style={s.volumeBar}>
              <View style={[s.volumeFill, { width: `${volume * 100}%` as any, backgroundColor: accentColor }]} />
            </View>
            <Feather name="volume-2" size={16} color={C.fgSecondary} />
          </View>
        </View>
      ) : (
        /* Queue */
        <FlatList
          data={tracks}
          keyExtractor={item => item.id}
          contentContainerStyle={{ paddingBottom: 20 }}
          renderItem={({ item, index }) => {
            const isActive = index === currentIdx;
            return (
              <TouchableOpacity
                style={[s.queueItem, isActive && { backgroundColor: `${accentColor}15` }]}
                onPress={() => playTrack(index)}
                activeOpacity={0.7}
              >
                <View style={[s.queueNum, isActive && { backgroundColor: accentColor }]}>
                  {isActive && isPlaying
                    ? <Feather name="volume-2" size={12} color={C.bg} />
                    : <Text style={[s.queueNumText, isActive && { color: C.bg }]}>{index + 1}</Text>
                  }
                </View>
                <View style={s.queueInfo}>
                  <Text style={[s.queueTitle, isActive && { color: accentColor }]} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text style={s.queueArtist} numberOfLines={1}>{item.artist}</Text>
                </View>
                <Text style={s.queueDur}>{formatTime(item.duration)}</Text>
              </TouchableOpacity>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  headerTabs: { flexDirection: 'row' },
  hTab: { paddingHorizontal: 14, paddingVertical: 4 },
  hTabActive: { borderBottomWidth: 2, borderBottomColor: C.accent },
  hTabText: { fontFamily: MONO, fontSize: 11, color: C.fgSecondary, letterSpacing: 2 },
  hTabTextActive: { color: C.accent },
  playerContainer: { flex: 1, paddingHorizontal: 24 },
  artWrapper: { alignItems: 'center', marginTop: 16, marginBottom: 24 },
  artGlow: { position: 'absolute', width: 260, height: 260, borderRadius: 0 },
  artDisc: { width: 200, height: 200, borderRadius: 0, borderWidth: 2, overflow: 'hidden', justifyContent: 'center', alignItems: 'center' },
  artInner: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' },
  artCenter: { width: 20, height: 20, borderRadius: 0, backgroundColor: C.bg, borderWidth: 2, borderColor: 'rgba(255,255,255,0.2)', position: 'absolute' },
  trackInfo: { alignItems: 'center', marginBottom: 24 },
  trackTitle: { fontSize: 22, fontWeight: '800', color: C.fg, textAlign: 'center' },
  trackArtist: { fontFamily: MONO, fontSize: 13, color: C.fgSecondary, marginTop: 4, letterSpacing: 1 },
  progressContainer: { marginBottom: 24 },
  progressBar: { height: 4, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 2, overflow: 'visible' },
  progressFill: { height: 4, borderRadius: 2 },
  progressThumb: { position: 'absolute', top: -5, width: 14, height: 14, borderRadius: 0, marginLeft: -7 },
  progressTimes: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
  timeText: { fontFamily: MONO, fontSize: 11, color: C.fgSecondary },
  controls: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  ctrlBtn: { width: 52, height: 52, justifyContent: 'center', alignItems: 'center' },
  playBtn: { width: 72, height: 72, borderRadius: 0, justifyContent: 'center', alignItems: 'center' },
  volumeRow: { flexDirection: 'row', alignItems: 'center' },
  volumeBar: { flex: 1, height: 3, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 2, marginHorizontal: 10, overflow: 'hidden' },
  volumeFill: { height: 3, borderRadius: 2 },
  queueItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.04)' },
  queueNum: { width: 28, height: 28, borderRadius: 0, backgroundColor: 'rgba(255,255,255,0.06)', justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  queueNumText: { fontFamily: MONO, fontSize: 11, color: C.fgSecondary },
  queueInfo: { flex: 1 },
  queueTitle: { fontSize: 14, color: C.fg, fontWeight: '600' },
  queueArtist: { fontFamily: MONO, fontSize: 11, color: C.fgSecondary, marginTop: 2 },
  queueDur: { fontFamily: MONO, fontSize: 11, color: C.fgSecondary },
});
