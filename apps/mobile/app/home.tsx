import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '../src/auth';

export default function Home() {
  const { user, serverUrl, signOut } = useAuth();

  async function handleSignOut() {
    await signOut();
    router.replace('/login');
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Welcome, {user?.username}</Text>
      <Text style={styles.meta}>
        {user?.role} · {serverUrl}
      </Text>
      <Text style={styles.placeholder}>
        Library, search, and the player land here in M2. The plumbing works — you're authenticated
        against your own server.
      </Text>
      <Pressable style={styles.button} onPress={handleSignOut}>
        <Text style={styles.buttonText}>Sign out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 12, backgroundColor: '#0b0b0f' },
  title: { color: '#fff', fontSize: 28, fontWeight: '800' },
  meta: { color: '#8ab4ff', fontSize: 14 },
  placeholder: { color: '#999', fontSize: 15, lineHeight: 22, marginTop: 12 },
  button: {
    marginTop: 'auto',
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#333',
  },
  buttonText: { color: '#ff6b6b', fontSize: 16, fontWeight: '600' },
});
