import React, { useState } from 'react';
import { haptic } from '@/src/utils/haptics';
import { View, Text, TouchableOpacity, StyleSheet, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { C, MONO } from '@/src/theme';

const { width } = Dimensions.get('window');
const BTN_SIZE = (width - 64) / 4;

export default function CalculatorScreen() {
  const router = useRouter();
  const [display, setDisplay] = useState('0');
  const [prev, setPrev] = useState<number | null>(null);
  const [op, setOp] = useState<string | null>(null);
  const [fresh, setFresh] = useState(true);

  const handlePress = (key: string) => {
    if (key === 'C') { setDisplay('0'); setPrev(null); setOp(null); setFresh(true); return; }
    if (key === '±') { setDisplay(d => d.startsWith('-') ? d.slice(1) : '-' + d); return; }
    if (key === '%') { setDisplay(d => String(parseFloat(d) / 100)); return; }
    if (['+', '-', '×', '÷'].includes(key)) {
      setPrev(parseFloat(display));
      setOp(key);
      setFresh(true);
      return;
    }
    if (key === '=') {
      if (prev !== null && op) {
        const cur = parseFloat(display);
        let result = 0;
        if (op === '+') result = prev + cur;
        else if (op === '-') result = prev - cur;
        else if (op === '×') result = prev * cur;
        else if (op === '÷') result = cur !== 0 ? prev / cur : 0;
        setDisplay(String(result));
        setPrev(null);
        setOp(null);
        setFresh(true);
      }
      return;
    }
    if (key === '.') {
      if (fresh) { setDisplay('0.'); setFresh(false); return; }
      if (!display.includes('.')) setDisplay(d => d + '.');
      return;
    }
    // Number
    if (fresh) { setDisplay(key); setFresh(false); }
    else { setDisplay(d => d === '0' ? key : d + key); }
  };

  const keys = [
    ['C', '±', '%', '÷'],
    ['7', '8', '9', '×'],
    ['4', '5', '6', '-'],
    ['1', '2', '3', '+'],
    ['0', '.', '='],
  ];

  const isOp = (k: string) => ['+', '-', '×', '÷', '='].includes(k);

  return (
    <SafeAreaView style={s.container} testID="calculator-screen">
      <View style={s.header}>
        <TouchableOpacity testID="calc-back" onPress={() => router.back()}>
          <Text style={s.backText}>{'< BACK'}</Text>
        </TouchableOpacity>
        <Text style={s.title}>CALCULATOR</Text>
        <View style={{ width: 60 }} />
      </View>

      <View style={s.displayContainer}>
        <Text style={s.displayText} numberOfLines={1} adjustsFontSizeToFit testID="calc-display">{display}</Text>
      </View>

      <View style={s.keypad}>
        {keys.map((row, ri) => (
          <View key={ri} style={s.row}>
            {row.map(k => (
              <TouchableOpacity
                key={k}
                testID={`calc-key-${k}`}
                style={[s.key, k === '0' && s.keyWide, isOp(k) && s.keyOp, k === '=' && s.keyAccent]}
                onPress={() => handlePress(k)}
                activeOpacity={0.6}
              >
                <Text style={[s.keyText, isOp(k) && s.keyOpText]}>{k}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ))}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: C.border },
  backText: { fontFamily: MONO, fontSize: 12, color: C.fgSecondary, letterSpacing: 1 },
  title: { fontFamily: MONO, fontSize: 14, color: C.fg, letterSpacing: 4 },
  displayContainer: { flex: 1, justifyContent: 'flex-end', padding: 24 },
  displayText: { fontFamily: MONO, fontSize: 56, color: C.fg, textAlign: 'right', fontWeight: '200' },
  keypad: { padding: 8 },
  row: { flexDirection: 'row', gap: 4, marginBottom: 4 },
  key: { width: BTN_SIZE, height: BTN_SIZE * 0.7, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: C.border },
  keyWide: { width: BTN_SIZE * 2 + 4 },
  keyOp: { borderColor: C.accent },
  keyAccent: { backgroundColor: C.accent, borderColor: C.accent },
  keyText: { fontFamily: MONO, fontSize: 24, color: C.fg, fontWeight: '300' },
  keyOpText: { color: C.accent },
});
