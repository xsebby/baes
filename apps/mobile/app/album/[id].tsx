import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { AlbumDetail } from '@baes/core';
import { useAuth } from '../../src/auth';
import { usePlayer } from '../../src/player';
import { NowPlayingBar } from '../../src/components/NowPlayingBar';
import { TrackRow } from '../../src/components/TrackRow';

export default function AlbumScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { client } = useAuth();
  const { playTrack } = usePlayer();
  const [album, setAlbum] = useState<AlbumDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!client || !id) return;
    client
      .getAlbum(id)
      .then(setAlbum)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load album'));
  }, [client, id]);

  if (error) return <Text style={styles.error}>{error}</Text>;
  if (!album || !client) return <ActivityIndicator color="#fff" style={{ marginTop: 60 }} />;

  const totalMs = album.tracks.reduce((sum, t) => sum + t.durationMs, 0);
  const totalMin = Math.round(totalMs / 60000);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: album.title }} />
      <FlatList
        data={album.tracks}
        keyExtractor={(t) => t.id}
        ListHeaderComponent={
          <View style={styles.header}>
            {album.artUrl ? (
              <Image source={{ uri: client.mediaUrl(album.artUrl) }} style={styles.art} />
            ) : (
              <View style={[styles.art, styles.artPlaceholder]}>
                <Ionicons name="disc" size={64} color="#444" />
              </View>
            )}
            <Text style={styles.title}>{album.title}</Text>
            <Text style={styles.meta}>
              {album.artistName ?? 'Unknown artist'}
              {album.year ? ` · ${album.year}` : ''} · {album.tracks.length} tracks · {totalMin} min
            </Text>
            <Pressable
              style={styles.playAll}
              onPress={() => album.tracks[0] && playTrack(album.tracks[0], album.tracks)}
            >
              <Ionicons name="play" size={18} color="#000" />
              <Text style={styles.playAllText}>Play</Text>
            </Pressable>
          </View>
        }
        renderItem={({ item }) => (
          <TrackRow track={item} queue={album.tracks} showArt={false} showTrackNo />
        )}
      />
      <NowPlayingBar />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0b0f' },
  header: { alignItems: 'center', padding: 20, gap: 8 },
  art: { width: 220, height: 220, borderRadius: 12 },
  artPlaceholder: { backgroundColor: '#17171d', alignItems: 'center', justifyContent: 'center' },
  title: { color: '#fff', fontSize: 22, fontWeight: '800', textAlign: 'center', marginTop: 8 },
  meta: { color: '#888', fontSize: 13 },
  playAll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#fff',
    borderRadius: 22,
    paddingHorizontal: 26,
    paddingVertical: 10,
    marginTop: 10,
  },
  playAllText: { color: '#000', fontWeight: '700', fontSize: 15 },
  error: { color: '#ff6b6b', textAlign: 'center', marginTop: 60 },
});
