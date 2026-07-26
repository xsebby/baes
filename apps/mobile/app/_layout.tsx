import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider } from '../src/auth';
import { PlayerProvider } from '../src/player';

export default function RootLayout() {
  return (
    <AuthProvider>
      <PlayerProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: '#0b0b0f' },
            headerTintColor: '#fff',
            contentStyle: { backgroundColor: '#0b0b0f' },
          }}
        >
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="login" options={{ headerShown: false }} />
          <Stack.Screen name="home" options={{ title: 'baes' }} />
          <Stack.Screen name="admin" options={{ title: 'Admin' }} />
        </Stack>
      </PlayerProvider>
    </AuthProvider>
  );
}
