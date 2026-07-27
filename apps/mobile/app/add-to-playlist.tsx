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
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { PlaylistSummary } from '@baes/core';
import { useAuth } from '../src/auth';

export default function AddToPlaylist() {
  const { trackId } = useLocalSearchParams<{ trackId: string }>();
  const { client } = useAuth();
  const [playlists, setPlaylists] = useState<PlaylistSummary[] | null>(null);
  const [liked, setLiked] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!client || !trackId) return;
    client
      .listPlaylists()
      .then((r) => setPlaylists(r.playlists.filter((p) => p.source === 'local')));
    client.listLikedTrackIds().then((r) => setLiked(r.trackIds.includes(trackId)));
  }, [client, trackId]);

  useEffect(load, [load]);

  async function toggleLike() {
    if (!client || !trackId || liked === null) return;
    setLiked(!liked);
    try {
      if (liked) await client.unlikeTrack(trackId);
      else await client.likeTrack(trackId);
    } catch {
      setLiked(liked);
    }
  }

  async function addTo(playlistId: string) {
    if (!client || !trackId || busy) return;
    setBusy(true);
    try {
      await client.addToPlaylist(playlistId, trackId);
      router.back();
    } catch {
      setBusy(false);
    }
  }

  function newPlaylist() {
    Alert.prompt?.(
      'New playlist',
      undefined,
      async (title) => {
        if (!client || !title?.trim() || !trackId) return;
        const { playlist } = await client.createPlaylist(title.trim());
        await client.addToPlaylist(playlist.id, trackId);
        router.back();
      },
      'plain-text',
    );
  }

  if (!playlists) return <ActivityIndicator color="#fff" style={{ marginTop: 60 }} />;

  return (
    <View style={styles.container}>
      <Pressable style={styles.row} onPress={toggleLike}>
        <Ionicons
          name={liked ? 'heart' : 'heart-outline'}
          size={22}
          color={liked ? '#ff6b8a' : '#fff'}
        />
        <Text style={styles.rowText}>{liked ? 'Liked' : 'Like'}</Text>
      </Pressable>

      <Text style={styles.section}>Add to playlist</Text>
      <FlatList
        data={playlists}
        keyExtractor={(p) => p.id}
        ListHeaderComponent={
          <Pressable style={styles.row} onPress={newPlaylist}>
            <Ionicons name="add-circle-outline" size={22} color="#8ab4ff" />
            <Text style={[styles.rowText, { color: '#8ab4ff' }]}>New playlist…</Text>
          </Pressable>
        }
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => addTo(item.id)}>
            <Ionicons name="list" size={22} color="#fff" />
            <Text style={styles.rowText}>{item.title}</Text>
            <Text style={styles.count}>{item.trackCount}</Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0b0f', paddingTop: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  rowText: { color: '#fff', fontSize: 16, flex: 1 },
  count: { color: '#666', fontSize: 14 },
  section: {
    color: '#888',
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 4,
  },
});
