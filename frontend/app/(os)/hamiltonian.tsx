import React, { useEffect, useRef, useState, useCallback } from 'react';
import { View, StyleSheet, Dimensions, Animated } from 'react-native';
import Svg, { Circle, Line, Text as SvgText, G, Ellipse } from 'react-native-svg';
import { C, MONO } from '@/src/theme';
import { useSystemBridge } from '@/src/context/SystemBridgeContext';

const { width: W } = Dimensions.get('window');
const SIZE = Math.min(W - 32, 320);
const CX = SIZE / 2;
const CY = SIZE / 2;
const BASE_RADIUS = SIZE * 0.38;

const STABILITY_TARGET = 1.42;
const TAU = Math.PI * 2;

type Point3D = { x: number; y: number; z: number; label?: string; type?: string };

// ── 3D → 2D projection (isometric-style) ─────────────────────────────────────
function project(p: Point3D, rotX: number, rotY: number, scale = 1): { x: number; y: number; z: number } {
  // Rotate around Y axis
  const cosY = Math.cos(rotY), sinY = Math.sin(rotY);
  const x1 = p.x * cosY - p.z * sinY;
  const z1 = p.x * sinY + p.z * cosY;
  // Rotate around X axis
  const cosX = Math.cos(rotX), sinX = Math.sin(rotX);
  const y1 = p.y * cosX - z1 * sinX;
  const z2 = p.y * sinX + z1 * cosX;
  // Perspective projection
  const fov = 2.2;
  const s = fov / (fov + z2 / BASE_RADIUS);
  return {
    x: CX + x1 * s * scale,
    y: CY + y1 * s * scale,
    z: z2,
  };
}

// ── Generate sphere grid points ────────────────────────────────────────────────
function generateSpherePoints(
  radius: number,
  latBands: number,
  lonBands: number,
  drift: number,
  thermalPressure: string,
  agentStatus: string
): Point3D[] {
  const points: Point3D[] = [];
  // Deformation: drift stretches sphere along Z (toward thermal sensors)
  const zScale = 1.0 + drift * 4;    // stretch Z when drifting
  const xScale = 1.0 - drift * 1.5;  // compress X
  const yScale = thermalPressure === 'critical' ? 1.0 + drift * 2 : 1.0;

  for (let lat = 0; lat <= latBands; lat++) {
    const theta = (lat / latBands) * Math.PI;
    for (let lon = 0; lon < lonBands; lon++) {
      const phi = (lon / lonBands) * TAU;
      const x = radius * Math.sin(theta) * Math.cos(phi) * xScale;
      const y = radius * Math.cos(theta) * yScale;
      const z = radius * Math.sin(theta) * Math.sin(phi) * zScale;
      // Type based on position — used for coloring
      const type = lat === 0 || lat === latBands ? 'pole'
        : thermalPressure !== 'nominal' && y < -radius * 0.5 ? 'thermal'
        : drift > 0.05 && Math.abs(z) > radius * 0.6 ? 'drift'
        : 'normal';
      points.push({ x, y, z, type });
    }
  }
  return points;
}

// ── Generate validator/HAL sensor points ──────────────────────────────────────
function generateSensorPoints(
  radius: number,
  validators: any[],
  halTemp: number
): Point3D[] {
  const points: Point3D[] = [];
  const count = Math.max(4, validators.length);
  for (let i = 0; i < count; i++) {
    const phi = (i / count) * TAU;
    const theta = Math.PI * 0.4 + (i % 2) * Math.PI * 0.2;
    const r = radius * 1.12; // Slightly outside sphere
    points.push({
      x: r * Math.sin(theta) * Math.cos(phi),
      y: r * Math.cos(theta),
      z: r * Math.sin(theta) * Math.sin(phi),
      type: validators[i]?.status === 'degraded' ? 'degraded' :
            validators[i]?.status === 'active' ? 'validator' : 'hal',
      label: validators[i]?.name?.split(' ').pop() || `S${i}`,
    });
  }
  // HAL thermal sensor point at south pole
  const thermalColor = halTemp > 85 ? 'critical_thermal' : halTemp > 75 ? 'warn_thermal' : 'hal';
  points.push({ x: 0, y: -radius * 1.2, z: 0, type: thermalColor, label: `${halTemp.toFixed(0)}°` });
  return points;
}

