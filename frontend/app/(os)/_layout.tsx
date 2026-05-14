import { Stack } from 'expo-router';

export default function OSLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        animationDuration: 280,
        contentStyle: { backgroundColor: '#050505' },
        gestureEnabled: true,
        gestureDirection: 'horizontal',
        fullScreenGestureEnabled: true,
      }}
    >
      <Stack.Screen name="home" options={{ animation: 'fade', animationDuration: 200, gestureEnabled: false }} />
      <Stack.Screen name="phone" />
      <Stack.Screen name="messages" />
      <Stack.Screen name="conversation" />
      <Stack.Screen name="wallet" />
      <Stack.Screen name="contacts" />
      <Stack.Screen name="calculator" options={{ animation: 'slide_from_bottom', animationDuration: 320 }} />
      <Stack.Screen name="calendar" />
      <Stack.Screen name="settings" options={{ animation: 'slide_from_bottom', animationDuration: 320 }} />
      <Stack.Screen name="camera" options={{ animation: 'fade', animationDuration: 200 }} />
      <Stack.Screen name="nodes" />
      <Stack.Screen name="game" options={{ animation: 'slide_from_bottom', animationDuration: 320 }} />
      <Stack.Screen name="terminal" options={{ animation: 'slide_from_bottom', animationDuration: 320 }} />
      <Stack.Screen name="browser" />
      <Stack.Screen name="music" options={{ animation: 'slide_from_bottom', animationDuration: 380 }} />
      <Stack.Screen name="maps" />
    </Stack>
  );
}
