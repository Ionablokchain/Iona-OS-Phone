/**
 * IONA Voice Engine — Whisper.cpp local STT integration
 *
 * BUILD INSTRUCTIONS:
 * ─────────────────────────────────────────────────────
 * iOS:
 *   1. Clone whisper.cpp: git clone https://github.com/ggerganov/whisper.cpp
 *   2. Build xcframework: ./build-xcframework.sh
 *   3. Copy WhisperKit.xcframework to ios/
 *   4. Run: cd ios && pod install
 *   5. Model: download ggml-tiny.en.bin (75MB) → put in assets/models/
 *
 * Android:
 *   1. Build JNI: cd whisper.cpp && cmake -B build && cmake --build build --target whisper_jni
 *   2. Copy libwhisper.so to android/app/src/main/jniLibs/arm64-v8a/
 *   3. Copy WhisperLib.kt to android/app/src/main/java/
 *   4. Model: ggml-tiny.en.bin → android/app/src/main/assets/models/
 *
 * ALTERNATIVE (easier):
 *   yarn add @ozllo/react-native-whisper
 *   # or: yarn add whisper-rn
 * ─────────────────────────────────────────────────────
 */

import { NativeModules, NativeEventEmitter, Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';
import { api } from './api';

// ─── Native module interface ──────────────────────────────────────────────────
interface WhisperNative {
  initialize(modelPath: string): Promise<boolean>;
  transcribe(audioPath: string, language: string): Promise<string>;
  transcribeRealtime(sampleRate: number): Promise<string>;
  stopRealtime(): void;
  isModelLoaded(): Promise<boolean>;
  release(): void;
}

const WhisperModule: WhisperNative | null =
  NativeModules.WhisperRN ?? NativeModules.IONAWhisper ?? null;

// ─── Types ────────────────────────────────────────────────────────────────────
export type VoiceResult = {
  transcript: string;
  confidence: number;
  language: string;
  duration_ms: number;
  model: string;
  local: boolean;       // Always true — no cloud
};

export type VoiceEngineState = 'idle' | 'initializing' | 'ready' | 'recording' | 'transcribing' | 'error';

// ─── Voice Engine ─────────────────────────────────────────────────────────────
class VoiceEngine {
  private state: VoiceEngineState = 'idle';
  private modelLoaded = false;
  private callbacks: ((result: VoiceResult) => void)[] = [];
  private stateCallbacks: ((state: VoiceEngineState) => void)[] = [];

  // Wake word detection buffer
  private wakeWordBuffer: string[] = [];
  private wakeWordActive = false;
  readonly WAKE_WORD = 'iona';

  async initialize(): Promise<boolean> {
    if (this.modelLoaded) return true;
    this._setState('initializing');

    if (!WhisperModule) {
      // Native module not compiled yet — use fallback
      console.warn(
        '[VoiceEngine] Native Whisper module not found.\n' +
        'Run build instructions to enable local STT.\n' +
        'Falling back to text input mode.'
      );
      this._setState('error');
      return false;
    }

    try {
      // Model path — stored in app documents
      const modelPath = `${FileSystem.documentDirectory}models/ggml-tiny.en.bin`;
      const modelExists = await FileSystem.getInfoAsync(modelPath);

      if (!modelExists.exists) {
        console.warn('[VoiceEngine] Model not found at', modelPath);
        console.warn('[VoiceEngine] Download ggml-tiny.en.bin and place it at:', modelPath);
        this._setState('error');
        return false;
      }

      const ok = await WhisperModule.initialize(modelPath);
      if (ok) {
        this.modelLoaded = true;
        this._setState('ready');
        return true;
      }
    } catch (e) {
      console.error('[VoiceEngine] Init failed:', e);
    }

    this._setState('error');
    return false;
  }

  async transcribeFile(audioPath: string, language = 'en'): Promise<VoiceResult | null> {
    if (!WhisperModule || !this.modelLoaded) return null;
    this._setState('transcribing');
    const t = Date.now();
    try {
      const transcript = await WhisperModule.transcribe(audioPath, language);
      const result: VoiceResult = {
        transcript,
        confidence: this._estimateConfidence(transcript),
        language,
        duration_ms: Date.now() - t,
        model: 'ggml-tiny.en',
        local: true,
      };
      this._setState('ready');
      await this._processTranscript(result);
      return result;
    } catch (e) {
      this._setState('error');
      return null;
    }
  }

  async startRealtimeListening(language = 'en'): Promise<void> {
    if (!WhisperModule || !this.modelLoaded) return;
    this._setState('recording');
    try {
      // This streams audio from mic and transcribes in real-time
      // 16kHz sample rate — Whisper's native rate
      const transcript = await WhisperModule.transcribeRealtime(16000);
      if (transcript) {
        const result: VoiceResult = {
          transcript,
          confidence: this._estimateConfidence(transcript),
          language,
          duration_ms: 0,
          model: 'ggml-tiny.en (realtime)',
          local: true,
        };
        await this._processTranscript(result);
        this._setState('ready');
      }
    } catch (e) {
      this._setState('idle');
    }
  }

  stopListening() {
    WhisperModule?.stopRealtime();
    this._setState('idle');
  }

  /**
   * Process transcript:
   * 1. Check for wake word "IONA"
   * 2. Send to backend command router
   * 3. Notify listeners
   */
  private async _processTranscript(result: VoiceResult) {
    const lower = result.transcript.toLowerCase();

    // Wake word detection
    if (lower.includes(this.WAKE_WORD)) {
      this.wakeWordActive = true;
    }

    // Send to IONA backend command router
    try {
      const response = await api.neuralVoice({
        transcript: result.transcript,
        confidence: result.confidence,
        language: result.language,
      });
      if (response.ok) {
        console.log('[VoiceEngine] Command executed:', response.action, response.result?.result);
      }
    } catch (e) {
      console.warn('[VoiceEngine] Backend command failed:', e);
    }

    this.callbacks.forEach(cb => cb(result));
  }

  private _estimateConfidence(transcript: string): number {
    // Heuristic: longer transcripts with real words = higher confidence
    if (!transcript || transcript.length < 3) return 0.3;
    const words = transcript.split(' ').filter(w => w.length > 2);
    return Math.min(0.99, 0.6 + words.length * 0.05);
  }

  private _setState(state: VoiceEngineState) {
    this.state = state;
    this.stateCallbacks.forEach(cb => cb(state));
  }

  getState(): VoiceEngineState { return this.state; }
  isReady(): boolean { return this.state === 'ready'; }
  isNativeAvailable(): boolean { return !!WhisperModule; }

  onResult(cb: (result: VoiceResult) => void): () => void {
    this.callbacks.push(cb);
    return () => { this.callbacks = this.callbacks.filter(c => c !== cb); };
  }

  onStateChange(cb: (state: VoiceEngineState) => void): () => void {
    this.stateCallbacks.push(cb);
    return () => { this.stateCallbacks = this.stateCallbacks.filter(c => c !== cb); };
  }
}

export const voiceEngine = new VoiceEngine();

// ─── React Hook ───────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback } from 'react';

export function useVoiceEngine() {
  const [state, setState] = useState<VoiceEngineState>('idle');
  const [lastResult, setLastResult] = useState<VoiceResult | null>(null);
  const [isNativeAvailable, setIsNativeAvailable] = useState(false);

  useEffect(() => {
    setIsNativeAvailable(voiceEngine.isNativeAvailable());
    const unsub1 = voiceEngine.onStateChange(setState);
    const unsub2 = voiceEngine.onResult(setLastResult);
    voiceEngine.initialize();
    return () => { unsub1(); unsub2(); };
  }, []);

  const listen = useCallback(() => voiceEngine.startRealtimeListening(), []);
  const stop = useCallback(() => voiceEngine.stopListening(), []);

  // Fallback: process text input when native not available
  const processText = useCallback(async (text: string) => {
    const result: VoiceResult = {
      transcript: text,
      confidence: 1.0,
      language: 'en',
      duration_ms: 0,
      model: 'text-input-fallback',
      local: true,
    };
    setLastResult(result);
    try {
      return await api.neuralVoice({ transcript: text, confidence: 1.0 });
    } catch { return null; }
  }, []);

  return { state, lastResult, isNativeAvailable, listen, stop, processText };
}