// ── Color lookup ──────────────────────────────────────────────────────────────
function pointColor(type: string, opacity = 1): string {
  switch (type) {
    case 'thermal':         return `rgba(239,68,68,${opacity})`;
    case 'critical_thermal':return `rgba(255,0,60,${opacity})`;
    case 'warn_thermal':    return `rgba(245,158,11,${opacity})`;
    case 'drift':           return `rgba(245,158,11,${opacity})`;
    case 'degraded':        return `rgba(255,0,60,${opacity})`;
    case 'validator':       return `rgba(0,255,65,${opacity})`;
    case 'hal':             return `rgba(59,130,246,${opacity})`;
    case 'pole':            return `rgba(255,75,0,${opacity})`;
    default:                return `rgba(255,255,255,${opacity})`;
  }
}

// ── Hamiltonian Sphere Component ──────────────────────────────────────────────
interface HamiltonianSphereProps {
  stabilityIndex: number;
  agentStatus: string;
  thermalPressure: string;
  halTemp: number;
  validators: any[];
  isSimulated: boolean;
  size?: number;
}

export function HamiltonianSphere({
  stabilityIndex = STABILITY_TARGET,
  agentStatus = 'Idle',
  thermalPressure = 'nominal',
  halTemp = 35,
  validators = [],
  isSimulated = false,
  size = SIZE,
}: HamiltonianSphereProps) {
  const rotX = useRef(new Animated.Value(-0.4)).current;
  const rotY = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const [rotXVal, setRotXVal] = useState(-0.4);
  const [rotYVal, setRotYVal] = useState(0);
  const rotRef = useRef({ x: -0.4, y: 0 });
  const animRef = useRef<any>(null);

  const drift = Math.abs(stabilityIndex - STABILITY_TARGET);
  const isWarning = agentStatus === 'Warning' || drift > 0.05;
  const accentColor = drift < 0.02 ? C.success : drift < 0.05 ? C.warning : C.error;

  // Continuous slow rotation
  useEffect(() => {
    let frame: any;
    const tick = () => {
      rotRef.current.y += 0.006;
      if (rotRef.current.y > TAU) rotRef.current.y -= TAU;
      setRotYVal(rotRef.current.y);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  // Pulse when warning
  useEffect(() => {
    if (isWarning) {
      Animated.loop(Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.04, duration: 500, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
      ])).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isWarning]);

  const scale = size / SIZE;
  const radius = BASE_RADIUS * scale;
  const cx = size / 2, cy = size / 2;

  // Generate geometry
  const gridPoints = generateSpherePoints(radius, 8, 12, drift, thermalPressure, agentStatus);
  const sensorPoints = generateSensorPoints(radius, validators, halTemp);
  const allPoints = [...gridPoints, ...sensorPoints];

  // Project all points
  const projected = allPoints.map(p => ({
    ...project(p, rotXVal, rotYVal, 1),
    orig: p,
  }));

  // Sort by Z for painter's algorithm
  const sorted = [...projected].sort((a, b) => a.z - b.z);

  // Generate lat/lon grid lines
  const gridLines: { x1: number; y1: number; x2: number; y2: number; opacity: number }[] = [];
  const latBands = 8, lonBands = 12;

  // Latitude lines
  for (let lat = 1; lat < latBands; lat++) {
    for (let lon = 0; lon < lonBands; lon++) {
      const theta = (lat / latBands) * Math.PI;
      const phi1 = (lon / lonBands) * TAU;
      const phi2 = ((lon + 1) / lonBands) * TAU;
      const zS = 1.0 + drift * 4;
      const xS = 1.0 - drift * 1.5;
      const yS = thermalPressure === 'critical' ? 1.0 + drift * 2 : 1.0;
      const p1 = { x: radius * Math.sin(theta) * Math.cos(phi1) * xS, y: radius * Math.cos(theta) * yS, z: radius * Math.sin(theta) * Math.sin(phi1) * zS };
      const p2 = { x: radius * Math.sin(theta) * Math.cos(phi2) * xS, y: radius * Math.cos(theta) * yS, z: radius * Math.sin(theta) * Math.sin(phi2) * zS };
      const pr1 = project(p1, rotXVal, rotYVal);
      const pr2 = project(p2, rotXVal, rotYVal);
      // Fade back-facing lines
      const avgZ = (pr1.z + pr2.z) / 2;
      const opacity = Math.max(0.05, Math.min(0.35, 0.35 * (1 - avgZ / radius)));
      gridLines.push({ x1: pr1.x, y1: pr1.y, x2: pr2.x, y2: pr2.y, opacity });
    }
  }

  // Longitude lines
  for (let lon = 0; lon < lonBands; lon++) {
    for (let lat = 0; lat < latBands; lat++) {
      const phi = (lon / lonBands) * TAU;
      const theta1 = (lat / latBands) * Math.PI;
      const theta2 = ((lat + 1) / latBands) * Math.PI;
      const zS = 1.0 + drift * 4;
      const xS = 1.0 - drift * 1.5;
      const yS = thermalPressure === 'critical' ? 1.0 + drift * 2 : 1.0;
      const p1 = { x: radius * Math.sin(theta1) * Math.cos(phi) * xS, y: radius * Math.cos(theta1) * yS, z: radius * Math.sin(theta1) * Math.sin(phi) * zS };
      const p2 = { x: radius * Math.sin(theta2) * Math.cos(phi) * xS, y: radius * Math.cos(theta2) * yS, z: radius * Math.sin(theta2) * Math.sin(phi) * zS };
      const pr1 = project(p1, rotXVal, rotYVal);
      const pr2 = project(p2, rotXVal, rotYVal);
      const avgZ = (pr1.z + pr2.z) / 2;
      const opacity = Math.max(0.05, Math.min(0.3, 0.3 * (1 - avgZ / radius)));
      gridLines.push({ x1: pr1.x, y1: pr1.y, x2: pr2.x, y2: pr2.y, opacity });
    }
  }

  return (
    <Animated.View style={[{ width: size, height: size }, isWarning && { transform: [{ scale: pulseAnim }] }]}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {/* Outer ring */}
        <Ellipse
          cx={cx} cy={cy}
          rx={radius * 1.05} ry={radius * 1.05}
          fill="none"
          stroke={accentColor}
          strokeWidth="0.5"
          opacity={0.3}
        />

        {/* Grid lines */}
        {gridLines.map((l, i) => (
          <Line
            key={`gl-${i}`}
            x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
            stroke={isSimulated ? '#6B7280' : accentColor}
            strokeWidth="0.8"
            opacity={l.opacity}
          />
        ))}

        {/* Sorted points — painter's algorithm */}
        {sorted.map((p, i) => {
          const type = p.orig.type || 'normal';
          const isSensor = ['validator', 'hal', 'degraded', 'critical_thermal', 'warn_thermal'].includes(type);
          const depth = Math.max(0.2, Math.min(1.0, (p.z + radius) / (radius * 2)));
          const pointR = isSensor ? 4 : (type === 'pole' ? 2.5 : 1.2);
          const color = pointColor(type, depth);

          return (
            <G key={`pt-${i}`}>
              <Circle
                cx={p.x} cy={p.y} r={pointR}
                fill={color}
                opacity={depth * 0.9}
              />
              {isSensor && p.orig.label && depth > 0.4 && (
                <SvgText
                  x={p.x + 6} y={p.y + 4}
                  fill={color}
                  fontSize="7"
                  fontFamily={MONO as string}
                  opacity={depth * 0.8}
                >
                  {p.orig.label}
                </SvgText>
              )}
            </G>
          );
        })}

        {/* Center stability readout */}
        <SvgText
          x={cx} y={cy - 8}
          fill={accentColor}
          fontSize="14"
          fontFamily={MONO as string}
          textAnchor="middle"
          opacity={0.9}
        >
          {stabilityIndex.toFixed(4)}
        </SvgText>
        <SvgText
          x={cx} y={cy + 6}
          fill="#52525B"
          fontSize="8"
          fontFamily={MONO as string}
          textAnchor="middle"
        >
          {isSimulated ? 'SIM' : agentStatus.toUpperCase()}
        </SvgText>
      </Svg>
    </Animated.View>
  );
}

// ── Standalone screen wrapper ─────────────────────────────────────────────────
import { Text, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { R, SP, GRID, RESET } from '@/src/theme';
import { api } from '@/src/utils/api';
import { haptic } from '@/src/utils/haptics';
import { BridgeStatusBar, HamiltonianSparkline, NetworkStabilityBar } from '@/src/components/GridOverlay';

export default function HamiltonianScreen() {
  const router = useRouter();
  const { bridge, hamiltonian, isSimulated, networkStability } = useSystemBridge();
  const [agent, setAgent] = useState<any>(null);
  const [hal, setHal] = useState<any>(null);
  const [validators, setValidators] = useState<any[]>([]);
  const pollRef = useRef<any>(null);

  const load = async () => {
    try {
      const [a, h, v] = await Promise.all([
        api.getAgentStatus(),
        api.getHalStatus(),
        api.getValidatorHeatmap(),
      ]);
      setAgent(a);
      setHal(h);
      if (v?.cells) setValidators(v.cells);
    } catch {}
  };

  useEffect(() => {
    load();
    pollRef.current = setInterval(load, 1000);
    return () => clearInterval(pollRef.current);
  }, []);

  const drift = Math.abs((agent?.stability_index ?? 1.42) - 1.42);
  const accentColor = drift < 0.02 ? C.success : drift < 0.05 ? C.warning : C.error;

  return (
    <SafeAreaView style={RESET.screen} testID="hamiltonian-screen">
      <View style={RESET.header}>
        <TouchableOpacity onPress={() => { haptic.tap(); router.back(); }}>
          <Feather name="arrow-left" size={20} color={C.fgSecondary} />
        </TouchableOpacity>
        <Text style={{ fontFamily: MONO, fontSize: 11, color: C.fg, letterSpacing: 4 }}>HAMILTONIAN</Text>
        <Text style={{ fontFamily: MONO, fontSize: 9, color: accentColor }}>
          Δ{drift.toFixed(4)}
        </Text>
      </View>

      <BridgeStatusBar />

      <ScrollView contentContainerStyle={{ alignItems: 'center', paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        {/* Sphere */}
        <View style={hs.sphereWrap}>
          <HamiltonianSphere
            stabilityIndex={agent?.stability_index ?? 1.42}
            agentStatus={agent?.agent_status ?? 'Idle'}
            thermalPressure={hal?.thermal_pressure ?? 'nominal'}
            halTemp={hal?.cpu_temp_c ?? 35}
            validators={validators}
            isSimulated={isSimulated}
            size={SIZE}
          />
        </View>

        {/* Legend */}
        <View style={hs.legend}>
          {[
            { color: C.success,  label: 'Validator (active)' },
            { color: C.error,    label: 'Validator (degraded)' },
            { color: C.blue,     label: 'HAL Sensor' },
            { color: C.warning,  label: 'Drift zone' },
            { color: C.accent,   label: 'Poles' },
          ].map(l => (
            <View key={l.label} style={hs.legendItem}>
              <View style={[hs.legendDot, { backgroundColor: l.color }]} />
              <Text style={hs.legendText}>{l.label}</Text>
            </View>
          ))}
        </View>

        {/* Hamiltonian stream sparkline */}
        <View style={[GRID.border, hs.sparkWrap]}>
          <View style={hs.sparkHeader}>
            <Text style={hs.sparkLabel}>Ψ HAMILTONIAN BUFFER</Text>
            {hamiltonian?.metrics && (
              <Text style={[hs.sparkSlope, {
                color: Math.abs(hamiltonian.metrics.slope) < 0.0001 ? C.success : C.warning
              }]}>
                slope {hamiltonian.metrics.slope >= 0 ? '+' : ''}{hamiltonian.metrics.slope.toFixed(8)}
              </Text>
            )}
          </View>
          <HamiltonianSparkline width={W - 64} />
          {hamiltonian?.metrics && (
            <View style={hs.metricsRow}>
              {[
                ['MIN',  hamiltonian.metrics.min.toFixed(4)],
                ['AVG',  hamiltonian.metrics.avg.toFixed(4)],
                ['MAX',  hamiltonian.metrics.max.toFixed(4)],
                ['VAR',  hamiltonian.metrics.variance.toFixed(6)],
                ['NET',  `${Math.round(hamiltonian.metrics.network_stability * 100)}%`],
              ].map(([k, v]) => (
                <View key={k} style={hs.metric}>
                  <Text style={hs.mKey}>{k}</Text>
                  <Text style={hs.mVal}>{v}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Network stability */}
        <View style={[GRID.border, hs.netWrap]}>
          <Text style={hs.sparkLabel}>NETWORK STABILITY</Text>
          <View style={{ marginTop: SP.sm }}>
            <NetworkStabilityBar />
          </View>
        </View>

        {/* Deformation guide */}
        <View style={[GRID.border, hs.guideWrap]}>
          <Text style={hs.guideTitle}>SPHERE DEFORMATION GUIDE</Text>
          {[
            ['Z-stretch', 'Stability drift — sphere elongates along Z-axis proportional to Δ'],
            ['X-compress', 'Compensatory X-axis compression maintains volume conservation'],
            ['Y-stretch', 'Critical thermal — vertical deformation toward HAL sensors'],
            ['Point color', 'Green=OK / Amber=drift / Red=error — maps to grid point type'],
            ['Pulsation', 'Warning state — sphere oscillates at ±4% scale every 500ms'],
          ].map(([k, v]) => (
            <View key={k as string} style={hs.guideRow}>
              <Text style={hs.guideKey}>{k as string}</Text>
              <Text style={hs.guideVal}>{v as string}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const hs = StyleSheet.create({
  sphereWrap: {
    width: SIZE + 16, height: SIZE + 16,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: C.borderSubtle,
    backgroundColor: '#030303', marginVertical: SP.sm,
  },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: SP.md, paddingHorizontal: SP.lg, marginBottom: SP.sm, justifyContent: 'center' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 7, height: 7 },
  legendText: { fontFamily: MONO, fontSize: 9, color: C.fgSecondary },
  sparkWrap: { width: W - 32, padding: SP.md, backgroundColor: C.surface, marginHorizontal: SP.lg, marginBottom: SP.sm },
  sparkHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: SP.sm },
  sparkLabel: { fontFamily: MONO, fontSize: 9, color: C.fgSecondary, letterSpacing: 2 },
  sparkSlope: { fontFamily: MONO, fontSize: 9 },
  metricsRow: { flexDirection: 'row', marginTop: SP.sm },
  metric: { flex: 1 },
  mKey: { fontFamily: MONO, fontSize: 8, color: C.fgTertiary, letterSpacing: 1 },
  mVal: { fontFamily: MONO, fontSize: 11, color: C.fg, marginTop: 1 },
  netWrap: { width: W - 32, padding: SP.md, backgroundColor: C.surface, marginHorizontal: SP.lg, marginBottom: SP.sm },
  guideWrap: { width: W - 32, padding: SP.md, backgroundColor: C.surface, marginHorizontal: SP.lg },
  guideTitle: { fontFamily: MONO, fontSize: 9, color: C.fgSecondary, letterSpacing: 2, marginBottom: SP.sm },
  guideRow: { flexDirection: 'row', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: C.borderSubtle },
  guideKey: { fontFamily: MONO, fontSize: 10, color: C.accent, width: 90 },
  guideVal: { fontFamily: MONO, fontSize: 10, color: C.fgSecondary, flex: 1, lineHeight: 15 },
});
