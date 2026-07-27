import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Track } from '@baes/core';
import { useAuth } from '../src/auth';
import { usePlayer } from '../src/player';
import { NowPlayingBar } from '../src/components/NowPlayingBar';
import { TrackRow } from '../src/components/TrackRow';

export default function LikedScreen() {
  const { client } = useAuth();
  const { playTrack } = usePlayer();
  const [tracks, setTracks] = useState<Track[] | null>(null);

  const load = useCallback(() => {
    client
      ?.listLikedTracks()
      .then((r) => setTracks(r.tracks))
      .catch(() => setTracks([]));
  }, [client]);

  useEffect(load, [load]);

  if (!tracks) return <ActivityIndicator color="#fff" style={{ marginTop: 60 }} />;

  return (
    <View style={styles.container}>
      <FlatList
        data={tracks}
        keyExtractor={(t) => t.id}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.title}>Liked songs</Text>
            <Text style={styles.meta}>{tracks.length} tracks</Text>
            {tracks.length > 0 && (
              <Pressable style={styles.playAll} onPress={() => playTrack(tracks[0]!, tracks)}>
                <Ionicons name="play" size={18} color="#000" />
                <Text style={styles.playAllText}>Play</Text>
              </Pressable>
            )}
          </View>
        }
        ListEmptyComponent={
          <Text style={styles.emptyText}>
            Tap the heart on the player, or long-press a track, to like it.
          </Text>
        }
        renderItem={({ item }) => <TrackRow track={item} queue={tracks} />}
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
});
