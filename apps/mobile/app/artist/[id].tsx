import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { ArtistDetail, Track } from '@baes/core';
import { useAuth } from '../../src/auth';
import { usePlayer } from '../../src/player';
import { NowPlayingBar } from '../../src/components/NowPlayingBar';
import { TrackRow } from '../../src/components/TrackRow';

export default function ArtistScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { client } = useAuth();
  const { playTrack } = usePlayer();
  const [artist, setArtist] = useState<ArtistDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!client || !id) return;
    client
      .getArtist(id)
      .then(setArtist)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load artist'));
  }, [client, id]);

  // Group the artist's tracks by album; albumless tracks become "Singles & loosies".
  const sections = useMemo(() => {
    if (!artist) return [];
    const byAlbum = new Map<string, { title: string; albumId: string | null; data: Track[] }>();
    for (const t of artist.tracks) {
      const key = t.albumId ?? '__none__';
      if (!byAlbum.has(key)) {
        byAlbum.set(key, {
          title: t.albumTitle ?? 'Singles & loosies',
          albumId: t.albumId,
          data: [],
        });
      }
      byAlbum.get(key)!.data.push(t);
    }
    // Albums first (alphabetical), loose tracks last
    return [...byAlbum.values()].sort((a, b) =>
      a.albumId === null ? 1 : b.albumId === null ? -1 : a.title.localeCompare(b.title),
    );
  }, [artist]);

  if (error) return <Text style={styles.error}>{error}</Text>;
  if (!artist) return <ActivityIndicator color="#fff" style={{ marginTop: 60 }} />;

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: artist.name }} />
      <SectionList
        sections={sections}
        keyExtractor={(t) => t.id}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.name}>{artist.name}</Text>
            <Text style={styles.meta}>{artist.tracks.length} tracks</Text>
            <Pressable
              style={styles.playAll}
              onPress={() => artist.tracks[0] && playTrack(artist.tracks[0], artist.tracks)}
            >
              <Ionicons name="play" size={18} color="#000" />
              <Text style={styles.playAllText}>Play all</Text>
            </Pressable>
          </View>
        }
        renderSectionHeader={({ section }) => (
          <Pressable
            style={styles.sectionHeader}
            disabled={!section.albumId}
            onPress={() => section.albumId && router.push(`/album/${section.albumId}`)}
          >
            <Text style={styles.sectionTitle}>{section.title}</Text>
            {section.albumId && <Ionicons name="chevron-forward" size={16} color="#555" />}
          </Pressable>
        )}
        renderItem={({ item, section }) => (
          <TrackRow track={item} queue={section.data} showArt={false} showTrackNo />
        )}
        stickySectionHeadersEnabled={false}
      />
      <NowPlayingBar />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0b0f' },
  header: { padding: 20, gap: 6 },
  name: { color: '#fff', fontSize: 26, fontWeight: '800' },
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
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 18,
    paddingBottom: 6,
  },
  sectionTitle: { color: '#8ab4ff', fontSize: 15, fontWeight: '700' },
  error: { color: '#ff6b6b', textAlign: 'center', marginTop: 60 },
});
