import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import * as SystemUI from 'expo-system-ui';
import * as NavigationBar from 'expo-navigation-bar';
import { Platform } from 'react-native';
import { AuthProvider } from '@/src/context/AuthContext';
import { MusicProvider } from '@/src/context/MusicContext';
import { NotificationsProvider } from '@/src/context/NotificationsContext';
import { SystemBridgeProvider } from '@/src/context/SystemBridgeContext';

export default function RootLayout() {
  useEffect(() => {
    // Force fully dark system UI on Android
    SystemUI.setBackgroundColorAsync('#050505');
    if (Platform.OS === 'android') {
      try {
        NavigationBar.setBackgroundColorAsync('#050505');
        NavigationBar.setButtonStyleAsync('light');
      } catch {}
    }
  }, []);

  return (
    <AuthProvider>
      <MusicProvider>
        <NotificationsProvider>
          <SystemBridgeProvider>
            <StatusBar style="light" backgroundColor="#050505" translucent={false} />
            <Stack screenOptions={{ headerShown: false, animation: 'none', contentStyle: { backgroundColor: '#050505' } }}>
              <Stack.Screen name="index" />
              <Stack.Screen name="onboarding" options={{ animation: 'fade', animationDuration: 300 }} />
              <Stack.Screen name="(os)" />
            </Stack>
          </SystemBridgeProvider>
        </NotificationsProvider>
      </MusicProvider>
    </AuthProvider>
  );
}
