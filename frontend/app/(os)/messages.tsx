import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList,
  TextInput, Animated, RefreshControl, Modal,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { C, MONO } from '@/src/theme';
import { api } from '@/src/utils/api';
import { haptic } from '@/src/utils/haptics';

type Convo = {
  contact_id: string;
  contact_name: string;
  last_message: string;
  last_time: string;
  unread: number;
};

function SwipeableConvo({ item, onPress, onDelete }: { item: Convo; onPress: () => void; onDelete: () => void }) {
  const translateX = useRef(new Animated.Value(0)).current;
  let startX = 0;

  const onTouchStart = (e: any) => { startX = e.nativeEvent.pageX; };
  const onTouchEnd = (e: any) => {
    const diff = startX - e.nativeEvent.pageX;
    if (diff > 60) {
      haptic.medium();
      Animated.spring(translateX, { toValue: -80, useNativeDriver: true }).start();
    } else if (diff < -20) {
      Animated.spring(translateX, { toValue: 0, useNativeDriver: true }).start();
    }
  };

  return (
    <View style={sr.row}>
      <View style={sr.deleteAction}>
        <TouchableOpacity style={sr.deleteBtn} onPress={onDelete}>
          <Feather name="trash-2" size={20} color="#fff" />
          <Text style={sr.deleteText}>Delete</Text>
        </TouchableOpacity>
      </View>
      <Animated.View style={{ transform: [{ translateX }] }}>
        <TouchableOpacity
          style={sr.convoItem}
          onPress={onPress}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
          activeOpacity={0.7}
        >
          <View style={[sr.avatar, { borderColor: '#FF4B00' }]}>
            <Text style={sr.avatarText}>{item.contact_name?.[0]?.toUpperCase() || '?'}</Text>
          </View>
          <View style={sr.convoInfo}>
            <View style={sr.convoTop}>
              <Text style={sr.convoName}>{item.contact_name}</Text>
              <Text style={sr.convoTime}>
                {item.last_time
                  ? new Date(item.last_time).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
                  : ''}
              </Text>
            </View>
            <View style={sr.convoBottom}>
              <Text style={sr.convoLast} numberOfLines={1}>{item.last_message}</Text>
              {item.unread > 0 && (
                <View style={sr.badge}><Text style={sr.badgeText}>{item.unread}</Text></View>
              )}
            </View>
          </View>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const sr = StyleSheet.create({
  row: { position: 'relative', overflow: 'hidden' },
  deleteAction: { position: 'absolute', right: 0, top: 0, bottom: 0, width: 80, backgroundColor: C.error, justifyContent: 'center', alignItems: 'center' },
  deleteBtn: { alignItems: 'center', gap: 4 },
  deleteText: { fontFamily: MONO, fontSize: 10, color: '#fff' },
  convoItem: { flexDirection: 'row', alignItems: 'center', padding: 16, backgroundColor: C.bg, borderBottomWidth: 1, borderBottomColor: C.border },
  avatar: { width: 48, height: 48, borderRadius: 0, borderWidth: 1.5, justifyContent: 'center', alignItems: 'center', marginRight: 14, backgroundColor: 'rgba(255,75,0,0.08)' },
  avatarText: { fontFamily: MONO, fontSize: 20, color: C.accent, fontWeight: '700' },
  convoInfo: { flex: 1 },
  convoTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  convoName: { fontSize: 16, color: C.fg, fontWeight: '700' },
  convoTime: { fontFamily: MONO, fontSize: 11, color: C.fgSecondary },
  convoBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  convoLast: { fontFamily: MONO, fontSize: 13, color: C.fgSecondary, flex: 1, marginRight: 8 },
  badge: { backgroundColor: C.accent, minWidth: 20, height: 20, borderRadius: 0, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 5 },
  badgeText: { fontFamily: MONO, fontSize: 11, color: C.fg, fontWeight: '700' },
});

export default function MessagesScreen() {
  const router = useRouter();
  const [convos, setConvos] = useState<Convo[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [showNewMsg, setShowNewMsg] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => { load(); }, []);

  const load = async () => {
    const [c, ct] = await Promise.all([
      api.getConversations().catch(() => []),
      api.getContacts().catch(() => []),
    ]);
    setConvos(c);
    setContacts(ct);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const filtered = searchQuery
    ? convos.filter(c =>
        c.contact_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.last_message.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : convos;

  const deleteConvo = (contactId: string) => {
    haptic.medium();
    setConvos(prev => prev.filter(c => c.contact_id !== contactId));
  };

  const openConvo = (item: Convo) => {
    haptic.tap();
    router.push({ pathname: '/(os)/conversation', params: { contactId: item.contact_id, contactName: item.contact_name } });
  };

  const startNewConvo = (contact: any) => {
    haptic.tap();
    setShowNewMsg(false);
    router.push({ pathname: '/(os)/conversation', params: { contactId: contact.id, contactName: contact.name } });
  };

  return (
    <SafeAreaView style={s.container} testID="messages-screen">
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => { haptic.tap(); router.back(); }}>
          <Feather name="arrow-left" size={22} color={C.fgSecondary} />
        </TouchableOpacity>
        <Text style={s.title}>MESSAGES</Text>
        <View style={s.headerRight}>
          <TouchableOpacity onPress={() => { haptic.tap(); setShowSearch(!showSearch); }} style={s.headerBtn}>
            <Feather name="search" size={20} color={C.fgSecondary} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { haptic.tap(); setShowNewMsg(true); }} style={s.headerBtn}>
            <Feather name="edit" size={20} color={C.accent} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Search bar */}
      {showSearch && (
        <View style={s.searchBar}>
          <Feather name="search" size={16} color={C.fgSecondary} style={{ marginRight: 8 }} />
          <TextInput
            style={s.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search messages..."
            placeholderTextColor={C.fgSecondary}
            autoFocus
            autoCapitalize="none"
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Feather name="x" size={16} color={C.fgSecondary} />
            </TouchableOpacity>
          )}
        </View>
      )}

      <FlatList
        data={filtered}
        keyExtractor={item => item.contact_id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}
        renderItem={({ item }) => (
          <SwipeableConvo
            item={item}
            onPress={() => openConvo(item)}
            onDelete={() => deleteConvo(item.contact_id)}
          />
        )}
        ListEmptyComponent={
          <View style={s.empty}>
            <Feather name="message-square" size={40} color={C.fgSecondary} />
            <Text style={s.emptyText}>
              {searchQuery ? `No results for "${searchQuery}"` : 'NO MESSAGES'}
            </Text>
            {!searchQuery && (
              <TouchableOpacity style={s.emptyBtn} onPress={() => { haptic.tap(); setShowNewMsg(true); }}>
                <Text style={s.emptyBtnText}>Start a conversation</Text>
              </TouchableOpacity>
            )}
          </View>
        }
      />

      {/* New message modal */}
      <Modal visible={showNewMsg} transparent animationType="slide" onRequestClose={() => setShowNewMsg(false)}>
        <KeyboardAvoidingView style={s.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={s.modalContent}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>NEW MESSAGE</Text>
              <TouchableOpacity onPress={() => { haptic.tap(); setShowNewMsg(false); }}>
                <Feather name="x" size={24} color={C.fg} />
              </TouchableOpacity>
            </View>
            <Text style={s.modalSub}>Choose a contact</Text>
            {contacts.map(c => (
              <TouchableOpacity key={c.id} style={s.contactItem} onPress={() => startNewConvo(c)}>
                <View style={[s.contactAvatar, { borderColor: c.avatar_color || C.accent }]}>
                  <Text style={[s.contactAvatarText, { color: c.avatar_color || C.accent }]}>
                    {c.name?.[0]?.toUpperCase() || '?'}
                  </Text>
                </View>
                <View>
                  <Text style={s.contactName}>{c.name}</Text>
                  <Text style={s.contactPhone}>{c.phone}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  title: { fontFamily: MONO, fontSize: 14, color: C.fg, letterSpacing: 4 },
  headerRight: { flexDirection: 'row', gap: 8 },
  headerBtn: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center' },
  searchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.06)', marginHorizontal: 16, marginVertical: 8, borderRadius: 0, paddingHorizontal: 14, height: 44 },
  searchInput: { flex: 1, fontFamily: MONO, fontSize: 14, color: C.fg },
  empty: { alignItems: 'center', paddingTop: 80 },
  emptyText: { fontFamily: MONO, fontSize: 13, color: C.fgSecondary, marginTop: 14, letterSpacing: 1 },
  emptyBtn: { marginTop: 20, backgroundColor: C.accent, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 0 },
  emptyBtnText: { fontFamily: MONO, fontSize: 13, color: C.fg },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, maxHeight: '70%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  modalTitle: { fontFamily: MONO, fontSize: 15, color: C.fg, letterSpacing: 3 },
  modalSub: { fontFamily: MONO, fontSize: 11, color: C.fgSecondary, letterSpacing: 1, marginBottom: 16 },
  contactItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  contactAvatar: { width: 40, height: 40, borderRadius: 0, borderWidth: 1.5, justifyContent: 'center', alignItems: 'center', marginRight: 14 },
  contactAvatarText: { fontFamily: MONO, fontSize: 16, fontWeight: '700' },
  contactName: { fontSize: 15, color: C.fg, fontWeight: '600' },
  contactPhone: { fontFamily: MONO, fontSize: 12, color: C.fgSecondary, marginTop: 1 },
});
