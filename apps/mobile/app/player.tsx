import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Slider from '@react-native-community/slider';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useAuth } from '../src/auth';
import { formatSeconds, usePlayer } from '../src/player';

export default function NowPlaying() {
  const { client } = useAuth();
  const { current, playing, loading, positionSec, durationSec, toggle, next, previous, seekTo } =
    usePlayer();
  // While dragging, show the drag position instead of live playback position.
  const [dragSec, setDragSec] = useState<number | null>(null);
  const [liked, setLiked] = useState(false);

  useEffect(() => {
    if (!client || !current) return;
    client
      .listLikedTrackIds()
      .then((r) => setLiked(r.trackIds.includes(current.id)))
      .catch(() => {});
  }, [client, current?.id]);

  if (!current || !client) {
    router.back();
    return null;
  }

  async function toggleLike() {
    if (!client || !current) return;
    const next = !liked;
    setLiked(next);
    try {
      if (next) await client.likeTrack(current.id);
      else await client.unlikeTrack(current.id);
    } catch {
      setLiked(!next);
    }
  }

  const shownSec = dragSec ?? positionSec;

  return (
    <View style={styles.container}>
      {current.artUrl ? (
        <Image source={{ uri: client.mediaUrl(current.artUrl) }} style={styles.art} />
      ) : (
        <View style={[styles.art, styles.artPlaceholder]}>
          <Ionicons name="musical-notes" size={84} color="#444" />
        </View>
      )}

      <View style={styles.metaRow}>
        <View style={styles.meta}>
          <Text style={styles.title} numberOfLines={2}>
            {current.title}
          </Text>
          <Text style={styles.artist} numberOfLines={1}>
            {current.artistName ?? 'Unknown artist'}
            {current.albumTitle ? ` · ${current.albumTitle}` : ''}
          </Text>
          {current.needsReview && <Text style={styles.badge}>untagged — metadata inferred</Text>}
        </View>
        <Pressable onPress={toggleLike} hitSlop={10}>
          <Ionicons
            name={liked ? 'heart' : 'heart-outline'}
            size={28}
            color={liked ? '#ff6b8a' : '#888'}
          />
        </Pressable>
      </View>

      <View style={styles.scrubWrap}>
        <Slider
          style={styles.slider}
          minimumValue={0}
          maximumValue={Math.max(durationSec, 1)}
          value={Math.min(shownSec, durationSec)}
          minimumTrackTintColor="#8ab4ff"
          maximumTrackTintColor="#2a2a33"
          thumbTintColor="#fff"
          onSlidingStart={() => setDragSec(positionSec)}
          onValueChange={(v) => setDragSec(v)}
          onSlidingComplete={(v) => {
            seekTo(v);
            // Hold the drag position briefly so the thumb doesn't snap back
            // before the seek lands.
            setTimeout(() => setDragSec(null), 350);
          }}
        />
        <View style={styles.times}>
          <Text style={styles.time}>{formatSeconds(shownSec)}</Text>
          <Text style={styles.time}>{formatSeconds(durationSec)}</Text>
        </View>
      </View>

      <View style={styles.controls}>
        <Pressable onPress={previous} hitSlop={12}>
          <Ionicons name="play-skip-back" size={32} color="#fff" />
        </Pressable>
        <Pressable onPress={toggle} style={styles.playButton} hitSlop={12}>
          {loading ? (
            <ActivityIndicator color="#000" />
          ) : (
            <Ionicons
              name={playing ? 'pause' : 'play'}
              size={32}
              color="#000"
              style={playing ? undefined : styles.playNudge}
            />
          )}
        </Pressable>
        <Pressable onPress={next} hitSlop={12}>
          <Ionicons name="play-skip-forward" size={32} color="#fff" />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0b0b0f',
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 28,
  },
  art: { width: 320, height: 320, borderRadius: 16, maxWidth: '90%' },
  artPlaceholder: { backgroundColor: '#17171d', alignItems: 'center', justifyContent: 'center' },
  playNudge: { marginLeft: 4 },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 12,
    width: '100%',
  },
  meta: { flex: 1, alignItems: 'center', gap: 6 },
  title: { color: '#fff', fontSize: 22, fontWeight: '800', textAlign: 'center' },
  artist: { color: '#999', fontSize: 15 },
  badge: { color: '#ff9f6b', fontSize: 12, marginTop: 4 },
  scrubWrap: { width: '100%' },
  slider: { width: '100%', height: 36 },
  times: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 4 },
  time: { color: '#777', fontSize: 12, fontVariant: ['tabular-nums'] },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 40 },
  skip: { color: '#fff', fontSize: 34 },
  playButton: {
    backgroundColor: '#fff',
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playGlyph: { color: '#000', fontSize: 30 },
});
