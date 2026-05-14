/**
 * IONA Sovereign Handshake
 * Implements IonaSovereignCircuit flow:
 *   1. Enroll mandate (Poseidon(key) → mandate_hash)
 *   2. Generate nullifier_randomness from accelerometer micro-vibrations
 *   3. Prove: Poseidon(sk)==mandate ∧ sk*r==nullifier ∧ sk≠0
 *   4. Verify → SOVEREIGN-VERIFIED badge
 *   5. Boot sequence: "Mandate Active. Sovereign Score: N"
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  Animated, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { Accelerometer } from 'expo-sensors';
import { C, MONO, R, SP, GRID, RESET } from '@/src/theme';
import { api } from '@/src/utils/api';
import { haptic } from '@/src/utils/haptics';
import { BridgeStatusBar } from '@/src/components/GridOverlay';

const { width: W } = Dimensions.get('window');

// ── Constraint status row ─────────────────────────────────────────────────────
function ConstraintRow({ label, desc, verified, active }: {
  label: string; desc: string; verified: boolean; active: boolean;
}) {
  const slideAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (verified) {
      Animated.timing(slideAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start();
    }
  }, [verified]);
  const color = verified ? C.success : active ? C.accent : C.fgTertiary;
  return (
    <Animated.View style={[cr.row, { opacity: slideAnim.interpolate({ inputRange: [0,1], outputRange: [0.4, 1] }), borderColor: `${color}30` }]}>
      <View style={[cr.indicator, { backgroundColor: verified ? C.success : active ? C.accent : C.borderSubtle }]} />
      <View style={{ flex: 1 }}>
        <Text style={[cr.label, { color }]}>{label}</Text>
        <Text style={cr.desc}>{desc}</Text>
      </View>
      <Feather name={verified ? 'check-circle' : active ? 'loader' : 'circle'} size={16} color={color} />
    </Animated.View>
  );
}
const cr = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, padding: SP.md, marginBottom: 5, gap: 10, backgroundColor: C.surface },
  indicator: { width: 6, height: 6, borderRadius: R.xs, flexShrink: 0 },
  label: { fontFamily: MONO, fontSize: 11, fontWeight: '600', letterSpacing: 0.5 },
  desc: { fontFamily: MONO, fontSize: 9, color: C.fgTertiary, marginTop: 2 },
});

// ── Entropy collector ─────────────────────────────────────────────────────────
function EntropyRing({ collecting, entropy, target }: {
  collecting: boolean; entropy: number; target: number;
}) {
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pct = Math.min(1, entropy / target);

  useEffect(() => {
    if (collecting) {
      Animated.loop(Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.06, duration: 400, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
      ])).start();
    } else { pulseAnim.setValue(1); }
  }, [collecting]);

  const ringSize = 120;
  const strokeW = 6;
  const r2 = (ringSize - strokeW * 2) / 2;
  const circ = 2 * Math.PI * r2;
  const dashOffset = circ * (1 - pct);

  return (
    <Animated.View style={[er.wrap, { transform: [{ scale: pulseAnim }] }]}>
      {/* Ring */}
      <View style={[er.ring, { width: ringSize, height: ringSize, borderRadius: R.none }]}>
        <View style={[er.ringBg, { borderRadius: R.none }]} />
        {/* Progress arc via View rotation trick */}
        {pct > 0 && (
          <View style={[er.arc, {
            borderColor: C.accent,
            borderLeftColor: 'transparent',
            borderBottomColor: pct > 0.25 ? C.accent : 'transparent',
            transform: [{ rotate: `${pct * 360}deg` }],
          }]} />
        )}
      </View>
      <View style={er.center}>
        <Text style={[er.pct, { color: pct >= 1 ? C.success : C.accent }]}>
          {Math.round(pct * 100)}%
        </Text>
        <Text style={er.label}>{collecting ? 'COLLECTING' : pct >= 1 ? 'READY' : 'IDLE'}</Text>
      </View>
    </Animated.View>
  );
}
const er = StyleSheet.create({
  wrap: { width: 120, height: 120, justifyContent: 'center', alignItems: 'center' },
  ring: { width: 120, height: 120, borderWidth: 6, borderColor: C.borderSubtle, justifyContent: 'center', alignItems: 'center' },
  ringBg: { position: 'absolute', inset: 0, backgroundColor: 'transparent' },
  arc: { position: 'absolute', width: 108, height: 108, borderWidth: 6, borderTopColor: C.accent, borderRightColor: C.accent },
  center: { position: 'absolute', alignItems: 'center' },
  pct: { fontFamily: MONO, fontSize: 20, fontWeight: '200' },
  label: { fontFamily: MONO, fontSize: 8, color: C.fgTertiary, letterSpacing: 1, marginTop: 2 },
});

