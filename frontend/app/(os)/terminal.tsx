import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, TextInput,
  FlatList, KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { C, MONO } from '@/src/theme';
import { api } from '@/src/utils/api';
import { haptic } from '@/src/utils/haptics';

type Line = {
  id: string;
  text: string;
  type: 'input' | 'output' | 'error' | 'system' | 'pending';
};

let _lineId = 100;
const mkLine = (text: string, type: Line['type']): Line => ({
  id: String(++_lineId),
  text,
  type,
});

export default function TerminalScreen() {
  const router = useRouter();
  const [lines, setLines] = useState<Line[]>([
    mkLine('  IONA OS Terminal v0.6.0', 'system'),
    mkLine('  Kernel: x86_64 bare-metal Rust', 'system'),
    mkLine('  Backend: connected — real execution mode', 'system'),
    mkLine('  Type "help" for commands\n', 'system'),
  ]);
  const [input, setInput] = useState('');
  const [cwd, setCwd] = useState('/home/iona');
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const [executing, setExecuting] = useState(false);
  const listRef = useRef<FlatList>(null);

  const scrollToEnd = () => setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);

  const addLines = (newLines: Line[]) => {
    setLines(prev => [...prev, ...newLines]);
    scrollToEnd();
  };

  const execCommand = async (raw: string) => {
    const cmd = raw.trim();
    if (!cmd) return;

    haptic.tap();
    setHistory(h => [cmd, ...h.slice(0, 49)]);
    setHistIdx(-1);
    setInput('');

    const inputLine = mkLine(`${cwd}$ ${cmd}`, 'input');

    if (cmd === 'clear') {
      setLines([mkLine('  Terminal cleared.\n', 'system')]);
      scrollToEnd();
      return;
    }

    setLines(prev => [...prev, inputLine, mkLine('', 'pending')]);
    scrollToEnd();
    setExecuting(true);

    try {
      const res = await api.execTerminalCommand(cmd, cwd);

      setLines(prev => {
        // Remove pending line
        const filtered = prev.filter(l => l.type !== 'pending');
        const newLines: Line[] = [];

        if (res.output === '__CLEAR__') {
          return [mkLine('  Terminal cleared.\n', 'system')];
        }

        if (res.output) {
          const type = res.exit_code !== 0 ? 'error' : 'output';
          newLines.push(mkLine(res.output, type));
        }

        if (res.cwd && res.cwd !== cwd) {
          setCwd(res.cwd);
        }

        return [...filtered, ...newLines];
      });
    } catch (e: any) {
      setLines(prev => [
        ...prev.filter(l => l.type !== 'pending'),
        mkLine(`Error: ${e.message || 'Backend unreachable'}`, 'error'),
      ]);
    }

    setExecuting(false);
    scrollToEnd();
  };

  const handleKeyPress = (key: string) => {
    if (key === 'ArrowUp') {
      const idx = Math.min(histIdx + 1, history.length - 1);
      setHistIdx(idx);
      setInput(history[idx] || '');
    } else if (key === 'ArrowDown') {
      const idx = Math.max(histIdx - 1, -1);
      setHistIdx(idx);
      setInput(idx === -1 ? '' : history[idx]);
    }
  };

  const colorFor = (type: Line['type']): string => {
    switch (type) {
      case 'input': return C.success;
      case 'error': return C.error;
      case 'system': return C.accent;
      case 'pending': return C.fgSecondary;
      default: return C.fg;
    }
  };

  const renderItem = ({ item }: { item: Line }) => {
    if (item.type === 'pending') {
      return (
        <View style={t.pendingRow}>
          <ActivityIndicator size="small" color={C.fgSecondary} />
          <Text style={[t.line, { color: C.fgSecondary, marginLeft: 8 }]}>executing...</Text>
        </View>
      );
    }
    return (
      <Text style={[t.line, { color: colorFor(item.type) }]} selectable>
        {item.text}
      </Text>
    );
  };

  const prompt = `${cwd.replace('/home/iona', '~')}$`;

  return (
    <SafeAreaView style={t.container} testID="terminal-screen">
      {/* Header */}
      <View style={t.header}>
        <TouchableOpacity testID="terminal-back" onPress={() => { haptic.tap(); router.back(); }}>
          <Feather name="arrow-left" size={22} color={C.fgSecondary} />
        </TouchableOpacity>
        <View style={t.headerCenter}>
          <View style={t.headerDot} />
          <Text style={t.title}>IONA TERMINAL</Text>
        </View>
        <TouchableOpacity
          testID="terminal-clear"
          onPress={() => { haptic.tap(); setLines([mkLine('  Terminal cleared.\n', 'system')]); }}
        >
          <Feather name="trash-2" size={18} color={C.fgSecondary} />
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        {/* Output */}
        <FlatList
          ref={listRef}
          data={lines}
          keyExtractor={item => item.id}
          style={t.output}
          contentContainerStyle={t.outputContent}
          renderItem={renderItem}
          onContentSizeChange={scrollToEnd}
          showsVerticalScrollIndicator={false}
        />

        {/* Quick command bar */}
        <View style={t.quickBar}>
          {['agent status', 'stability', 'thermal', 'peers', 'security'].map(cmd => (
            <TouchableOpacity
              key={cmd}
              style={t.quickBtn}
              onPress={() => execCommand(cmd)}
              disabled={executing}
            >
              <Text style={t.quickText}>{cmd}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Input row */}
        <View style={t.inputRow}>
          <Text style={t.promptText}>{prompt}</Text>
          <TextInput
            testID="terminal-input"
            style={t.input}
            value={input}
            onChangeText={setInput}
            placeholder="enter command..."
            placeholderTextColor="rgba(255,255,255,0.15)"
            returnKeyType="go"
            onSubmitEditing={() => execCommand(input)}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!executing}
          />
          <TouchableOpacity
            testID="terminal-run"
            style={[t.runBtn, executing && { opacity: 0.5 }]}
            onPress={() => execCommand(input)}
            disabled={executing}
          >
            {executing
              ? <ActivityIndicator size="small" color={C.bg} />
              : <Feather name="play" size={14} color={C.bg} />
            }
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const t = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#080808' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: 'rgba(0,255,65,0.12)',
  },
  headerCenter: { flexDirection: 'row', alignItems: 'center' },
  headerDot: { width: 8, height: 8, borderRadius: 0, backgroundColor: C.success, marginRight: 8 },
  title: { fontFamily: MONO, fontSize: 12, color: C.success, letterSpacing: 3 },
  output: { flex: 1 },
  outputContent: { padding: 12, paddingBottom: 4 },
  line: { fontFamily: MONO, fontSize: 12, lineHeight: 19 },
  pendingRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  quickBar: {
    flexDirection: 'row', paddingHorizontal: 10, paddingVertical: 6,
    gap: 6, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.04)',
    flexWrap: 'wrap',
  },
  quickBtn: {
    backgroundColor: 'rgba(0,255,65,0.08)', borderWidth: 1,
    borderColor: 'rgba(0,255,65,0.15)', borderRadius: 0,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  quickText: { fontFamily: MONO, fontSize: 10, color: C.success },
  inputRow: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10,
    paddingVertical: 8, borderTopWidth: 1,
    borderTopColor: 'rgba(0,255,65,0.12)',
    backgroundColor: 'rgba(0,255,65,0.02)',
  },
  promptText: { fontFamily: MONO, fontSize: 12, color: C.success, marginRight: 6, fontWeight: '700' },
  input: { flex: 1, fontFamily: MONO, fontSize: 13, color: C.fg, height: 40 },
  runBtn: {
    width: 34, height: 34, borderRadius: 0,
    backgroundColor: C.success, justifyContent: 'center', alignItems: 'center',
  },
});
