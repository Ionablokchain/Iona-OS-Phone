import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  Modal, TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { C, MONO } from '@/src/theme';
import { haptic } from '@/src/utils/haptics';

const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

const EVENT_COLORS = ['#FF4B00', '#00FF41', '#3B82F6', '#A855F7', '#F59E0B', '#EC4899'];

type CalEvent = {
  id: string;
  title: string;
  date: string; // YYYY-MM-DD
  time: string;
  color: string;
  note: string;
};

const SEED_EVENTS: CalEvent[] = [
  { id: '1', title: 'IONA Node Sync', date: getDateStr(new Date()), time: '09:00', color: '#00FF41', note: 'Weekly validator check' },
  { id: '2', title: 'Kernel Build', date: getDateStr(addDays(new Date(), 2)), time: '14:00', color: '#FF4B00', note: 'v0.6.1 release build' },
  { id: '3', title: 'Team Sync', date: getDateStr(addDays(new Date(), 5)), time: '11:00', color: '#3B82F6', note: '' },
];

function getDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function addDays(d: Date, n: number) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

export default function CalendarScreen() {
  const router = useRouter();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());
  const [selectedDate, setSelectedDate] = useState(getDateStr(now));
  const [events, setEvents] = useState<CalEvent[]>(SEED_EVENTS);
  const [showModal, setShowModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newTime, setNewTime] = useState('09:00');
  const [newNote, setNewNote] = useState('');
  const [newColor, setNewColor] = useState(EVENT_COLORS[0]);

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDay = (new Date(year, month, 1).getDay() + 6) % 7;
  const today = now.getDate();
  const isCurrentMonth = month === now.getMonth() && year === now.getFullYear();

  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const prevMonth = () => {
    haptic.tap();
    if (month === 0) { setMonth(11); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    haptic.tap();
    if (month === 11) { setMonth(0); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  };

  const selectedEvents = events.filter(e => e.date === selectedDate);

  const hasEvent = (day: number) => {
    const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return events.some(e => e.date === ds);
  };

  const selectDay = (day: number) => {
    haptic.selection();
    const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    setSelectedDate(ds);
  };

  const addEvent = () => {
    if (!newTitle.trim()) return;
    haptic.success();
    setEvents(prev => [...prev, {
      id: String(Date.now()),
      title: newTitle.trim(),
      date: selectedDate,
      time: newTime,
      color: newColor,
      note: newNote.trim(),
    }]);
    setNewTitle(''); setNewTime('09:00'); setNewNote(''); setNewColor(EVENT_COLORS[0]);
    setShowModal(false);
  };

  const deleteEvent = (id: string) => {
    haptic.medium();
    setEvents(prev => prev.filter(e => e.id !== id));
  };

  const selectedDateObj = new Date(selectedDate + 'T12:00:00');
  const selectedLabel = selectedDateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <SafeAreaView style={s.container} testID="calendar-screen">
      <View style={s.header}>
        <TouchableOpacity onPress={() => { haptic.tap(); router.back(); }}>
          <Feather name="arrow-left" size={22} color={C.fgSecondary} />
        </TouchableOpacity>
        <Text style={s.title}>CALENDAR</Text>
        <TouchableOpacity onPress={() => { haptic.tap(); setShowModal(true); }}>
          <Feather name="plus" size={24} color={C.accent} />
        </TouchableOpacity>
      </View>

      {/* Month nav */}
      <View style={s.monthNav}>
        <TouchableOpacity testID="cal-prev" onPress={prevMonth} style={s.navBtn}>
          <Feather name="chevron-left" size={22} color={C.fg} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => { haptic.tap(); setMonth(now.getMonth()); setYear(now.getFullYear()); setSelectedDate(getDateStr(now)); }}>
          <Text style={s.monthText}>{MONTHS[month].toUpperCase()} {year}</Text>
        </TouchableOpacity>
        <TouchableOpacity testID="cal-next" onPress={nextMonth} style={s.navBtn}>
          <Feather name="chevron-right" size={22} color={C.fg} />
        </TouchableOpacity>
      </View>

      {/* Day headers */}
      <View style={s.dayHeaders}>
        {DAYS.map(d => (
          <View key={d} style={s.dayHeaderCell}>
            <Text style={s.dayHeaderText}>{d}</Text>
          </View>
        ))}
      </View>

      {/* Grid */}
      <View style={s.grid}>
        {cells.map((d, i) => {
          if (!d) return <View key={i} style={s.cell} />;
          const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
          const isToday = d === today && isCurrentMonth;
          const isSelected = ds === selectedDate;
          const eventsOnDay = events.filter(e => e.date === ds);

          return (
            <TouchableOpacity
              key={i}
              style={[s.cell, isSelected && !isToday && s.cellSelected, isToday && s.cellToday]}
              onPress={() => selectDay(d)}
              activeOpacity={0.7}
            >
              <Text style={[s.cellText, isToday && s.cellTextToday, isSelected && !isToday && s.cellTextSelected]}>
                {d}
              </Text>
              {eventsOnDay.length > 0 && (
                <View style={s.eventDots}>
                  {eventsOnDay.slice(0, 3).map((e, ei) => (
                    <View key={ei} style={[s.eventDot, { backgroundColor: e.color }]} />
                  ))}
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Selected day events */}
      <View style={s.eventsSection}>
        <View style={s.eventsSectionHeader}>
          <Text style={s.eventsSectionTitle}>{selectedLabel}</Text>
          <TouchableOpacity onPress={() => { haptic.tap(); setShowModal(true); }}>
            <Feather name="plus-circle" size={18} color={C.accent} />
          </TouchableOpacity>
        </View>

        <ScrollView style={s.eventsList} showsVerticalScrollIndicator={false}>
          {selectedEvents.length === 0 ? (
            <TouchableOpacity style={s.emptyDay} onPress={() => { haptic.tap(); setShowModal(true); }}>
              <Text style={s.emptyDayText}>No events · Tap to add</Text>
            </TouchableOpacity>
          ) : (
            selectedEvents.map(ev => (
              <View key={ev.id} style={[s.eventItem, { borderLeftColor: ev.color }]}>
                <View style={s.eventItemLeft}>
                  <Text style={s.eventTime}>{ev.time}</Text>
                  <Text style={s.eventTitle}>{ev.title}</Text>
                  {ev.note ? <Text style={s.eventNote}>{ev.note}</Text> : null}
                </View>
                <TouchableOpacity onPress={() => deleteEvent(ev.id)} style={s.eventDelete}>
                  <Feather name="x" size={16} color={C.fgSecondary} />
                </TouchableOpacity>
              </View>
            ))
          )}
        </ScrollView>
      </View>

      {/* Add event modal */}
      <Modal visible={showModal} transparent animationType="slide" onRequestClose={() => setShowModal(false)}>
        <KeyboardAvoidingView style={s.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={s.modalContent}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>NEW EVENT</Text>
              <TouchableOpacity onPress={() => { haptic.tap(); setShowModal(false); }}>
                <Feather name="x" size={22} color={C.fg} />
              </TouchableOpacity>
            </View>
            <Text style={s.modalDate}>{selectedLabel}</Text>

            <TextInput style={s.input} value={newTitle} onChangeText={setNewTitle}
              placeholder="Event title" placeholderTextColor={C.fgSecondary} autoFocus />
            <TextInput style={s.input} value={newTime} onChangeText={setNewTime}
              placeholder="Time (HH:MM)" placeholderTextColor={C.fgSecondary} keyboardType="numbers-and-punctuation" />
            <TextInput style={[s.input, s.inputNote]} value={newNote} onChangeText={setNewNote}
              placeholder="Notes (optional)" placeholderTextColor={C.fgSecondary} multiline />

            {/* Color picker */}
            <View style={s.colorRow}>
              {EVENT_COLORS.map(c => (
                <TouchableOpacity key={c} style={[s.colorDot, { backgroundColor: c }, newColor === c && s.colorDotActive]}
                  onPress={() => { haptic.tap(); setNewColor(c); }} />
              ))}
            </View>

            <TouchableOpacity style={[s.addBtn, !newTitle && s.addBtnDisabled]} onPress={addEvent} disabled={!newTitle}>
              <Text style={s.addBtnText}>ADD EVENT</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  title: { fontFamily: MONO, fontSize: 14, color: C.fg, letterSpacing: 4 },
  monthNav: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, marginBottom: 8 },
  navBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  monthText: { fontFamily: MONO, fontSize: 15, color: C.fg, letterSpacing: 2 },
  dayHeaders: { flexDirection: 'row', paddingHorizontal: 6 },
  dayHeaderCell: { flex: 1, alignItems: 'center', paddingVertical: 6 },
  dayHeaderText: { fontFamily: MONO, fontSize: 10, color: C.fgSecondary, letterSpacing: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 6 },
  cell: { width: '14.28%', aspectRatio: 0.9, justifyContent: 'flex-start', alignItems: 'center', paddingTop: 4 },
  cellToday: { backgroundColor: C.accent, borderRadius: 0 },
  cellSelected: { backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 0 },
  cellText: { fontFamily: MONO, fontSize: 14, color: C.fg },
  cellTextToday: { color: C.bg, fontWeight: '800' },
  cellTextSelected: { color: C.fg, fontWeight: '700' },
  eventDots: { flexDirection: 'row', gap: 2, marginTop: 2 },
  eventDot: { width: 4, height: 4, borderRadius: 2 },
  eventsSection: { flex: 1, marginTop: 8, paddingHorizontal: 16 },
  eventsSectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  eventsSectionTitle: { fontFamily: MONO, fontSize: 12, color: C.fgSecondary, letterSpacing: 1 },
  eventsList: { flex: 1 },
  emptyDay: { paddingVertical: 20, alignItems: 'center' },
  emptyDayText: { fontFamily: MONO, fontSize: 13, color: C.fgSecondary },
  eventItem: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 0, padding: 14, marginBottom: 8, borderLeftWidth: 3 },
  eventItemLeft: { flex: 1 },
  eventTime: { fontFamily: MONO, fontSize: 11, color: C.fgSecondary, letterSpacing: 1 },
  eventTitle: { fontSize: 15, fontWeight: '600', color: C.fg, marginTop: 2 },
  eventNote: { fontFamily: MONO, fontSize: 12, color: C.fgSecondary, marginTop: 3 },
  eventDelete: { padding: 4 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: C.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  modalTitle: { fontFamily: MONO, fontSize: 15, color: C.fg, letterSpacing: 3 },
  modalDate: { fontFamily: MONO, fontSize: 12, color: C.accent, marginBottom: 16, letterSpacing: 1 },
  input: { height: 50, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', borderRadius: 0, paddingHorizontal: 14, color: C.fg, fontFamily: MONO, fontSize: 14, marginBottom: 10, backgroundColor: 'rgba(255,255,255,0.04)' },
  inputNote: { height: 70, paddingTop: 12, textAlignVertical: 'top' },
  colorRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  colorDot: { width: 28, height: 28, borderRadius: 0 },
  colorDotActive: { borderWidth: 3, borderColor: '#fff' },
  addBtn: { backgroundColor: C.accent, height: 52, borderRadius: 0, justifyContent: 'center', alignItems: 'center' },
  addBtnDisabled: { opacity: 0.4 },
  addBtnText: { fontFamily: MONO, fontSize: 14, color: C.fg, letterSpacing: 2 },
});