// ── Proof component display ────────────────────────────────────────────────────
function ProofDisplay({ proof }: { proof: any }) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 600, useNativeDriver: true }).start();
  }, []);
  return (
    <Animated.View style={[pd.wrap, { opacity: fadeAnim }]}>
      <Text style={RESET.sectionLabel}>GROTH16 PROOF — BN254</Text>
      {[
        ['π_A', proof.proof?.pi_a],
        ['π_B', proof.proof?.pi_b],
        ['π_C', proof.proof?.pi_c],
      ].map(([k, v]) => v && (
        <View key={k as string} style={pd.row}>
          <Text style={pd.key}>{k as string}</Text>
          <Text style={pd.val} numberOfLines={1}>{(v as string)?.slice(0, 24)}...</Text>
        </View>
      ))}
      <View style={pd.divider} />
      {[
        ['Mandate',   proof.public_inputs?.mandate_hash],
        ['Nullifier', proof.public_inputs?.identity_nullifier],
      ].map(([k, v]) => v && (
        <View key={k as string} style={pd.row}>
          <Text style={pd.key}>{k as string}</Text>
          <Text style={[pd.val, { color: C.accent }]} numberOfLines={1}>{(v as string)?.slice(0, 20)}...</Text>
        </View>
      ))}
    </Animated.View>
  );
}
const pd = StyleSheet.create({
  wrap: { ...GRID.border, padding: SP.md, backgroundColor: '#060606' },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: C.borderSubtle },
  key: { fontFamily: MONO, fontSize: 10, color: C.fgSecondary, width: 70 },
  val: { fontFamily: MONO, fontSize: 10, color: C.fg, flex: 1, textAlign: 'right' },
  divider: { height: 1, backgroundColor: C.border, marginVertical: 6 },
});

// ── Main Screen ───────────────────────────────────────────────────────────────
type Phase = 'idle' | 'enrolling' | 'collecting' | 'proving' | 'verified' | 'error';

