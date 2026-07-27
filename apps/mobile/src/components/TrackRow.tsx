import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import type { Track } from '@baes/core';
import { useAuth } from '../auth';
import { formatDuration, usePlayer } from '../player';

interface Props {
  track: Track;
  queue: Track[];
  /** Hide art (e.g. inside an album screen where every row shares the cover). */
  showArt?: boolean;
  /** Show leading track number instead of art. */
  showTrackNo?: boolean;
  /** Extra trailing control (e.g. remove-from-playlist button). */
  trailing?: React.ReactNode;
}

export function TrackRow({ track, queue, showArt = true, showTrackNo = false, trailing }: Props) {
  const { client } = useAuth();
  const { playTrack, current, playing } = usePlayer();
  const active = current?.id === track.id;

  return (
    <Pressable
      style={styles.row}
      onPress={() => playTrack(track, queue)}
      onLongPress={() =>
        router.push({ pathname: '/add-to-playlist', params: { trackId: track.id } })
      }
      delayLongPress={350}
    >
      {showTrackNo ? (
        <View style={styles.trackNo}>
          {active ? (
            <Ionicons name={playing ? 'volume-high' : 'pause'} size={16} color="#8ab4ff" />
          ) : (
            <Text style={styles.trackNoText}>{track.trackNo ?? '–'}</Text>
          )}
        </View>
      ) : showArt ? (
        track.artUrl && client ? (
          <Image source={{ uri: client.mediaUrl(track.artUrl) }} style={styles.art} />
        ) : (
          <View style={[styles.art, styles.artPlaceholder]}>
            <Ionicons name="musical-note" size={18} color="#555" />
          </View>
        )
      ) : null}
      <View style={styles.meta}>
        <Text style={[styles.title, active && styles.activeTitle]} numberOfLines={1}>
          {track.title}
        </Text>
        <Text style={styles.subtitle} numberOfLines={1}>
          {track.artistName ?? 'Unknown artist'}
          {track.albumTitle ? ` · ${track.albumTitle}` : ''}
        </Text>
      </View>
      <Text style={styles.duration}>{formatDuration(track.durationMs)}</Text>
      {trailing}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 12,
  },
  art: { width: 44, height: 44, borderRadius: 6 },
  artPlaceholder: { backgroundColor: '#17171d', alignItems: 'center', justifyContent: 'center' },
  trackNo: { width: 28, alignItems: 'center' },
  trackNoText: { color: '#666', fontSize: 13, fontVariant: ['tabular-nums'] },
  meta: { flex: 1 },
  title: { color: '#fff', fontSize: 15, fontWeight: '500' },
  activeTitle: { color: '#8ab4ff' },
  subtitle: { color: '#888', fontSize: 13, marginTop: 2 },
  duration: { color: '#666', fontSize: 13, fontVariant: ['tabular-nums'] },
});
