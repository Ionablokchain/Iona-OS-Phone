import React, { useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ScrollView, Animated, PanResponder, Dimensions,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Feather } from '@expo/vector-icons';
import { useNotifications } from '@/src/context/NotificationsContext';
import { haptic } from '@/src/utils/haptics';
import { C, MONO } from '@/src/theme';

const { height: H } = Dimensions.get('window');

function timeAgo(date: Date): string {
  const diff = (Date.now() - date.getTime()) / 1000;
  if (diff < 60) return 'now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

type Props = {
  visible: boolean;
  onClose: () => void;
};

export function NotificationCenter({ visible, onClose }: Props) {
  const { notifications, unreadCount, markAllRead, clearAll, dismiss } = useNotifications();
  const translateY = useRef(new Animated.Value(-H)).current;

  React.useEffect(() => {
    if (visible) {
      haptic.selection();
      markAllRead();
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        tension: 65,
        friction: 11,
      }).start();
    } else {
      Animated.spring(translateY, {
        toValue: -H,
        useNativeDriver: true,
        tension: 80,
        friction: 12,
      }).start();
    }
  }, [visible]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => g.dy < -10,
      onPanResponderRelease: (_, g) => {
        if (g.dy < -40) { haptic.tap(); onClose(); }
      },
    })
  ).current;

  return (
    <Animated.View style={[s.overlay, { transform: [{ translateY }] }]}>
      <BlurView intensity={90} tint="dark" style={StyleSheet.absoluteFill} />
      <View style={s.container} {...panResponder.panHandlers}>
        {/* Handle */}
        <View style={s.handle} />

        {/* Header */}
        <View style={s.header}>
          <Text style={s.headerTitle}>Notifications</Text>
          <View style={s.headerActions}>
            {notifications.length > 0 && (
              <TouchableOpacity onPress={() => { haptic.tap(); clearAll(); }} style={s.headerBtn}>
                <Text style={s.headerBtnText}>Clear All</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={() => { haptic.tap(); onClose(); }} style={s.closeBtn}>
              <Feather name="x" size={20} color={C.fgSecondary} />
            </TouchableOpacity>
          </View>
        </View>

        {/* List */}
        <ScrollView style={s.list} showsVerticalScrollIndicator={false}>
          {notifications.length === 0 ? (
            <View style={s.empty}>
              <Feather name="bell-off" size={36} color={C.fgSecondary} />
              <Text style={s.emptyText}>No notifications</Text>
            </View>
          ) : (
            notifications.map(n => (
              <View key={n.id} style={s.notifItem}>
                <View style={[s.notifIcon, { backgroundColor: `${n.appColor}18`, borderColor: `${n.appColor}30` }]}>
                  <Feather name={n.appIcon as any} size={16} color={n.appColor} />
                </View>
                <View style={s.notifContent}>
                  <View style={s.notifTop}>
                    <Text style={s.notifApp}>{n.app}</Text>
                    <Text style={s.notifTime}>{timeAgo(n.time)}</Text>
                  </View>
                  <Text style={s.notifTitle}>{n.title}</Text>
                  <Text style={s.notifBody} numberOfLines={2}>{n.body}</Text>
                </View>
                <TouchableOpacity
                  style={s.dismissBtn}
                  onPress={() => { haptic.tap(); dismiss(n.id); }}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Feather name="x" size={14} color={C.fgSecondary} />
                </TouchableOpacity>
              </View>
            ))
          )}
          <View style={{ height: 40 }} />
        </ScrollView>
      </View>

      {/* Tap outside to close */}
      <TouchableOpacity style={s.backdrop} onPress={() => { haptic.tap(); onClose(); }} activeOpacity={1} />
    </Animated.View>
  );
}

const s = StyleSheet.create({
  overlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000,
  },
  backdrop: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 120 },
  container: {
    backgroundColor: 'rgba(10,10,10,0.85)',
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    paddingBottom: 20,
    maxHeight: H * 0.75,
    overflow: 'hidden',
  },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.2)', alignSelf: 'center', marginTop: 10, marginBottom: 4 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' },
  headerTitle: { fontSize: 20, fontWeight: '800', color: C.fg },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  headerBtn: { paddingHorizontal: 12, paddingVertical: 5, backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 0 },
  headerBtnText: { fontFamily: MONO, fontSize: 12, color: C.fgSecondary },
  closeBtn: { width: 32, height: 32, justifyContent: 'center', alignItems: 'center' },
  list: { maxHeight: H * 0.6 },
  notifItem: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.04)' },
  notifIcon: { width: 36, height: 36, borderRadius: 0, borderWidth: 1, justifyContent: 'center', alignItems: 'center', marginRight: 12, flexShrink: 0 },
  notifContent: { flex: 1 },
  notifTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  notifApp: { fontFamily: MONO, fontSize: 10, color: C.fgSecondary, letterSpacing: 1, textTransform: 'uppercase' },
  notifTime: { fontFamily: MONO, fontSize: 10, color: C.fgSecondary },
  notifTitle: { fontSize: 14, fontWeight: '600', color: C.fg },
  notifBody: { fontFamily: MONO, fontSize: 12, color: C.fgSecondary, marginTop: 2, lineHeight: 17 },
  dismissBtn: { padding: 4, marginLeft: 8, marginTop: 2 },
  empty: { alignItems: 'center', paddingVertical: 60 },
  emptyText: { fontFamily: MONO, fontSize: 13, color: C.fgSecondary, marginTop: 12 },
});
