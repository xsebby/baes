import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { PlaylistDetail } from '@baes/core';
import { useAuth } from '../../src/auth';
import { usePlayer } from '../../src/player';
import { NowPlayingBar } from '../../src/components/NowPlayingBar';
import { TrackRow } from '../../src/components/TrackRow';

export default function PlaylistScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { client } = useAuth();
  const { playTrack } = usePlayer();
  const [playlist, setPlaylist] = useState<PlaylistDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!client || !id) return;
    client
      .getPlaylist(id)
      .then(setPlaylist)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load playlist'));
  }, [client, id]);

  useEffect(load, [load]);

  if (error) return <Text style={styles.error}>{error}</Text>;
  if (!playlist) return <ActivityIndicator color="#fff" style={{ marginTop: 60 }} />;

  const queue = playlist.items.map((i) => i.track);

  async function removeItem(itemId: string) {
    if (!client || !id) return;
    await client.removeFromPlaylist(id, itemId);
    load();
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: playlist.title }} />
      <FlatList
        data={playlist.items}
        keyExtractor={(i) => i.itemId}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.title}>{playlist.title}</Text>
            <Text style={styles.meta}>{playlist.items.length} tracks</Text>
            {queue.length > 0 && (
              <Pressable style={styles.playAll} onPress={() => playTrack(queue[0]!, queue)}>
                <Ionicons name="play" size={18} color="#000" />
                <Text style={styles.playAllText}>Play</Text>
              </Pressable>
            )}
          </View>
        }
        ListEmptyComponent={
          <Text style={styles.emptyText}>Long-press any track in your library to add it here.</Text>
        }
        renderItem={({ item }) => (
          <TrackRow
            track={item.track}
            queue={queue}
            trailing={
              <Pressable onPress={() => removeItem(item.itemId)} hitSlop={10}>
                <Ionicons name="close-circle-outline" size={20} color="#666" />
              </Pressable>
            }
          />
        )}
      />
      <NowPlayingBar />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0b0f' },
  header: { padding: 20, gap: 6 },
  title: { color: '#fff', fontSize: 26, fontWeight: '800' },
  meta: { color: '#888', fontSize: 13 },
  playAll: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    backgroundColor: '#fff',
    borderRadius: 22,
    paddingHorizontal: 26,
    paddingVertical: 10,
    marginTop: 10,
  },
  playAllText: { color: '#000', fontWeight: '700', fontSize: 15 },
  emptyText: { color: '#666', fontSize: 14, textAlign: 'center', marginTop: 30, padding: 20 },
  error: { color: '#ff6b6b', textAlign: 'center', marginTop: 60 },
});
