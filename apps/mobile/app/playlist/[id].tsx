import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Linking } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { PlaylistDetail } from '@baes/core';
import { useAuth } from '../../src/auth';
import { useDownloads } from '../../src/downloads';
import { usePlayer } from '../../src/player';
import { NowPlayingBar } from '../../src/components/NowPlayingBar';
import { TrackRow } from '../../src/components/TrackRow';
import { readCache, writeCache } from '../../src/offline';

export default function PlaylistScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { client, user } = useAuth();
  const { playTrack } = usePlayer();
  const { download, isDownloaded, queueLength } = useDownloads();
  const [playlist, setPlaylist] = useState<PlaylistDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Edit mode reorders locally; the new order is saved once, on Done.
  const [editing, setEditing] = useState(false);
  const [savedOrder, setSavedOrder] = useState<string[]>([]);

  const load = useCallback(() => {
    if (!client || !id) return;
    const key = `playlist-${id}`;
    const cached = readCache<PlaylistDetail>(key);
    if (cached) setPlaylist(cached);
    client
      .getPlaylist(id)
      .then((fresh) => {
        setPlaylist(fresh);
        writeCache(key, fresh);
      })
      .catch((e) => {
        if (!cached) setError(e instanceof Error ? e.message : 'Failed to load playlist');
      });
  }, [client, id]);

  useEffect(load, [load]);

  if (error) return <Text style={styles.error}>{error}</Text>;
  if (!playlist) return <ActivityIndicator color="#fff" style={{ marginTop: 60 }} />;

  const queue = playlist.items.flatMap((i) => (i.track ? [i.track] : []));
  const isMirror = playlist.source === 'spotify';
  const allDownloaded = queue.length > 0 && queue.every((t) => isDownloaded(t.id));

  async function removeItem(itemId: string) {
    if (!client || !id) return;
    await client.removeFromPlaylist(id, itemId);
    setSavedOrder((order) => order.filter((i) => i !== itemId));
    load();
  }

  function move(index: number, delta: -1 | 1) {
    setPlaylist((p) => {
      if (!p) return p;
      const to = index + delta;
      if (to < 0 || to >= p.items.length) return p;
      const items = [...p.items];
      [items[index], items[to]] = [items[to]!, items[index]!];
      return { ...p, items };
    });
  }

  function startEditing() {
    setSavedOrder(playlist!.items.map((i) => i.itemId));
    setEditing(true);
  }

  async function finishEditing() {
    setEditing(false);
    const order = playlist!.items.map((i) => i.itemId);
    if (!client || !id || order.join() === savedOrder.join()) return;
    try {
      await client.reorderPlaylist(id, order);
    } catch (e) {
      Alert.alert("Couldn't save the new order", e instanceof Error ? e.message : undefined);
    }
    load();
  }

  function rename() {
    Alert.prompt?.(
      'Rename playlist',
      undefined,
      async (title) => {
        if (!client || !id || !title?.trim() || title.trim() === playlist!.title) return;
        try {
          await client.renamePlaylist(id, title.trim());
        } catch (e) {
          Alert.alert("Couldn't rename", e instanceof Error ? e.message : undefined);
        }
        load();
      },
      'plain-text',
      playlist!.title,
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          title: playlist.title,
          headerRight: () => (
            <View style={styles.headerActions}>
              {user?.role === 'owner' && (
                <Pressable
                  hitSlop={10}
                  onPress={() =>
                    router.push({
                      pathname: '/share',
                      params: { kind: 'playlist', id: playlist.id, title: playlist.title },
                    })
                  }
                >
                  <Ionicons name="share-outline" size={22} color="#8ab4ff" />
                </Pressable>
              )}
              {!isMirror && (
                <Pressable onPress={editing ? finishEditing : startEditing} hitSlop={10}>
                  <Text style={styles.editButton}>{editing ? 'Done' : 'Edit'}</Text>
                </Pressable>
              )}
            </View>
          ),
        }}
      />
      <FlatList
        data={playlist.items}
        keyExtractor={(i) => i.itemId}
        ListHeaderComponent={
          <View style={styles.header}>
            <Pressable onPress={editing ? rename : undefined} style={styles.titleRow}>
              <Text style={styles.title}>{playlist.title}</Text>
              {editing && <Ionicons name="pencil" size={18} color="#8ab4ff" />}
            </Pressable>
            <Text style={styles.meta}>{playlist.items.length} tracks</Text>
            {queue.length > 0 && (
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Pressable style={styles.playAll} onPress={() => playTrack(queue[0]!, queue)}>
                  <Ionicons name="play" size={18} color="#000" />
                  <Text style={styles.playAllText}>Play</Text>
                </Pressable>
                <Pressable
                  style={styles.downloadAll}
                  onPress={() => download(queue)}
                  disabled={allDownloaded}
                >
                  <Ionicons
                    name={allDownloaded ? 'arrow-down-circle' : 'arrow-down-circle-outline'}
                    size={18}
                    color={allDownloaded ? '#7dd87d' : '#fff'}
                  />
                  <Text style={styles.downloadAllText}>
                    {allDownloaded ? 'Offline' : queueLength > 0 ? `${queueLength}…` : 'Download'}
                  </Text>
                </Pressable>
              </View>
            )}
          </View>
        }
        ListEmptyComponent={
          <Text style={styles.emptyText}>Long-press any track in your library to add it here.</Text>
        }
        renderItem={({ item, index }) =>
          item.track ? (
            <TrackRow
              track={item.track}
              queue={queue}
              trailing={
                isMirror ? undefined : editing ? (
                  <View style={styles.editControls}>
                    <Pressable onPress={() => move(index, -1)} hitSlop={6} disabled={index === 0}>
                      <Ionicons name="chevron-up" size={22} color={index === 0 ? '#333' : '#ccc'} />
                    </Pressable>
                    <Pressable
                      onPress={() => move(index, 1)}
                      hitSlop={6}
                      disabled={index === playlist.items.length - 1}
                    >
                      <Ionicons
                        name="chevron-down"
                        size={22}
                        color={index === playlist.items.length - 1 ? '#333' : '#ccc'}
                      />
                    </Pressable>
                    <Pressable onPress={() => removeItem(item.itemId)} hitSlop={6}>
                      <Ionicons name="close-circle-outline" size={20} color="#ff6b8a" />
                    </Pressable>
                  </View>
                ) : (
                  <Pressable onPress={() => removeItem(item.itemId)} hitSlop={10}>
                    <Ionicons name="close-circle-outline" size={20} color="#666" />
                  </Pressable>
                )
              }
            />
          ) : item.external ? (
            <Pressable
              style={styles.externalRow}
              onPress={() =>
                Linking.openURL(`https://open.spotify.com/track/${item.external!.spotifyId}`)
              }
            >
              <View style={styles.externalArt}>
                <Ionicons name="musical-note" size={16} color="#555" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.externalTitle} numberOfLines={1}>
                  {item.external.title}
                </Text>
                <Text style={styles.externalSub} numberOfLines={1}>
                  {item.external.artist} · via Spotify
                </Text>
              </View>
              <Ionicons name="open-outline" size={16} color="#555" />
            </Pressable>
          ) : null
        }
      />
      <NowPlayingBar />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0b0f' },
  header: { padding: 20, gap: 6 },
  title: { color: '#fff', fontSize: 26, fontWeight: '800' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  editButton: { color: '#8ab4ff', fontSize: 16, fontWeight: '600' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  editControls: { flexDirection: 'row', alignItems: 'center', gap: 14 },
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
  downloadAll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#333',
    paddingHorizontal: 18,
    paddingVertical: 10,
    marginTop: 10,
  },
  downloadAllText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  emptyText: { color: '#666', fontSize: 14, textAlign: 'center', marginTop: 30, padding: 20 },
  error: { color: '#ff6b6b', textAlign: 'center', marginTop: 60 },
  externalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 12,
    opacity: 0.55,
  },
  externalArt: {
    width: 44,
    height: 44,
    borderRadius: 6,
    backgroundColor: '#17171d',
    alignItems: 'center',
    justifyContent: 'center',
  },
  externalTitle: { color: '#fff', fontSize: 15, fontWeight: '500' },
  externalSub: { color: '#888', fontSize: 13, marginTop: 2 },
});
