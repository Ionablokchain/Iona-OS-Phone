import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, FlatList, TextInput, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { C, MONO } from '@/src/theme';
import { api } from '@/src/utils/api';

export default function ConversationScreen() {
  const router = useRouter();
  const { contactId, contactName } = useLocalSearchParams<{ contactId: string; contactName: string }>();
  const [messages, setMessages] = useState<any[]>([]);
  const [text, setText] = useState('');
  const listRef = useRef<FlatList>(null);

  useEffect(() => {
    if (contactId) api.getMessages(contactId).then(setMessages).catch(() => {});
  }, [contactId]);

  const send = async () => {
    if (!text.trim() || !contactId) return;
    try {
      const msg = await api.sendMessage({ contact_id: contactId, text: text.trim(), direction: 'sent' });
      setMessages(prev => [...prev, msg]);
      setText('');
      setTimeout(() => listRef.current?.scrollToEnd(), 100);
    } catch {}
  };

  return (
    <SafeAreaView style={s.container} testID="conversation-screen">
      <View style={s.header}>
        <TouchableOpacity testID="convo-back" onPress={() => router.back()}>
          <Text style={s.backText}>{'< BACK'}</Text>
        </TouchableOpacity>
        <Text style={s.title}>{(contactName || 'CHAT').toUpperCase()}</Text>
        <View style={{ width: 60 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={item => item.id}
          contentContainerStyle={s.listContent}
          renderItem={({ item }) => (
            <View style={[s.msgRow, item.direction === 'sent' ? s.msgSent : s.msgReceived]} testID={`msg-${item.id}`}>
              <Text style={s.msgText}>{item.text}</Text>
              <Text style={s.msgTime}>{new Date(item.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</Text>
            </View>
          )}
          ListEmptyComponent={<Text style={s.empty}>NO MESSAGES YET</Text>}
          onContentSizeChange={() => listRef.current?.scrollToEnd()}
        />

        <View style={s.inputRow}>
          <TextInput
            testID="message-input"
            style={s.input}
            value={text}
            onChangeText={setText}
            placeholder="Type message..."
            placeholderTextColor={C.fgSecondary}
            returnKeyType="send"
            onSubmitEditing={send}
          />
          <TouchableOpacity testID="send-message-btn" style={s.sendBtn} onPress={send}>
            <Feather name="send" size={20} color={C.bg} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: C.border },
  backText: { fontFamily: MONO, fontSize: 12, color: C.fgSecondary, letterSpacing: 1 },
  title: { fontFamily: MONO, fontSize: 14, color: C.fg, letterSpacing: 4 },
  listContent: { padding: 16, gap: 8 },
  msgRow: { padding: 12, maxWidth: '80%' },
  msgSent: { alignSelf: 'flex-end', backgroundColor: 'rgba(255,75,0,0.1)', borderWidth: 1, borderColor: 'rgba(255,75,0,0.2)' },
  msgReceived: { alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: C.border },
  msgText: { fontSize: 15, color: C.fg },
  msgTime: { fontFamily: MONO, fontSize: 10, color: C.fgSecondary, marginTop: 4, textAlign: 'right' },
  empty: { fontFamily: MONO, fontSize: 14, color: C.fgSecondary, textAlign: 'center', marginTop: 40, letterSpacing: 2 },
  inputRow: { flexDirection: 'row', padding: 12, borderTopWidth: 1, borderTopColor: C.border, gap: 8 },
  input: { flex: 1, height: 48, borderWidth: 1, borderColor: C.border, paddingHorizontal: 12, color: C.fg, fontFamily: MONO, fontSize: 14 },
  sendBtn: { width: 48, height: 48, backgroundColor: C.accent, justifyContent: 'center', alignItems: 'center' },
});
