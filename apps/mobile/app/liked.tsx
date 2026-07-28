import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Track } from '@baes/core';
import { useAuth } from '../src/auth';
import { useDownloads } from '../src/downloads';
import { usePlayer } from '../src/player';
import { NowPlayingBar } from '../src/components/NowPlayingBar';
import { TrackRow } from '../src/components/TrackRow';

export default function LikedScreen() {
  const { client } = useAuth();
  const { playTrack } = usePlayer();
  const { download, isDownloaded, queueLength } = useDownloads();
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
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Pressable style={styles.playAll} onPress={() => playTrack(tracks[0]!, tracks)}>
                  <Ionicons name="play" size={18} color="#000" />
                  <Text style={styles.playAllText}>Play</Text>
                </Pressable>
                <Pressable style={styles.downloadAll} onPress={() => download(tracks)}>
                  <Ionicons
                    name={
                      tracks.every((t) => isDownloaded(t.id))
                        ? 'arrow-down-circle'
                        : 'arrow-down-circle-outline'
                    }
                    size={18}
                    color={tracks.every((t) => isDownloaded(t.id)) ? '#7dd87d' : '#fff'}
                  />
                  <Text style={styles.downloadAllText}>
                    {tracks.every((t) => isDownloaded(t.id))
                      ? 'Offline'
                      : queueLength > 0
                        ? `${queueLength}…`
                        : 'Download'}
                  </Text>
                </Pressable>
              </View>
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
});
