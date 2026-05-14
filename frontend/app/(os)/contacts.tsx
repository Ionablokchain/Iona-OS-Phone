import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, FlatList,
  TextInput, Modal, KeyboardAvoidingView, Platform,
  Animated, RefreshControl, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { C, MONO } from '@/src/theme';
import { api } from '@/src/utils/api';
import { haptic } from '@/src/utils/haptics';

const AVATAR_COLORS = ['#FF4B00', '#00FF41', '#3B82F6', '#A855F7', '#F59E0B', '#EC4899', '#06B6D4', '#EF4444'];

type Contact = { id: string; name: string; phone: string; avatar_color: string; };
type ModalMode = 'add' | 'edit' | null;

function SwipeableContact({ item, onPress, onCall, onMessage, onDelete }: any) {
  const tx = useRef(new Animated.Value(0)).current;
  let startX = 0;

  const onTouchStart = (e: any) => { startX = e.nativeEvent.pageX; };
  const onTouchEnd = (e: any) => {
    const diff = startX - e.nativeEvent.pageX;
    if (diff > 60) {
      haptic.medium();
      Animated.spring(tx, { toValue: -90, useNativeDriver: true }).start();
    } else if (diff < -20) {
      Animated.spring(tx, { toValue: 0, useNativeDriver: true }).start();
    }
  };

  return (
    <View style={sc.row}>
      <View style={sc.actions}>
        <TouchableOpacity style={[sc.actionBtn, { backgroundColor: C.error }]} onPress={onDelete}>
          <Feather name="trash-2" size={18} color="#fff" />
        </TouchableOpacity>
      </View>
      <Animated.View style={{ transform: [{ translateX: tx }] }}>
        <TouchableOpacity
          style={sc.item}
          onPress={onPress}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
          activeOpacity={0.75}
        >
          <View style={[sc.avatar, { borderColor: item.avatar_color, backgroundColor: `${item.avatar_color}15` }]}>
            <Text style={[sc.avatarText, { color: item.avatar_color }]}>{item.name?.[0]?.toUpperCase() || '?'}</Text>
          </View>
          <View style={sc.info}>
            <Text style={sc.name}>{item.name}</Text>
            <Text style={sc.phone}>{item.phone}</Text>
          </View>
          <View style={sc.btnRow}>
            <TouchableOpacity style={sc.iconBtn} onPress={onMessage}>
              <Feather name="message-square" size={18} color={C.accent} />
            </TouchableOpacity>
            <TouchableOpacity style={[sc.iconBtn, sc.callIconBtn]} onPress={onCall}>
              <Feather name="phone" size={18} color={C.success} />
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const sc = StyleSheet.create({
  row: { position: 'relative', overflow: 'hidden' },
  actions: { position: 'absolute', right: 0, top: 0, bottom: 0, width: 90, flexDirection: 'row' },
  actionBtn: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  item: { flexDirection: 'row', alignItems: 'center', padding: 14, backgroundColor: C.bg, borderBottomWidth: 1, borderBottomColor: C.border },
  avatar: { width: 48, height: 48, borderRadius: 0, borderWidth: 1.5, justifyContent: 'center', alignItems: 'center', marginRight: 14 },
  avatarText: { fontFamily: MONO, fontSize: 20, fontWeight: '700' },
  info: { flex: 1 },
  name: { fontSize: 16, color: C.fg, fontWeight: '600' },
  phone: { fontFamily: MONO, fontSize: 12, color: C.fgSecondary, marginTop: 2 },
  btnRow: { flexDirection: 'row', gap: 8 },
  iconBtn: { width: 38, height: 38, borderRadius: 0, backgroundColor: 'rgba(255,75,0,0.1)', justifyContent: 'center', alignItems: 'center' },
  callIconBtn: { backgroundColor: 'rgba(0,255,65,0.1)' },
});

export default function ContactsScreen() {
  const router = useRouter();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [search, setSearch] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [editContact, setEditContact] = useState<Contact | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [avatarColor, setAvatarColor] = useState(AVATAR_COLORS[0]);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => { load(); }, []);

  const load = async () => {
    const c = await api.getContacts().catch(() => []);
    setContacts(c);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const openAdd = () => {
    haptic.tap();
    setName(''); setPhone(''); setAvatarColor(AVATAR_COLORS[0]);
    setEditContact(null);
    setModalMode('add');
  };

  const openEdit = (c: Contact) => {
    haptic.tap();
    setName(c.name); setPhone(c.phone); setAvatarColor(c.avatar_color);
    setEditContact(c);
    setModalMode('edit');
  };

  const saveContact = async () => {
    if (!name.trim() || !phone.trim()) return;
    haptic.medium();
    try {
      if (modalMode === 'edit' && editContact) {
        // Update locally (no edit endpoint, delete+recreate)
        await api.deleteContact(editContact.id);
        await api.createContact({ name: name.trim(), phone: phone.trim(), avatar_color: avatarColor });
      } else {
        await api.createContact({ name: name.trim(), phone: phone.trim(), avatar_color: avatarColor });
      }
      haptic.success();
      setModalMode(null);
      load();
    } catch { haptic.error(); }
  };

  const deleteContact = (c: Contact) => {
    haptic.medium();
    api.deleteContact(c.id).then(load).catch(() => {});
  };

  const filtered = search
    ? contacts.filter(c =>
        c.name.toLowerCase().includes(search.toLowerCase()) ||
        c.phone.includes(search)
      )
    : contacts;

  // Group alphabetically
  const grouped: { letter: string; data: Contact[] }[] = [];
  const sorted = [...filtered].sort((a, b) => a.name.localeCompare(b.name));
  sorted.forEach(c => {
    const letter = c.name[0]?.toUpperCase() || '#';
    const last = grouped[grouped.length - 1];
    if (last?.letter === letter) { last.data.push(c); }
    else { grouped.push({ letter, data: [c] }); }
  });

  const flatData: any[] = [];
  grouped.forEach(g => {
    flatData.push({ type: 'header', letter: g.letter });
    g.data.forEach(c => flatData.push({ type: 'contact', ...c }));
  });

  return (
    <SafeAreaView style={s.container} testID="contacts-screen">
      <View style={s.header}>
        <TouchableOpacity onPress={() => { haptic.tap(); router.back(); }}>
          <Feather name="arrow-left" size={22} color={C.fgSecondary} />
        </TouchableOpacity>
        <Text style={s.title}>CONTACTS</Text>
        <View style={s.headerRight}>
          <TouchableOpacity style={s.headerBtn} onPress={() => { haptic.tap(); setShowSearch(!showSearch); }}>
            <Feather name="search" size={20} color={C.fgSecondary} />
          </TouchableOpacity>
          <TouchableOpacity testID="add-contact-btn" style={s.headerBtn} onPress={openAdd}>
            <Feather name="user-plus" size={20} color={C.accent} />
          </TouchableOpacity>
        </View>
      </View>

      {showSearch && (
        <View style={s.searchBar}>
          <Feather name="search" size={16} color={C.fgSecondary} style={{ marginRight: 8 }} />
          <TextInput
            style={s.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Search contacts..."
            placeholderTextColor={C.fgSecondary}
            autoFocus
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')}>
              <Feather name="x" size={16} color={C.fgSecondary} />
            </TouchableOpacity>
          )}
        </View>
      )}

      <FlatList
        data={flatData}
        keyExtractor={(item, i) => item.type === 'header' ? `h-${item.letter}` : item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.accent} />}
        renderItem={({ item }) => {
          if (item.type === 'header') {
            return <Text style={s.sectionHeader}>{item.letter}</Text>;
          }
          return (
            <SwipeableContact
              item={item}
              onPress={() => openEdit(item)}
              onCall={() => { haptic.medium(); router.push({ pathname: '/(os)/phone' }); }}
              onMessage={() => { haptic.tap(); router.push({ pathname: '/(os)/conversation', params: { contactId: item.id, contactName: item.name } }); }}
              onDelete={() => deleteContact(item)}
            />
          );
        }}
        ListEmptyComponent={
          <View style={s.empty}>
            <Feather name="users" size={40} color={C.fgSecondary} />
            <Text style={s.emptyText}>{search ? 'No results' : 'NO CONTACTS'}</Text>
          </View>
        }
      />

      {/* Add/Edit Modal */}
      <Modal visible={!!modalMode} transparent animationType="slide" onRequestClose={() => setModalMode(null)}>
        <KeyboardAvoidingView style={s.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={s.modalContent}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>{modalMode === 'edit' ? 'EDIT CONTACT' : 'NEW CONTACT'}</Text>
              <TouchableOpacity onPress={() => { haptic.tap(); setModalMode(null); }}>
                <Feather name="x" size={24} color={C.fg} />
              </TouchableOpacity>
            </View>

            {/* Avatar preview */}
            <View style={s.avatarPreview}>
              <View style={[s.avatarBig, { borderColor: avatarColor, backgroundColor: `${avatarColor}15` }]}>
                <Text style={[s.avatarBigText, { color: avatarColor }]}>{name?.[0]?.toUpperCase() || '?'}</Text>
              </View>
            </View>

            {/* Color picker */}
            <View style={s.colorRow}>
              {AVATAR_COLORS.map(c => (
                <TouchableOpacity key={c} style={[s.colorDot, { backgroundColor: c }, avatarColor === c && s.colorDotActive]} onPress={() => { haptic.tap(); setAvatarColor(c); }} />
              ))}
            </View>

            <TextInput
              testID="contact-name-input"
              style={s.input}
              value={name}
              onChangeText={setName}
              placeholder="Full name"
              placeholderTextColor={C.fgSecondary}
              autoCapitalize="words"
            />
            <TextInput
              testID="contact-phone-input"
              style={s.input}
              value={phone}
              onChangeText={setPhone}
              placeholder="Phone number"
              placeholderTextColor={C.fgSecondary}
              keyboardType="phone-pad"
            />

            <TouchableOpacity
              testID="save-contact-btn"
              style={[s.saveBtn, (!name || !phone) && s.saveBtnDisabled]}
              onPress={saveContact}
              disabled={!name || !phone}
            >
              <Text style={s.saveBtnText}>{modalMode === 'edit' ? 'SAVE CHANGES' : 'ADD CONTACT'}</Text>
            </TouchableOpacity>
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
  headerRight: { flexDirection: 'row', gap: 4 },
  headerBtn: { width: 36, height: 36, justifyContent: 'center', alignItems: 'center' },
  searchBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.06)', marginHorizontal: 16, marginVertical: 8, borderRadius: 0, paddingHorizontal: 14, height: 44 },
  searchInput: { flex: 1, fontFamily: MONO, fontSize: 14, color: C.fg },
  sectionHeader: { fontFamily: MONO, fontSize: 11, color: C.accent, letterSpacing: 2, paddingHorizontal: 16, paddingVertical: 8, backgroundColor: 'rgba(255,75,0,0.05)' },
  empty: { alignItems: 'center', paddingTop: 80 },
  emptyText: { fontFamily: MONO, fontSize: 13, color: C.fgSecondary, marginTop: 14, letterSpacing: 1 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { fontFamily: MONO, fontSize: 15, color: C.fg, letterSpacing: 3 },
  avatarPreview: { alignItems: 'center', marginBottom: 16 },
  avatarBig: { width: 72, height: 72, borderRadius: 0, borderWidth: 2, justifyContent: 'center', alignItems: 'center' },
  avatarBigText: { fontFamily: MONO, fontSize: 30, fontWeight: '700' },
  colorRow: { flexDirection: 'row', justifyContent: 'center', gap: 10, marginBottom: 20 },
  colorDot: { width: 28, height: 28, borderRadius: 0 },
  colorDotActive: { borderWidth: 3, borderColor: '#fff' },
  input: { height: 52, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', borderRadius: 0, paddingHorizontal: 16, color: C.fg, fontFamily: MONO, fontSize: 15, marginBottom: 12, backgroundColor: 'rgba(255,255,255,0.04)' },
  saveBtn: { backgroundColor: C.accent, height: 52, borderRadius: 0, justifyContent: 'center', alignItems: 'center', marginTop: 4 },
  saveBtnDisabled: { opacity: 0.4 },
  saveBtnText: { fontFamily: MONO, fontSize: 14, color: C.fg, letterSpacing: 2 },
});
