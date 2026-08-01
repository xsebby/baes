import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { AlbumDetail } from '@baes/core';
import { useAuth } from '../../src/auth';
import { useDownloads } from '../../src/downloads';
import { usePlayer } from '../../src/player';
import { NowPlayingBar } from '../../src/components/NowPlayingBar';
import { TrackRow } from '../../src/components/TrackRow';
import { CachedImage, readCache, writeCache } from '../../src/offline';

export default function AlbumScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { client } = useAuth();
  const { playTrack } = usePlayer();
  const { download, isDownloaded, queueLength } = useDownloads();
  const [album, setAlbum] = useState<AlbumDetail | null>(null);
  const [tracklistId, setTracklistId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!client || !id) return;
    const key = `album-${id}`;
    const cached = readCache<AlbumDetail>(key);
    if (cached) setAlbum(cached);
    client
      .getAlbum(id)
      .then((fresh) => {
        setAlbum(fresh);
        writeCache(key, fresh);
      })
      .catch((e) => {
        if (!cached) setError(e instanceof Error ? e.message : 'Failed to load album');
      });
  }, [client, id]);

  if (error) return <Text style={styles.error}>{error}</Text>;
  if (!album || !client) return <ActivityIndicator color="#fff" style={{ marginTop: 60 }} />;

  const activeList = album.tracklists?.find((t) => t.id === tracklistId) ?? null;
  const byId = new Map(album.tracks.map((t) => [t.id, t]));
  const shownTracks = activeList
    ? activeList.trackIds.flatMap((tid) => {
        const t = byId.get(tid);
        return t ? [t] : [];
      })
    : album.tracks;

  const totalMs = shownTracks.reduce((sum, t) => sum + t.durationMs, 0);
  const totalMin = Math.round(totalMs / 60000);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: album.title }} />
      <FlatList
        data={shownTracks}
        keyExtractor={(t) => t.id}
        ListHeaderComponent={
          <View style={styles.header}>
            <CachedImage
              id={album.id}
              remoteUri={album.artUrl ? client.mediaUrl(album.artUrl) : null}
              style={[styles.art, styles.artPlaceholder]}
              placeholder={<Ionicons name="disc" size={64} color="#444" />}
            />
            <Text style={styles.title}>
              {album.versions.length ? album.baseTitle : album.title}
            </Text>
            <Text style={styles.meta}>
              {album.artistName ?? 'Unknown artist'}
              {album.year ? ` · ${album.year}` : ''} · {shownTracks.length} tracks · {totalMin} min
            </Text>
            {(album.tracklists?.length ?? 0) > 0 && (
              <Pressable style={styles.dropdown} onPress={() => setPickerOpen(true)}>
                <Ionicons name="list-outline" size={16} color="#8ab4ff" />
                <Text style={styles.dropdownText} numberOfLines={1}>
                  {activeList ? activeList.name : 'All tracks'}
                </Text>
                <Text style={styles.dropdownCount}>{shownTracks.length}</Text>
                <Ionicons name="chevron-down" size={16} color="#888" />
              </Pressable>
            )}
            {album.versions.length > 1 && (
              <View style={styles.versionRow}>
                {album.versions.map((v) => {
                  const active = v.id === album.id;
                  return (
                    <Pressable
                      key={v.id}
                      style={[styles.versionChip, active && styles.versionChipActive]}
                      onPress={() => !active && router.replace(`/album/${v.id}`)}
                    >
                      <Text style={[styles.versionText, active && styles.versionTextActive]}>
                        {v.label}
                      </Text>
                      <Text style={[styles.versionCount, active && styles.versionTextActive]}>
                        {v.trackCount}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Pressable
                style={styles.playAll}
                onPress={() => shownTracks[0] && playTrack(shownTracks[0], shownTracks)}
              >
                <Ionicons name="play" size={18} color="#000" />
                <Text style={styles.playAllText}>Play</Text>
              </Pressable>
              <Pressable style={styles.downloadAll} onPress={() => download(shownTracks)}>
                <Ionicons
                  name={
                    shownTracks.every((t) => isDownloaded(t.id))
                      ? 'arrow-down-circle'
                      : 'arrow-down-circle-outline'
                  }
                  size={18}
                  color={shownTracks.every((t) => isDownloaded(t.id)) ? '#7dd87d' : '#fff'}
                />
                <Text style={styles.downloadAllText}>
                  {shownTracks.every((t) => isDownloaded(t.id))
                    ? 'Offline'
                    : queueLength > 0
                      ? `${queueLength}…`
                      : 'Download'}
                </Text>
              </Pressable>
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <TrackRow track={item} queue={shownTracks} showArt={false} showTrackNo />
        )}
      />
      <NowPlayingBar />

      <Modal visible={pickerOpen} transparent animationType="fade">
        <Pressable style={styles.pickerBackdrop} onPress={() => setPickerOpen(false)}>
          <Pressable style={styles.pickerSheet} onPress={() => {}}>
            <Text style={styles.pickerTitle}>Tracklist</Text>
            <Pressable
              style={[styles.pickerRow, !tracklistId && styles.pickerRowActive]}
              onPress={() => {
                setTracklistId(null);
                setPickerOpen(false);
              }}
            >
              <Text style={styles.pickerLabel}>All tracks</Text>
              <Text style={styles.pickerCount}>{album.tracks.length}</Text>
            </Pressable>
            {(album.tracklists ?? []).map((tl) => (
              <Pressable
                key={tl.id}
                style={[styles.pickerRow, tracklistId === tl.id && styles.pickerRowActive]}
                onPress={() => {
                  setTracklistId(tl.id);
                  setPickerOpen(false);
                }}
              >
                <Text style={styles.pickerLabel}>{tl.name}</Text>
                <Text style={styles.pickerCount}>{tl.trackIds.length}</Text>
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
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
  dropdown: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'center',
    backgroundColor: '#17171d',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 12,
    minWidth: 220,
  },
  dropdownText: { color: '#fff', fontSize: 14, fontWeight: '600', flex: 1 },
  dropdownCount: { color: '#666', fontSize: 12 },
  pickerBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  pickerSheet: {
    backgroundColor: '#17171d',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingVertical: 18,
    paddingBottom: 40,
  },
  pickerTitle: {
    color: '#888',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    paddingHorizontal: 22,
    paddingBottom: 8,
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 22,
    paddingVertical: 14,
    gap: 12,
  },
  pickerRowActive: { backgroundColor: '#22222a' },
  pickerLabel: { color: '#fff', fontSize: 16, flex: 1 },
  pickerCount: { color: '#666', fontSize: 13 },
  versionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
    marginTop: 12,
  },
  versionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#17171d',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  versionChipActive: { backgroundColor: '#fff' },
  versionText: { color: '#bbb', fontSize: 13, fontWeight: '700' },
  versionTextActive: { color: '#000' },
  versionCount: { color: '#666', fontSize: 12 },
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
  error: { color: '#ff6b6b', textAlign: 'center', marginTop: 60 },
});
