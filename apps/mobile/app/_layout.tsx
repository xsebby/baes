import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider } from '../src/auth';
import { DownloadsProvider } from '../src/downloads';
import { PlayerProvider } from '../src/player';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <DownloadsProvider>
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
              <Stack.Screen name="home" options={{ title: 'bæs' }} />
              <Stack.Screen name="admin" options={{ title: 'Admin' }} />
              <Stack.Screen
                name="player"
                options={{ title: '', presentation: 'modal', headerShown: true }}
              />
              <Stack.Screen
                name="add-to-playlist"
                options={{ title: 'Add to…', presentation: 'modal', headerShown: true }}
              />
              <Stack.Screen name="liked" options={{ title: '' }} />
              <Stack.Screen name="downloads" options={{ title: '' }} />
            </Stack>
          </PlayerProvider>
        </DownloadsProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
