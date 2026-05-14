import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Image,
  FlatList, Dimensions, Alert, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { CameraView, CameraType, FlashMode, useCameraPermissions } from 'expo-camera';
import * as MediaLibrary from 'expo-media-library';
import { Feather } from '@expo/vector-icons';
import { C, MONO } from '@/src/theme';

const { width: W } = Dimensions.get('window');
const THUMB = (W - 4) / 3;

export default function CameraScreen() {
  const router = useRouter();
  const cameraRef = useRef<CameraView>(null);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [mediaPermission, requestMediaPermission] = MediaLibrary.usePermissions();
  const [facing, setFacing] = useState<CameraType>('back');
  const [flash, setFlash] = useState<FlashMode>('off');
  const [tab, setTab] = useState<'camera' | 'gallery'>('camera');
  const [photos, setPhotos] = useState<MediaLibrary.Asset[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [zoom, setZoom] = useState(0);

  useEffect(() => {
    if (tab === 'gallery') loadGallery();
  }, [tab]);

  const loadGallery = async () => {
    if (!mediaPermission?.granted) {
      const res = await requestMediaPermission();
      if (!res.granted) return;
    }
    const album = await MediaLibrary.getAssetsAsync({
      mediaType: 'photo',
      first: 60,
      sortBy: MediaLibrary.SortBy.creationTime,
    });
    setPhotos(album.assets);
  };

  const takePicture = async () => {
    if (!cameraRef.current || capturing) return;
    setCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.85 });
      if (photo) {
        setPreview(photo.uri);
        if (mediaPermission?.granted) {
          await MediaLibrary.saveToLibraryAsync(photo.uri);
        }
      }
    } catch (e) {
      Alert.alert('Error', 'Could not take photo');
    }
    setCapturing(false);
  };

  const flashIcon = flash === 'off' ? 'zap-off' : flash === 'on' ? 'zap' : 'zap';
  const flashColor = flash === 'off' ? C.fgSecondary : '#F59E0B';

  const cycleFlash = () => {
    setFlash(f => f === 'off' ? 'on' : f === 'on' ? 'auto' : 'off');
  };

  if (!cameraPermission) return <View style={s.container} />;

  if (!cameraPermission.granted) {
    return (
      <SafeAreaView style={s.container}>
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Feather name="arrow-left" size={22} color={C.fgSecondary} />
          </TouchableOpacity>
          <Text style={s.headerTitle}>Camera</Text>
          <View style={{ width: 22 }} />
        </View>
        <View style={s.permCenter}>
          <Feather name="camera-off" size={48} color={C.fgSecondary} />
          <Text style={s.permTitle}>Camera Access Required</Text>
          <Text style={s.permDesc}>IONA needs camera permission to take photos.</Text>
          <TouchableOpacity style={s.permBtn} onPress={requestCameraPermission}>
            <Text style={s.permBtnText}>Grant Permission</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.container} testID="camera-screen">
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity testID="camera-back" onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color={C.fgSecondary} />
        </TouchableOpacity>
        <View style={s.tabs}>
          <TouchableOpacity style={[s.tab, tab === 'camera' && s.tabActive]} onPress={() => setTab('camera')}>
            <Text style={[s.tabText, tab === 'camera' && s.tabTextActive]}>CAMERA</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[s.tab, tab === 'gallery' && s.tabActive]} onPress={() => setTab('gallery')}>
            <Text style={[s.tabText, tab === 'gallery' && s.tabTextActive]}>GALLERY</Text>
          </TouchableOpacity>
        </View>
        <View style={{ width: 22 }} />
      </View>

      {tab === 'camera' ? (
        <>
          {/* Viewfinder */}
          <View style={s.viewfinder}>
            <CameraView
              ref={cameraRef}
              style={StyleSheet.absoluteFill}
              facing={facing}
              flash={flash}
              zoom={zoom}
            />
            {/* Technical overlay */}
            <View style={s.crosshairH} />
            <View style={s.crosshairV} />
            <View style={[s.corner, s.tl]} />
            <View style={[s.corner, s.tr]} />
            <View style={[s.corner, s.bl]} />
            <View style={[s.corner, s.br]} />
            <View style={s.techOverlay}>
              <Text style={s.techText}>ISO 200</Text>
              <Text style={s.techText}>f/1.8</Text>
              <Text style={s.techText}>1/60s</Text>
              <Text style={s.techText}>{facing === 'back' ? '28mm' : '22mm'}</Text>
            </View>
            {/* Top controls inside viewfinder */}
            <View style={s.vfTopBar}>
              <TouchableOpacity testID="camera-flash" style={s.vfBtn} onPress={cycleFlash}>
                <Feather name={flashIcon as any} size={20} color={flashColor} />
                <Text style={[s.vfBtnText, { color: flashColor }]}>{flash.toUpperCase()}</Text>
              </TouchableOpacity>
              <TouchableOpacity testID="camera-zoom" style={s.vfBtn} onPress={() => setZoom(z => z > 0.5 ? 0 : z + 0.25)}>
                <Text style={s.vfBtnText}>{zoom === 0 ? '1×' : zoom === 0.25 ? '2×' : zoom === 0.5 ? '3×' : '4×'}</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Controls */}
          <View style={s.controls}>
            {/* Last photo thumbnail */}
            {photos.length > 0 ? (
              <TouchableOpacity style={s.thumbBtn} onPress={() => { setPreview(photos[0].uri); }}>
                <Image source={{ uri: photos[0].uri }} style={s.lastThumb} />
              </TouchableOpacity>
            ) : (
              <View style={s.thumbBtn} />
            )}

            {/* Shutter */}
            <TouchableOpacity testID="camera-shutter" style={[s.shutterBtn, capturing && s.shutterCapturing]} onPress={takePicture} activeOpacity={0.7}>
              <View style={s.shutterInner} />
            </TouchableOpacity>

            {/* Flip */}
            <TouchableOpacity testID="camera-flip" style={s.flipBtn} onPress={() => setFacing(f => f === 'back' ? 'front' : 'back')}>
              <Feather name="refresh-cw" size={24} color={C.fg} />
            </TouchableOpacity>
          </View>
        </>
      ) : (
        /* Gallery */
        <FlatList
          data={photos}
          keyExtractor={item => item.id}
          numColumns={3}
          style={{ flex: 1 }}
          ListEmptyComponent={
            <View style={s.emptyGallery}>
              <Feather name="image" size={40} color={C.fgSecondary} />
              <Text style={s.emptyText}>No photos yet</Text>
            </View>
          }
          renderItem={({ item }) => (
            <TouchableOpacity onPress={() => setPreview(item.uri)} activeOpacity={0.8}>
              <Image source={{ uri: item.uri }} style={{ width: THUMB, height: THUMB, margin: 0.5 }} />
            </TouchableOpacity>
          )}
        />
      )}

      {/* Full-screen photo preview modal */}
      <Modal visible={!!preview} transparent animationType="fade" onRequestClose={() => setPreview(null)}>
        <View style={s.previewOverlay}>
          <TouchableOpacity style={s.previewClose} onPress={() => setPreview(null)}>
            <Feather name="x" size={28} color={C.fg} />
          </TouchableOpacity>
          {preview && (
            <Image source={{ uri: preview }} style={s.previewImg} resizeMode="contain" />
          )}
          <View style={s.previewActions}>
            <TouchableOpacity style={s.previewBtn} onPress={() => setPreview(null)}>
              <Feather name="trash-2" size={20} color={C.error} />
              <Text style={[s.previewBtnText, { color: C.error }]}>Delete</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.previewBtn} onPress={() => setPreview(null)}>
              <Feather name="share-2" size={20} color={C.fg} />
              <Text style={s.previewBtnText}>Share</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10 },
  headerTitle: { fontSize: 16, fontWeight: '700', color: C.fg },
  tabs: { flexDirection: 'row' },
  tab: { paddingHorizontal: 12, paddingVertical: 4 },
  tabActive: { borderBottomWidth: 2, borderBottomColor: C.accent },
  tabText: { fontFamily: MONO, fontSize: 11, color: C.fgSecondary, letterSpacing: 2 },
  tabTextActive: { color: C.accent },
  viewfinder: { flex: 1, backgroundColor: '#000', overflow: 'hidden' },
  crosshairH: { position: 'absolute', width: '100%', height: 0.5, top: '50%', backgroundColor: 'rgba(255,255,255,0.15)' },
  crosshairV: { position: 'absolute', height: '100%', width: 0.5, left: '50%', backgroundColor: 'rgba(255,255,255,0.15)' },
  corner: { position: 'absolute', width: 36, height: 36, borderColor: 'rgba(255,255,255,0.7)' },
  tl: { top: 40, left: 20, borderTopWidth: 1.5, borderLeftWidth: 1.5 },
  tr: { top: 40, right: 20, borderTopWidth: 1.5, borderRightWidth: 1.5 },
  bl: { bottom: 10, left: 20, borderBottomWidth: 1.5, borderLeftWidth: 1.5 },
  br: { bottom: 10, right: 20, borderBottomWidth: 1.5, borderRightWidth: 1.5 },
  techOverlay: { position: 'absolute', bottom: 16, left: 20, gap: 2 },
  techText: { fontFamily: MONO, fontSize: 10, color: 'rgba(255,255,255,0.5)', letterSpacing: 1 },
  vfTopBar: { position: 'absolute', top: 12, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 20 },
  vfBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.4)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 0 },
  vfBtnText: { fontFamily: MONO, fontSize: 10, color: C.fg, marginLeft: 4, letterSpacing: 1 },
  controls: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', paddingVertical: 20, paddingHorizontal: 30, backgroundColor: C.bg },
  thumbBtn: { width: 52, height: 52 },
  lastThumb: { width: 52, height: 52, borderRadius: 0, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  shutterBtn: { width: 72, height: 72, borderRadius: 0, borderWidth: 3, borderColor: C.fg, justifyContent: 'center', alignItems: 'center' },
  shutterCapturing: { borderColor: C.accent },
  shutterInner: { width: 58, height: 58, borderRadius: 0, backgroundColor: C.fg },
  flipBtn: { width: 52, height: 52, justifyContent: 'center', alignItems: 'center' },
  permCenter: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32 },
  permTitle: { fontSize: 20, fontWeight: '700', color: C.fg, marginTop: 16, marginBottom: 8 },
  permDesc: { fontFamily: MONO, fontSize: 13, color: C.fgSecondary, textAlign: 'center', lineHeight: 20 },
  permBtn: { marginTop: 24, backgroundColor: C.accent, paddingHorizontal: 32, paddingVertical: 14, borderRadius: 0 },
  permBtnText: { fontFamily: MONO, fontSize: 13, color: C.fg, letterSpacing: 2 },
  emptyGallery: { flex: 1, alignItems: 'center', paddingTop: 80 },
  emptyText: { fontFamily: MONO, fontSize: 13, color: C.fgSecondary, marginTop: 12 },
  previewOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center' },
  previewClose: { position: 'absolute', top: 50, right: 20, zIndex: 10, padding: 8 },
  previewImg: { width: '100%', height: '80%' },
  previewActions: { position: 'absolute', bottom: 40, left: 0, right: 0, flexDirection: 'row', justifyContent: 'center' },
  previewBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.1)', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 0, marginHorizontal: 8 },
  previewBtnText: { fontFamily: MONO, fontSize: 13, color: C.fg, marginLeft: 8 },
});