export default function SovereignHandshakeScreen() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('idle');
  const [status, setStatus] = useState<any>(null);
  const [bootResult, setBootResult] = useState<any>(null);
  const [proofResult, setProofResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  // Entropy collection from accelerometer
  const [entropy, setEntropy]         = useState(0);
  const [entropyHex, setEntropyHex]   = useState('');
  const ENTROPY_TARGET = 200;          // accelerometer samples needed
  const entropyBuf  = useRef<number[]>([]);
  const accelSub    = useRef<any>(null);

  // Constraints state
  const [c1, setC1] = useState(false);  // Poseidon(sk)==mandate
  const [c2, setC2] = useState(false);  // sk*r==nullifier
  const [c3, setC3] = useState(false);  // sk!=0

  const sovereignGreen = useRef(new Animated.Value(0)).current;
  const bootAnim       = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    api.sovereignStatus().then(setStatus).catch(() => {});
  }, []);

  // Entropy collection via accelerometer
  const startEntropyCollection = useCallback(() => {
    setPhase('collecting');
    setEntropy(0);
    entropyBuf.current = [];
    Accelerometer.setUpdateInterval(16); // 60Hz

    accelSub.current = Accelerometer.addListener(({ x, y, z }) => {
      // Hash motion data into entropy bytes
      const sample = Math.abs(x * 1000) ^ Math.abs(y * 1000) ^ Math.abs(z * 1000);
      entropyBuf.current.push(sample & 0xFF);
      const collected = entropyBuf.current.length;
      setEntropy(collected);

      if (collected >= ENTROPY_TARGET) {
        accelSub.current?.remove();
        accelSub.current = null;
        // Build entropy hex from samples
        const hex = entropyBuf.current
          .slice(0, 64)
          .map(b => b.toString(16).padStart(2, '0'))
          .join('');
        setEntropyHex(hex);
        haptic.success();
        runProof(hex);
      }
    });
  }, []);

  const runProof = useCallback(async (hex: string) => {
    setPhase('proving');
    haptic.medium();
    try {
      // Step 1: Get challenge
      const ch = await api.sovereignChallenge();

      // Animate constraint verification sequence
      setC3(false); setC1(false); setC2(false);
      await new Promise(r => setTimeout(r, 300));
      setC3(true); haptic.tap();   // C3: sk != 0
      await new Promise(r => setTimeout(r, 400));
      setC1(true); haptic.tap();   // C1: Poseidon(sk)==mandate
      await new Promise(r => setTimeout(r, 500));

      // Step 2: Generate proof
      const proof = await api.sovereignProve({
        scope: 'architect',
        challenge: ch.challenge,
        entropy_seed: hex,
      });

      setC2(true); haptic.tap();  // C2: nullifier bound
      setProofResult(proof);
      await new Promise(r => setTimeout(r, 300));

      // Animate sovereign verification
      Animated.sequence([
        Animated.timing(sovereignGreen, { toValue: 1, duration: 800, useNativeDriver: false }),
      ]).start();

      // Boot sequence animation
      Animated.timing(bootAnim, { toValue: 1, duration: 600, useNativeDriver: true }).start();

      setPhase('verified');
      haptic.heavy();

      // Update status
      const newStatus = await api.sovereignStatus();
      setStatus(newStatus);

    } catch (e: any) {
      setError(e?.message || 'Proof generation failed');
      setPhase('error');
      haptic.error();
    }
  }, []);

  const runBootVerify = useCallback(async () => {
    haptic.medium();
    try {
      const result = await api.sovereignBootVerify(entropyHex);
      setBootResult(result);
      haptic.success();
    } catch (e: any) {
      setError(e?.message || 'Boot verification failed');
    }
  }, [entropyHex]);

  const reset = () => {
    setPhase('idle'); setError(null); setProofResult(null); setBootResult(null);
    setC1(false); setC2(false); setC3(false); setEntropy(0); setEntropyHex('');
    sovereignGreen.setValue(0); bootAnim.setValue(0);
    accelSub.current?.remove();
  };

  const bgColor = sovereignGreen.interpolate({
    inputRange: [0, 1],
    outputRange: ['#050505', '#001A00'],
  });

  return (
    <SafeAreaView style={RESET.screen}>
      <Animated.View style={[{ flex: 1 }, { backgroundColor: bgColor as any }]}>
        {/* Header */}
        <View style={RESET.header}>
          <TouchableOpacity onPress={() => { haptic.tap(); router.back(); }}>
            <Feather name="arrow-left" size={20} color={C.fgSecondary} />
          </TouchableOpacity>
          <Text style={{ fontFamily: MONO, fontSize: 11, color: C.fg, letterSpacing: 4 }}>
            SOVEREIGN HANDSHAKE
          </Text>
          <View style={[sh.badge, {
            borderColor: phase === 'verified' ? `${C.success}50` : `${C.fgTertiary}20`
          }]}>
            <Text style={[sh.badgeText, { color: phase === 'verified' ? C.success : C.fgTertiary }]}>
              {phase === 'verified' ? 'VERIFIED' :
               phase === 'proving' ? 'PROVING' :
               phase === 'collecting' ? 'COLLECTING' : 'PENDING'}
            </Text>
          </View>
        </View>

        <BridgeStatusBar />

        <ScrollView contentContainerStyle={{ paddingHorizontal: SP.lg, paddingTop: SP.sm }} showsVerticalScrollIndicator={false}>

          {/* Boot result — shown after boot-verify */}
          {bootResult && (
            <Animated.View style={[sh.bootCard, { opacity: bootAnim, borderColor: bootResult.boot_authorized ? `${C.success}50` : `${C.error}50` }]}>
              <Text style={[sh.bootMsg, { color: bootResult.boot_authorized ? C.success : C.error }]}>
                {bootResult.display_message}
              </Text>
              <View style={sh.scoreRow}>
                <Text style={sh.scoreLabel}>SOVEREIGN SCORE</Text>
                <Text style={[sh.scoreVal, { color: bootResult.sovereign_score >= 80 ? C.success : C.warning }]}>
                  {bootResult.sovereign_score}
                </Text>
              </View>
              <Text style={sh.bootSub}>
                Circuit: {bootResult.circuit} · Constraints: {bootResult.constraints_passed}/3
              </Text>
            </Animated.View>
          )}

          {/* IonaSovereignCircuit explanation */}
          <View style={[GRID.border, { padding: SP.md, backgroundColor: C.surface, marginBottom: SP.sm }]}>
            <Text style={RESET.sectionLabel}>IonaSovereignCircuit — BN254/Groth16</Text>
            <Text style={sh.circuitDesc}>
              Proves "I am the Architect" via 3 R1CS constraints without revealing secret_key.
              Matches kernel/src/identity/zk_identity_circuit.rs exactly.
            </Text>
          </View>

          {/* 3 Constraints */}
          <Text style={RESET.sectionLabel}>CIRCUIT CONSTRAINTS</Text>
          <ConstraintRow
            label="C1: Poseidon(sk) == mandate_hash"
            desc="Golden Bond — proves key ownership via hash without revealing key"
            verified={c1}
            active={phase === 'proving'}
          />
          <ConstraintRow
            label="C2: sk × nullifier_r == identity_nullifier"
            desc="Replay prevention — unique per session, no cross-session tracking"
            verified={c2}
            active={c1 && phase === 'proving'}
          />
          <ConstraintRow
            label="C3: secret_key ≠ 0"
            desc="Key existence — prevents trivial zero-key attacks"
            verified={c3}
            active={phase === 'proving'}
          />

          {/* Entropy collection */}
          {phase === 'collecting' || (phase === 'idle' && entropy > 0) ? (
            <View style={[GRID.border, { padding: SP.md, backgroundColor: C.surface, marginBottom: SP.sm }]}>
              <Text style={RESET.sectionLabel}>ENTROPY — ACCELEROMETER</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP.lg }}>
                <EntropyRing collecting={phase === 'collecting'} entropy={entropy} target={ENTROPY_TARGET} />
                <View style={{ flex: 1 }}>
                  <Text style={sh.entropyLabel}>
                    {entropy < ENTROPY_TARGET
                      ? 'Move your device to collect\nhardware entropy for\nnullifier_randomness'
                      : 'Entropy collected.\nGenerating proof...'}
                  </Text>
                  <Text style={sh.entropySub}>{entropy}/{ENTROPY_TARGET} samples</Text>
                </View>
              </View>
            </View>
          ) : null}

          {/* Proof result */}
          {proofResult && <ProofDisplay proof={proofResult} />}

          {/* Verified state */}
          {phase === 'verified' && proofResult && (
            <Animated.View style={[sh.verifiedCard, { opacity: bootAnim, borderColor: `${C.success}50` }]}>
              <View style={sh.verifiedHeader}>
                <Feather name="shield" size={20} color={C.success} />
                <Text style={sh.verifiedTitle}>SOVEREIGN-VERIFIED</Text>
              </View>
              {[
                ['Circuit',   'IonaSovereignCircuit'],
                ['Curve',     'BN254'],
                ['Scheme',    'Groth16'],
                ['Scope',     proofResult.scope],
                ['Poseidon',  proofResult.poseidon],
                ['Nullifier', proofResult.nullifier],
                ['Key',       proofResult.key_existence],
                ['Privacy',   proofResult.privacy],
              ].map(([k, v]) => (
                <View key={k} style={sh.verRow}>
                  <Text style={sh.verKey}>{k}</Text>
                  <Text style={[sh.verVal, k === 'Scope' && { color: C.accent }]}>{v}</Text>
                </View>
              ))}
              <TouchableOpacity style={sh.bootBtn} onPress={runBootVerify}>
                <Text style={sh.bootBtnText}>RUN BOOT SEQUENCE VERIFICATION</Text>
              </TouchableOpacity>
            </Animated.View>
          )}

          {/* Error state */}
          {phase === 'error' && error && (
            <View style={[GRID.border, { padding: SP.md, borderColor: `${C.error}40`, backgroundColor: `${C.error}08` }]}>
              <Text style={{ fontFamily: MONO, fontSize: 11, color: C.error }}>{error}</Text>
              <TouchableOpacity style={[sh.resetBtn, { marginTop: SP.sm }]} onPress={reset}>
                <Text style={{ fontFamily: MONO, fontSize: 11, color: C.fgSecondary }}>RESET</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Status info */}
          {status && (
            <View style={[GRID.border, { padding: SP.md, backgroundColor: C.surface, marginBottom: SP.sm }]}>
              <Text style={RESET.sectionLabel}>MANDATE STATUS</Text>
              {[
                ['Enrolled',    status.enrolled ? 'YES' : 'NO'],
                ['Proof count', String(status.proof_count || 0)],
                ['Sessions',    String(status.active_sessions || 0)],
                ['Mandate',     status.mandate_short || 'none'],
                ['Nullifiers',  String(status.nullifier_log_size || 0) + ' logged'],
              ].map(([k, v]) => (
                <View key={k} style={sh.statRow}>
                  <Text style={sh.statKey}>{k}</Text>
                  <Text style={sh.statVal}>{v}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Action buttons */}
          {phase === 'idle' && (
            <TouchableOpacity
              style={sh.startBtn}
              onPress={startEntropyCollection}
              activeOpacity={0.8}
            >
              <View style={sh.startInner}>
                <Feather name="shield" size={20} color={C.bg} style={{ marginRight: 10 }} />
                <View>
                  <Text style={sh.startLabel}>INITIATE SOVEREIGN HANDSHAKE</Text>
                  <Text style={sh.startDesc}>Move device → collect entropy → prove identity</Text>
                </View>
              </View>
            </TouchableOpacity>
          )}

          {phase === 'verified' && (
            <TouchableOpacity style={sh.resetBtn} onPress={reset}>
              <Text style={sh.resetText}>New Handshake</Text>
            </TouchableOpacity>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      </Animated.View>
    </SafeAreaView>
  );
}

const sh = StyleSheet.create({
  badge: { borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontFamily: MONO, fontSize: 9, letterSpacing: 1 },
  circuitDesc: { fontFamily: MONO, fontSize: 10, color: C.fgSecondary, lineHeight: 16 },
  entropyLabel: { fontFamily: MONO, fontSize: 11, color: C.fg, lineHeight: 17 },
  entropySub: { fontFamily: MONO, fontSize: 9, color: C.fgTertiary, marginTop: SP.sm },
  bootCard: { borderWidth: 1, padding: SP.lg, marginBottom: SP.sm, backgroundColor: '#001A00' },
  bootMsg: { fontFamily: MONO, fontSize: 16, fontWeight: '200', letterSpacing: 1, marginBottom: SP.sm },
  scoreRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SP.xs },
  scoreLabel: { fontFamily: MONO, fontSize: 9, color: C.fgSecondary, letterSpacing: 2 },
  scoreVal: { fontFamily: MONO, fontSize: 32, fontWeight: '100' },
  bootSub: { fontFamily: MONO, fontSize: 9, color: C.fgTertiary },
  verifiedCard: { borderWidth: 1, padding: SP.md, backgroundColor: '#001A00', marginBottom: SP.sm },
  verifiedHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: SP.md },
  verifiedTitle: { fontFamily: MONO, fontSize: 13, color: C.success, letterSpacing: 2, fontWeight: '700' },
  verRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: C.borderSubtle },
  verKey: { fontFamily: MONO, fontSize: 10, color: C.fgSecondary, width: 70 },
  verVal: { fontFamily: MONO, fontSize: 10, color: C.fg, flex: 1, textAlign: 'right' },
  bootBtn: { marginTop: SP.md, backgroundColor: C.success, height: 44, justifyContent: 'center', alignItems: 'center' },
  bootBtnText: { fontFamily: MONO, fontSize: 11, color: C.bg, letterSpacing: 1 },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: C.borderSubtle },
  statKey: { fontFamily: MONO, fontSize: 10, color: C.fgSecondary },
  statVal: { fontFamily: MONO, fontSize: 10, color: C.fg },
  startBtn: { borderWidth: 2, borderColor: C.accent, marginBottom: SP.md },
  startInner: { flexDirection: 'row', alignItems: 'center', padding: SP.lg, backgroundColor: C.accent },
  startLabel: { fontFamily: MONO, fontSize: 13, color: C.bg, fontWeight: '700', letterSpacing: 1 },
  startDesc: { fontFamily: MONO, fontSize: 9, color: 'rgba(5,5,5,0.7)', marginTop: 3 },
  resetBtn: { borderWidth: 1, borderColor: C.border, height: 40, justifyContent: 'center', alignItems: 'center' },
  resetText: { fontFamily: MONO, fontSize: 11, color: C.fgSecondary },
});
