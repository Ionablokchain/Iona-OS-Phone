import React, { createContext, useContext, useState, useRef, useCallback } from 'react';
import { Audio } from 'expo-av';

export type Track = {
  id: string;
  title: string;
  artist: string;
  duration: number;
  uri: string;
};

type MusicCtx = {
  currentTrack: Track | null;
  isPlaying: boolean;
  progress: number;
  duration: number;
  play: (track: Track) => void;
  pause: () => void;
  resume: () => void;
  next: () => void;
  prev: () => void;
  setQueue: (tracks: Track[], idx: number) => void;
  queue: Track[];
  currentIdx: number;
};

const MusicContext = createContext<MusicCtx>({} as MusicCtx);
export const useMusic = () => useContext(MusicContext);

export function MusicProvider({ children }: { children: React.ReactNode }) {
  const [queue, setQueueState] = useState<Track[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const soundRef = useRef<Audio.Sound | null>(null);
  const progressRef = useRef<any>(null);

  const stopProgress = () => {
    if (progressRef.current) clearInterval(progressRef.current);
  };

  const startProgress = useCallback((dur: number) => {
    stopProgress();
    progressRef.current = setInterval(() => {
      setProgress(p => {
        if (p >= dur) { stopProgress(); return 0; }
        return p + 1;
      });
    }, 1000);
  }, []);

  const play = useCallback(async (track: Track) => {
    stopProgress();
    await soundRef.current?.unloadAsync();
    soundRef.current = null;
    setProgress(0);
    setCurrentTrack(track);
    setDuration(track.duration);

    if (track.uri) {
      try {
        const { sound } = await Audio.Sound.createAsync(
          { uri: track.uri },
          { shouldPlay: true },
          (status) => {
            if (status.isLoaded && status.didJustFinish) {
              setProgress(0);
            }
          }
        );
        soundRef.current = sound;
      } catch {}
    }
    setIsPlaying(true);
    startProgress(track.duration);
  }, [startProgress]);

  const pause = useCallback(async () => {
    await soundRef.current?.pauseAsync();
    stopProgress();
    setIsPlaying(false);
  }, []);

  const resume = useCallback(async () => {
    await soundRef.current?.playAsync();
    if (currentTrack) startProgress(currentTrack.duration);
    setIsPlaying(true);
  }, [currentTrack, startProgress]);

  const next = useCallback(() => {
    if (queue.length === 0) return;
    const idx = (currentIdx + 1) % queue.length;
    setCurrentIdx(idx);
    play(queue[idx]);
  }, [queue, currentIdx, play]);

  const prev = useCallback(() => {
    if (queue.length === 0) return;
    if (progress > 3) { setProgress(0); return; }
    const idx = (currentIdx - 1 + queue.length) % queue.length;
    setCurrentIdx(idx);
    play(queue[idx]);
  }, [queue, currentIdx, progress, play]);

  const setQueue = useCallback((tracks: Track[], idx: number) => {
    setQueueState(tracks);
    setCurrentIdx(idx);
    play(tracks[idx]);
  }, [play]);

  return (
    <MusicContext.Provider value={{
      currentTrack, isPlaying, progress, duration,
      play, pause, resume, next, prev,
      setQueue, queue, currentIdx,
    }}>
      {children}
    </MusicContext.Provider>
  );
}
