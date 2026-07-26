import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import type { LibraryRoot, ScanStatus } from '@baes/core';
import { useAuth } from '../src/auth';

export default function Admin() {
  const { client, signOut } = useAuth();
  const [roots, setRoots] = useState<LibraryRoot[]>([]);
  const [newPath, setNewPath] = useState('');
  const [scan, setScan] = useState<ScanStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    if (!client) return;
    try {
      const [rootsRes, scanRes] = await Promise.all([client.listRoots(), client.scanStatus()]);
      setRoots(rootsRes.roots.filter((r) => r.enabled));
      setScan(scanRes);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    }
  }, [client]);

  useEffect(() => {
    refresh();
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, [refresh]);

  // Poll while a scan runs so the counters tick live.
  useEffect(() => {
    if (scan?.running && !pollTimer.current) {
      pollTimer.current = setInterval(refresh, 1500);
    } else if (!scan?.running && pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }, [scan?.running, refresh]);

  async function addRoot() {
    if (!client || !newPath.trim()) return;
    setError(null);
    try {
      await client.addRoot(newPath.trim());
      setNewPath('');
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add root');
    }
  }

  async function removeRoot(root: LibraryRoot) {
    Alert.alert('Remove root?', root.path, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          await client?.removeRoot(root.id);
          refresh();
        },
      },
    ]);
  }

  async function startScan() {
    if (!client) return;
    setError(null);
    try {
      setScan(await client.startScan());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start scan');
    }
  }

  async function handleSignOut() {
    await signOut();
    router.replace('/login');
  }

  return (
    <View style={styles.container}>
      <Text style={styles.section}>Library roots</Text>
      <Text style={styles.hint}>
        Folders on the server machine that hold your music, e.g. /Users/you/Music/unreleased
      </Text>
      <View style={styles.addRow}>
        <TextInput
          style={styles.input}
          placeholder="/path/on/server"
          placeholderTextColor="#666"
          autoCapitalize="none"
          autoCorrect={false}
          value={newPath}
          onChangeText={setNewPath}
        />
        <Pressable style={styles.addButton} onPress={addRoot}>
          <Text style={styles.addButtonText}>Add</Text>
        </Pressable>
      </View>

      <FlatList
        data={roots}
        keyExtractor={(r) => r.id}
        style={{ flexGrow: 0 }}
        ListEmptyComponent={<Text style={styles.emptyText}>No roots yet</Text>}
        renderItem={({ item }) => (
          <View style={styles.rootRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rootPath} numberOfLines={1}>
                {item.path}
              </Text>
              <Text style={styles.rootMeta}>
                {item.lastScanAt
                  ? `Last scan ${new Date(item.lastScanAt).toLocaleString()}`
                  : 'Never scanned'}
              </Text>
            </View>
            <Pressable onPress={() => removeRoot(item)} hitSlop={8}>
              <Text style={styles.remove}>✕</Text>
            </Pressable>
          </View>
        )}
      />

      <Text style={styles.section}>Scan</Text>
      {scan && (
        <Text style={styles.scanStatus}>
          {scan.running
            ? `Scanning… ${scan.scanned} files (${scan.added} new, ${scan.updated} updated)`
            : scan.startedAt
              ? `Last scan: ${scan.scanned} scanned, ${scan.added} added, ${scan.updated} updated, ${scan.removed} removed${scan.errors.length ? `, ${scan.errors.length} errors` : ''}`
              : 'No scan yet'}
        </Text>
      )}
      {scan?.errors.slice(0, 3).map((e, i) => (
        <Text key={i} style={styles.scanError} numberOfLines={1}>
          {e.file}: {e.message}
        </Text>
      ))}
      <Pressable
        style={[styles.scanButton, scan?.running && styles.buttonDisabled]}
        disabled={scan?.running}
        onPress={startScan}
      >
        <Text style={styles.scanButtonText}>{scan?.running ? 'Scanning…' : 'Scan now'}</Text>
      </Pressable>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <Pressable style={styles.signOut} onPress={handleSignOut}>
        <Text style={styles.signOutText}>Sign out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0b0f', padding: 16 },
  section: { color: '#fff', fontSize: 18, fontWeight: '700', marginTop: 16, marginBottom: 6 },
  hint: { color: '#777', fontSize: 13, marginBottom: 10, lineHeight: 18 },
  addRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  input: {
    flex: 1,
    backgroundColor: '#17171d',
    color: '#fff',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
  },
  addButton: {
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingHorizontal: 18,
    justifyContent: 'center',
  },
  addButtonText: { color: '#000', fontWeight: '700' },
  emptyText: { color: '#666', fontSize: 14, paddingVertical: 8 },
  rootRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#222',
  },
  rootPath: { color: '#fff', fontSize: 14 },
  rootMeta: { color: '#777', fontSize: 12, marginTop: 2 },
  remove: { color: '#ff6b6b', fontSize: 16 },
  scanStatus: { color: '#aaa', fontSize: 14, marginBottom: 8, lineHeight: 20 },
  scanError: { color: '#ff9f6b', fontSize: 12 },
  scanButton: {
    backgroundColor: '#8ab4ff',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: { opacity: 0.4 },
  scanButtonText: { color: '#000', fontWeight: '700', fontSize: 15 },
  error: { color: '#ff6b6b', marginTop: 12 },
  signOut: { marginTop: 'auto', alignItems: 'center', paddingVertical: 14 },
  signOutText: { color: '#ff6b6b', fontSize: 15 },
});
