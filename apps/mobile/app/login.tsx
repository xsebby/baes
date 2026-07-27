import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '../src/auth';

export default function Login() {
  const { serverUrl, signIn } = useAuth();
  const [url, setUrl] = useState(serverUrl ?? '');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [firstRun, setFirstRun] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await signIn(url.trim(), username.trim(), password, firstRun);
      router.replace('/home');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  const canSubmit = url.trim().length > 0 && username.trim().length >= 2 && password.length >= 10;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.card}>
        <Text style={styles.logo}>bæs</Text>
        <Text style={styles.subtitle}>
          {firstRun ? 'Create the owner account' : 'Sign in to your server'}
        </Text>

        <TextInput
          style={styles.input}
          placeholder="Server URL (https://…)"
          placeholderTextColor="#666"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          value={url}
          onChangeText={setUrl}
        />
        <TextInput
          style={styles.input}
          placeholder="Username"
          placeholderTextColor="#666"
          autoCapitalize="none"
          autoCorrect={false}
          value={username}
          onChangeText={setUsername}
        />
        <TextInput
          style={styles.input}
          placeholder="Password (10+ characters)"
          placeholderTextColor="#666"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          style={[styles.button, (!canSubmit || busy) && styles.buttonDisabled]}
          disabled={!canSubmit || busy}
          onPress={submit}
        >
          {busy ? (
            <ActivityIndicator color="#000" />
          ) : (
            <Text style={styles.buttonText}>{firstRun ? 'Create & sign in' : 'Sign in'}</Text>
          )}
        </Pressable>

        <Pressable onPress={() => setFirstRun((v) => !v)}>
          <Text style={styles.toggle}>
            {firstRun ? 'Already set up? Sign in' : 'Fresh server? Create owner account'}
          </Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#0b0b0f' },
  card: { gap: 12 },
  logo: { color: '#fff', fontSize: 42, fontWeight: '800', textAlign: 'center' },
  subtitle: { color: '#999', fontSize: 15, textAlign: 'center', marginBottom: 12 },
  input: {
    backgroundColor: '#17171d',
    color: '#fff',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
  },
  error: { color: '#ff6b6b', textAlign: 'center' },
  button: {
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 4,
  },
  buttonDisabled: { opacity: 0.4 },
  buttonText: { color: '#000', fontSize: 16, fontWeight: '700' },
  toggle: { color: '#8ab4ff', textAlign: 'center', marginTop: 16, fontSize: 14 },
});
