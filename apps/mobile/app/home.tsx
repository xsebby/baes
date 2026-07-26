import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router } from 'expo-router';
import type { Track } from '@baes/core';
import { useAuth } from '../src/auth';
import { formatDuration, usePlayer } from '../src/player';
import { NowPlayingBar } from '../src/components/NowPlayingBar';

export default function Library() {
  const { client, user } = useAuth();
  const { playTrack, current } = usePlayer();
  const [tracks, setTracks] = useState<Track[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(
    async (q?: string) => {
      if (!client) return;
      setError(null);
      try {
        const res = await client.listTracks({ q: q || undefined, limit: 500 });
        setTracks(res.tracks);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load library');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [client],
  );

  useEffect(() => {
    load();
  }, [load]);

  function onSearch(text: string) {
    setQuery(text);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => load(text), 250);
  }

  function renderTrack({ item }: { item: Track }) {
    const active = current?.id === item.id;
    return (
      <Pressable style={styles.trackRow} onPress={() => playTrack(item, tracks)}>
        {item.artUrl && client ? (
          <Image source={{ uri: client.mediaUrl(item.artUrl) }} style={styles.trackArt} />
        ) : (
          <View style={[styles.trackArt, styles.artPlaceholder]}>
            <Text style={styles.artGlyph}>♪</Text>
          </View>
        )}
        <View style={styles.trackMeta}>
          <Text style={[styles.trackTitle, active && styles.activeTitle]} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={styles.trackArtist} numberOfLines={1}>
            {item.artistName ?? 'Unknown artist'}
            {item.albumTitle ? ` · ${item.albumTitle}` : ''}
          </Text>
        </View>
        <Text style={styles.duration}>{formatDuration(item.durationMs)}</Text>
      </Pressable>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TextInput
          style={styles.search}
          placeholder="Search your library"
          placeholderTextColor="#666"
          value={query}
          onChangeText={onSearch}
          autoCapitalize="none"
        />
        {user?.role === 'owner' && (
          <Pressable style={styles.adminButton} onPress={() => router.push('/admin')}>
            <Text style={styles.adminButtonText}>⚙︎</Text>
          </Pressable>
        )}
      </View>

      {loading ? (
        <ActivityIndicator color="#fff" style={{ marginTop: 40 }} />
      ) : error ? (
        <Text style={styles.error}>{error}</Text>
      ) : tracks.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>{query ? 'No matches' : 'No music yet'}</Text>
          {!query && (
            <Text style={styles.emptyBody}>
              Add a library root and run a scan from the ⚙︎ admin screen.
            </Text>
          )}
        </View>
      ) : (
        <FlatList
          data={tracks}
          keyExtractor={(t) => t.id}
          renderItem={renderTrack}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                load(query);
              }}
              tintColor="#fff"
            />
          }
        />
      )}

      <NowPlayingBar />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0b0f' },
  header: { flexDirection: 'row', gap: 8, padding: 12 },
  search: {
    flex: 1,
    backgroundColor: '#17171d',
    color: '#fff',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
  },
  adminButton: {
    backgroundColor: '#17171d',
    borderRadius: 10,
    paddingHorizontal: 14,
    justifyContent: 'center',
  },
  adminButtonText: { color: '#fff', fontSize: 18 },
  trackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 12,
  },
  trackArt: { width: 44, height: 44, borderRadius: 6 },
  artPlaceholder: { backgroundColor: '#17171d', alignItems: 'center', justifyContent: 'center' },
  artGlyph: { color: '#555', fontSize: 18 },
  trackMeta: { flex: 1 },
  trackTitle: { color: '#fff', fontSize: 15, fontWeight: '500' },
  activeTitle: { color: '#8ab4ff' },
  trackArtist: { color: '#888', fontSize: 13, marginTop: 2 },
  duration: { color: '#666', fontSize: 13 },
  error: { color: '#ff6b6b', textAlign: 'center', marginTop: 40, paddingHorizontal: 24 },
  empty: { alignItems: 'center', marginTop: 60, paddingHorizontal: 32, gap: 8 },
  emptyTitle: { color: '#fff', fontSize: 18, fontWeight: '600' },
  emptyBody: { color: '#888', fontSize: 14, textAlign: 'center', lineHeight: 20 },
});
