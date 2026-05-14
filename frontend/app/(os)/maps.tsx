import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, TextInput,
  Dimensions, ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import MapView, { Marker, Circle, PROVIDER_DEFAULT } from 'react-native-maps';
import * as Location from 'expo-location';
import { C, MONO } from '@/src/theme';

const { width: W, height: H } = Dimensions.get('window');

type POI = {
  id: string;
  name: string;
  type: string;
  icon: string;
  color: string;
  lat: number;
  lng: number;
};

// Quick place categories
const CATEGORIES = [
  { id: 'all',      label: 'All',       icon: 'grid',     color: C.fg },
  { id: 'food',     label: 'Food',      icon: 'coffee',   color: '#F59E0B' },
  { id: 'crypto',   label: 'Crypto',    icon: 'server',   color: C.accent },
  { id: 'transit',  label: 'Transit',   icon: 'map',      color: C.blue },
  { id: 'health',   label: 'Health',    icon: 'heart',    color: '#EF4444' },
];

export default function MapsScreen() {
  const router = useRouter();
  const mapRef = useRef<MapView>(null);
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [permissionStatus, setPermissionStatus] = useState<'loading' | 'granted' | 'denied'>('loading');
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');
  const [showSearch, setShowSearch] = useState(false);
  const [selectedPOI, setSelectedPOI] = useState<POI | null>(null);
  const [heading, setHeading] = useState(0);

  useEffect(() => {
    requestLocation();
  }, []);

  const requestLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { setPermissionStatus('denied'); return; }
      setPermissionStatus('granted');
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setLocation(loc);

      // Watch for updates
      Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, timeInterval: 5000, distanceInterval: 10 },
        (newLoc) => setLocation(newLoc)
      );

      // Watch heading
      Location.watchHeadingAsync((h) => setHeading(h.magHeading));
    } catch {
      setPermissionStatus('denied');
    }
  };

  const centerOnUser = () => {
    if (!location || !mapRef.current) return;
    mapRef.current.animateToRegion({
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      latitudeDelta: 0.01,
      longitudeDelta: 0.01,
    }, 600);
  };

  const region = location ? {
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
    latitudeDelta: 0.02,
    longitudeDelta: 0.02,
  } : {
    latitude: 48.8566,
    longitude: 2.3522,
    latitudeDelta: 0.05,
    longitudeDelta: 0.05,
  };

  const accuracy = location?.coords.accuracy ?? 0;

  if (permissionStatus === 'loading') {
    return (
      <SafeAreaView style={s.container}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Feather name="arrow-left" size={22} color={C.fgSecondary} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>Maps</Text>
          <View style={{ width: 22 }} />
        </View>
        <View style={s.center}>
          <ActivityIndicator size="large" color={C.accent} />
          <Text style={s.loadingText}>Getting your location...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (permissionStatus === 'denied') {
    return (
      <SafeAreaView style={s.container}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Feather name="arrow-left" size={22} color={C.fgSecondary} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>Maps</Text>
          <View style={{ width: 22 }} />
        </View>
        <View style={s.center}>
          <Feather name="map-off" size={48} color={C.fgSecondary} />
          <Text style={s.permTitle}>Location Access Required</Text>
          <Text style={s.permDesc}>IONA Maps needs location permission to show your position.</Text>
          <TouchableOpacity style={s.permBtn} onPress={requestLocation}>
            <Text style={s.permBtnText}>Grant Permission</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={s.container} testID="maps-screen">
      {/* Full-screen map */}
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        provider={PROVIDER_DEFAULT}
        initialRegion={region}
        showsUserLocation={true}
        showsMyLocationButton={false}
        showsCompass={false}
        userInterfaceStyle="dark"
        mapType="standard"
      >
        {/* Accuracy circle */}
        {location && accuracy > 0 && (
          <Circle
            center={{ latitude: location.coords.latitude, longitude: location.coords.longitude }}
            radius={accuracy}
            fillColor="rgba(255,75,0,0.08)"
            strokeColor="rgba(255,75,0,0.3)"
            strokeWidth={1}
          />
        )}
      </MapView>

      {/* Top overlay */}
      <SafeAreaView style={s.topOverlay} edges={['top']}>
        <View style={s.topBar}>
          <TouchableOpacity style={s.topBtn} onPress={() => router.back()}>
            <Feather name="arrow-left" size={20} color={C.fg} />
          </TouchableOpacity>

          {showSearch ? (
            <TextInput
              style={s.searchInput}
              value={search}
              onChangeText={setSearch}
              placeholder="Search places..."
              placeholderTextColor={C.fgSecondary}
              autoFocus
              returnKeyType="search"
              onBlur={() => { if (!search) setShowSearch(false); }}
            />
          ) : (
            <TouchableOpacity style={s.searchBar} onPress={() => setShowSearch(true)}>
              <Feather name="search" size={16} color={C.fgSecondary} />
              <Text style={s.searchPlaceholder}>Search places...</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity style={s.topBtn} onPress={() => setShowSearch(!showSearch)}>
            <Feather name={showSearch ? 'x' : 'sliders'} size={20} color={C.fg} />
          </TouchableOpacity>
        </View>

        {/* Categories */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.catScroll} contentContainerStyle={{ paddingHorizontal: 12 }}>
          {CATEGORIES.map(cat => (
            <TouchableOpacity
              key={cat.id}
              style={[s.catChip, activeCategory === cat.id && { backgroundColor: cat.color, borderColor: cat.color }]}
              onPress={() => setActiveCategory(cat.id)}
            >
              <Feather name={cat.icon as any} size={12} color={activeCategory === cat.id ? C.bg : C.fgSecondary} />
              <Text style={[s.catText, activeCategory === cat.id && { color: C.bg }]}>{cat.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </SafeAreaView>

      {/* Bottom overlay */}
      <View style={s.bottomOverlay}>
        {/* Location info card */}
        {location && (
          <View style={s.locationCard}>
            <View style={s.locationCardLeft}>
              <View style={s.locationDot} />
              <View>
                <Text style={s.locationTitle}>Your Location</Text>
                <Text style={s.locationCoords}>
                  {location.coords.latitude.toFixed(5)}, {location.coords.longitude.toFixed(5)}
                </Text>
                {accuracy > 0 && (
                  <Text style={s.locationAccuracy}>±{Math.round(accuracy)}m accuracy</Text>
                )}
              </View>
            </View>
            <View style={s.locationRight}>
              {location.coords.speed != null && location.coords.speed > 0 && (
                <Text style={s.speedText}>{Math.round(location.coords.speed * 3.6)} km/h</Text>
              )}
            </View>
          </View>
        )}

        {/* Center on me button */}
        <TouchableOpacity style={s.centerBtn} testID="maps-center" onPress={centerOnUser}>
          <Feather name="crosshair" size={22} color={C.accent} />
        </TouchableOpacity>
      </View>

      {/* Selected POI sheet */}
      {selectedPOI && (
        <View style={s.poiSheet}>
          <Text style={s.poiName}>{selectedPOI.name}</Text>
          <Text style={s.poiType}>{selectedPOI.type}</Text>
          <TouchableOpacity style={s.poiClose} onPress={() => setSelectedPOI(null)}>
            <Feather name="x" size={20} color={C.fgSecondary} />
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: C.bg },
  headerTitle: { fontSize: 16, fontWeight: '700', color: C.fg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  loadingText: { fontFamily: MONO, fontSize: 13, color: C.fgSecondary, marginTop: 16 },
  permTitle: { fontSize: 20, fontWeight: '700', color: C.fg, marginTop: 16, marginBottom: 8 },
  permDesc: { fontFamily: MONO, fontSize: 13, color: C.fgSecondary, textAlign: 'center', lineHeight: 20 },
  permBtn: { marginTop: 24, backgroundColor: C.accent, paddingHorizontal: 32, paddingVertical: 14, borderRadius: 0 },
  permBtnText: { fontFamily: MONO, fontSize: 13, color: C.fg, letterSpacing: 2 },
  // Top overlay
  topOverlay: { position: 'absolute', top: 0, left: 0, right: 0 },
  topBar: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 12, marginTop: 4, marginBottom: 8 },
  topBtn: { width: 40, height: 40, borderRadius: 0, backgroundColor: 'rgba(5,5,5,0.85)', justifyContent: 'center', alignItems: 'center' },
  searchBar: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(5,5,5,0.85)', borderRadius: 0, paddingHorizontal: 14, height: 40, marginHorizontal: 8 },
  searchInput: { flex: 1, backgroundColor: 'rgba(5,5,5,0.85)', borderRadius: 0, paddingHorizontal: 14, height: 40, color: C.fg, fontFamily: MONO, fontSize: 13, marginHorizontal: 8 },
  searchPlaceholder: { fontFamily: MONO, fontSize: 13, color: C.fgSecondary, marginLeft: 8 },
  catScroll: { marginBottom: 4 },
  catChip: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(5,5,5,0.85)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)', borderRadius: 0, paddingHorizontal: 12, paddingVertical: 6, marginRight: 8 },
  catText: { fontFamily: MONO, fontSize: 11, color: C.fgSecondary, marginLeft: 5, letterSpacing: 0.5 },
  // Bottom overlay
  bottomOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingHorizontal: 16, paddingBottom: 32 },
  locationCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: 'rgba(5,5,5,0.9)', borderRadius: 0, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  locationCardLeft: { flexDirection: 'row', alignItems: 'center' },
  locationDot: { width: 10, height: 10, borderRadius: 0, backgroundColor: C.accent, marginRight: 12 },
  locationTitle: { fontSize: 14, fontWeight: '700', color: C.fg },
  locationCoords: { fontFamily: MONO, fontSize: 11, color: C.fgSecondary, marginTop: 2 },
  locationAccuracy: { fontFamily: MONO, fontSize: 10, color: C.success, marginTop: 1 },
  locationRight: {},
  speedText: { fontFamily: MONO, fontSize: 18, color: C.fg, fontWeight: '600' },
  centerBtn: { alignSelf: 'flex-end', width: 48, height: 48, borderRadius: 0, backgroundColor: 'rgba(5,5,5,0.9)', justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,75,0,0.3)' },
  // POI sheet
  poiSheet: { position: 'absolute', bottom: 120, left: 16, right: 16, backgroundColor: 'rgba(18,18,18,0.96)', borderRadius: 0, padding: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  poiName: { fontSize: 16, fontWeight: '700', color: C.fg },
  poiType: { fontFamily: MONO, fontSize: 12, color: C.fgSecondary, marginTop: 4 },
  poiClose: { position: 'absolute', top: 12, right: 12 },
});
