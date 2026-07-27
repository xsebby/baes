import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import { Ionicons } from '@expo/vector-icons';
import type { AlbumSummary, ArtistSummary, PlaylistSummary, Track } from '@baes/core';
import { useAuth } from '../src/auth';
import { usePlayer } from '../src/player';
import { NowPlayingBar } from '../src/components/NowPlayingBar';
import { TrackRow } from '../src/components/TrackRow';

type Segment = 'songs' | 'albums' | 'artists' | 'playlists';

export default function Library() {
  const { client, user } = useAuth();
  const { current } = usePlayer();
  const [segment, setSegment] = useState<Segment>('songs');
  const [tracks, setTracks] = useState<Track[]>([]);
  const [albums, setAlbums] = useState<AlbumSummary[]>([]);
  const [artists, setArtists] = useState<ArtistSummary[]>([]);
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>([]);
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
        const [t, al, ar, pl] = await Promise.all([
          client.listTracks({ q: q || undefined, limit: 500 }),
          client.listAlbums(),
          client.listArtists(),
          client.listPlaylists(),
        ]);
        setTracks(t.tracks);
        setAlbums(al.albums);
        setArtists(ar.artists);
        setPlaylists(pl.playlists);
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

  const refreshControl = (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={() => {
        setRefreshing(true);
        load(query);
      }}
      tintColor="#fff"
    />
  );

  function renderBody() {
    if (loading) return <ActivityIndicator color="#fff" style={{ marginTop: 40 }} />;
    if (error) return <Text style={styles.error}>{error}</Text>;

    if (segment === 'albums') {
      return (
        <FlatList
          key="albums"
          data={albums}
          keyExtractor={(a) => a.id}
          numColumns={2}
          columnWrapperStyle={styles.albumRow}
          contentContainerStyle={styles.albumGrid}
          refreshControl={refreshControl}
          renderItem={({ item }) => (
            <Pressable style={styles.albumCard} onPress={() => router.push(`/album/${item.id}`)}>
              {item.artUrl && client ? (
                <Image source={{ uri: client.mediaUrl(item.artUrl) }} style={styles.albumArt} />
              ) : (
                <View style={[styles.albumArt, styles.artPlaceholder]}>
                  <Ionicons name="disc" size={40} color="#444" />
                </View>
              )}
              <Text style={styles.albumTitle} numberOfLines={1}>
                {item.title}
              </Text>
              <Text style={styles.albumMeta} numberOfLines={1}>
                {item.artistName ?? 'Unknown'} · {item.trackCount}
              </Text>
            </Pressable>
          )}
        />
      );
    }

    if (segment === 'artists') {
      return (
        <FlatList
          key="artists"
          data={artists}
          keyExtractor={(a) => a.id}
          refreshControl={refreshControl}
          renderItem={({ item }) => (
            <Pressable style={styles.artistRow} onPress={() => router.push(`/artist/${item.id}`)}>
              <View style={styles.artistBubble}>
                <Ionicons name="person" size={20} color="#666" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.artistName}>{item.name}</Text>
                <Text style={styles.artistMeta}>
                  {item.trackCount} track{item.trackCount === 1 ? '' : 's'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#444" />
            </Pressable>
          )}
        />
      );
    }

    if (segment === 'playlists') {
      return (
        <FlatList
          key="playlists"
          data={playlists}
          keyExtractor={(p) => p.id}
          refreshControl={refreshControl}
          ListHeaderComponent={
            <>
              <Pressable style={styles.artistRow} onPress={() => router.push('/liked')}>
                <View style={styles.artistBubble}>
                  <Ionicons name="heart" size={20} color="#ff6b8a" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.artistName}>Liked songs</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#444" />
              </Pressable>
              <Pressable
                style={styles.artistRow}
                onPress={() =>
                  Alert.prompt?.('New playlist', undefined, async (title) => {
                    if (!client || !title?.trim()) return;
                    await client.createPlaylist(title.trim());
                    load(query);
                  })
                }
              >
                <View style={styles.artistBubble}>
                  <Ionicons name="add" size={22} color="#8ab4ff" />
                </View>
                <Text style={[styles.artistName, { color: '#8ab4ff' }]}>New playlist…</Text>
              </Pressable>
            </>
          }
          renderItem={({ item }) => (
            <Pressable style={styles.artistRow} onPress={() => router.push(`/playlist/${item.id}`)}>
              {item.artUrl && client ? (
                <Image source={{ uri: client.mediaUrl(item.artUrl) }} style={styles.playlistArt} />
              ) : (
                <View style={styles.artistBubble}>
                  <Ionicons name="list" size={20} color="#666" />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.artistName}>{item.title}</Text>
                <Text style={styles.artistMeta}>
                  {item.trackCount} track{item.trackCount === 1 ? '' : 's'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color="#444" />
            </Pressable>
          )}
        />
      );
    }

    if (tracks.length === 0) {
      return (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>{query ? 'No matches' : 'No music yet'}</Text>
          {!query && (
            <Text style={styles.emptyBody}>
              Add a library root and run a scan from the admin screen.
            </Text>
          )}
        </View>
      );
    }

    return (
      <FlatList
        key="songs"
        data={tracks}
        keyExtractor={(t) => t.id}
        refreshControl={refreshControl}
        renderItem={({ item }) => <TrackRow track={item} queue={tracks} />}
      />
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
            <Ionicons name="settings-outline" size={20} color="#fff" />
          </Pressable>
        )}
      </View>

      <View style={styles.segments}>
        {(['songs', 'albums', 'artists', 'playlists'] as const).map((s) => (
          <Pressable
            key={s}
            style={[styles.segment, segment === s && styles.segmentActive]}
            onPress={() => setSegment(s)}
          >
            <Text style={[styles.segmentText, segment === s && styles.segmentTextActive]}>
              {s[0]!.toUpperCase() + s.slice(1)}
            </Text>
          </Pressable>
        ))}
      </View>

      {renderBody()}
      <NowPlayingBar />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0b0f' },
  header: { flexDirection: 'row', gap: 8, padding: 12, paddingBottom: 8 },
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
    paddingHorizontal: 12,
    justifyContent: 'center',
  },
  segments: { flexDirection: 'row', paddingHorizontal: 12, paddingBottom: 8, gap: 8 },
  segment: {
    paddingHorizontal: 16,
    paddingVertical: 7,
    borderRadius: 18,
    backgroundColor: '#17171d',
  },
  segmentActive: { backgroundColor: '#fff' },
  segmentText: { color: '#999', fontSize: 13, fontWeight: '600' },
  segmentTextActive: { color: '#000' },
  albumGrid: { paddingHorizontal: 12, paddingBottom: 12 },
  albumRow: { gap: 12 },
  albumCard: { flex: 1, marginBottom: 16, maxWidth: '48%' },
  albumArt: { width: '100%', aspectRatio: 1, borderRadius: 10 },
  artPlaceholder: { backgroundColor: '#17171d', alignItems: 'center', justifyContent: 'center' },
  albumTitle: { color: '#fff', fontSize: 14, fontWeight: '600', marginTop: 8 },
  albumMeta: { color: '#888', fontSize: 12, marginTop: 2 },
  artistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 12,
  },
  artistBubble: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#17171d',
    alignItems: 'center',
    justifyContent: 'center',
  },
  playlistArt: { width: 44, height: 44, borderRadius: 8 },
  artistName: { color: '#fff', fontSize: 15, fontWeight: '500' },
  artistMeta: { color: '#888', fontSize: 13, marginTop: 2 },
  error: { color: '#ff6b6b', textAlign: 'center', marginTop: 40, paddingHorizontal: 24 },
  empty: { alignItems: 'center', marginTop: 60, paddingHorizontal: 32, gap: 8 },
  emptyTitle: { color: '#fff', fontSize: 18, fontWeight: '600' },
  emptyBody: { color: '#888', fontSize: 14, textAlign: 'center', lineHeight: 20 },
});
