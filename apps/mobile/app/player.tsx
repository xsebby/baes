import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Slider from '@react-native-community/slider';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../src/auth';
import { formatSeconds, usePlayer } from '../src/player';

export default function NowPlaying() {
  const { client } = useAuth();
  const insets = useSafeAreaInsets();
  const {
    current,
    playing,
    loading,
    positionSec,
    durationSec,
    rate,
    keepPitch,
    shuffle,
    toggleShuffle,
    setRate,
    setKeepPitch,
    toggle,
    next,
    previous,
    seekTo,
  } = usePlayer();
  // While dragging, show the drag position instead of live playback position.
  const [dragSec, setDragSec] = useState<number | null>(null);
  const [liked, setLiked] = useState(false);
  const [colors, setColors] = useState<string[]>(['#1b1730', '#101b26', '#0b0b0f']);
  const [showSpeed, setShowSpeed] = useState(false);
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 5200,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 5200,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  useEffect(() => {
    if (!client || !current?.albumId) return;
    client
      .artColors(current.albumId)
      .then((r) => setColors(r.colors.slice(0, 3)))
      .catch(() => {});
  }, [client, current?.albumId]);

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

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.25] });
  const drift = pulse.interpolate({ inputRange: [0, 1], outputRange: [0, -30] });

  return (
    <View style={[styles.container, { paddingBottom: 24 + insets.bottom }]}>
      <LinearGradient
        colors={[colors[0] ?? '#1b1730', '#0b0b0f']}
        style={StyleSheet.absoluteFill}
      />
      <Animated.View
        pointerEvents="none"
        style={[
          styles.blob,
          {
            backgroundColor: colors[1] ?? '#101b26',
            top: -80,
            right: -100,
            transform: [{ scale }, { translateY: drift }],
          },
        ]}
      />
      <Animated.View
        pointerEvents="none"
        style={[
          styles.blob,
          {
            backgroundColor: colors[2] ?? colors[0] ?? '#1b1730',
            bottom: 40,
            left: -120,
            transform: [{ scale }, { translateY: Animated.multiply(drift, -1) }],
          },
        ]}
      />
      <BlurView intensity={85} tint="dark" pointerEvents="none" style={StyleSheet.absoluteFill} />
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
        <Pressable onPress={() => setShowSpeed(true)} hitSlop={12} style={styles.rateBtn}>
          <Text style={styles.rateText}>{rate.toFixed(2).replace(/0$/, '')}×</Text>
        </Pressable>
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
        <Pressable onPress={toggleShuffle} hitSlop={12} style={styles.rateBtn}>
          <Ionicons name="shuffle" size={22} color={shuffle ? '#8ab4ff' : '#777'} />
        </Pressable>
      </View>

      <Modal visible={showSpeed} transparent animationType="fade">
        <Pressable style={styles.speedBackdrop} onPress={() => setShowSpeed(false)}>
          <Pressable style={styles.speedSheet} onPress={() => {}}>
            <View style={styles.speedHead}>
              <Text style={styles.speedLabel}>Playback speed</Text>
              <Text style={styles.speedValue}>{rate.toFixed(2)}×</Text>
            </View>
            <Slider
              style={{ width: '100%', height: 36 }}
              minimumValue={0.5}
              maximumValue={1.5}
              step={0.05}
              value={rate}
              minimumTrackTintColor="#8ab4ff"
              maximumTrackTintColor="#2a2a33"
              thumbTintColor="#fff"
              onValueChange={setRate}
            />
            <View style={styles.presetRow}>
              {[0.8, 0.9, 1, 1.15, 1.25].map((r) => (
                <Pressable
                  key={r}
                  style={[styles.preset, rate === r && styles.presetActive]}
                  onPress={() => setRate(r)}
                >
                  <Text style={[styles.presetText, rate === r && styles.presetTextActive]}>
                    {r}×
                  </Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.presetRow}>
              <Pressable
                style={styles.mode}
                onPress={() => {
                  const semis = Math.round(12 * Math.log2(rate)) - 1;
                  if (semis < -7) return;
                  setKeepPitch(false);
                  setRate(Number(Math.pow(2, semis / 12).toFixed(4)));
                }}
              >
                <Text style={styles.presetText}>− st</Text>
              </Pressable>
              <View style={[styles.mode, { backgroundColor: 'transparent' }]}>
                <Text style={[styles.presetText, { color: '#8ab4ff' }]}>
                  {(() => {
                    const st = Math.round(12 * Math.log2(rate));
                    return `${st > 0 ? '+' : ''}${st} st`;
                  })()}
                </Text>
              </View>
              <Pressable
                style={styles.mode}
                onPress={() => {
                  const semis = Math.round(12 * Math.log2(rate)) + 1;
                  if (semis > 7) return;
                  setKeepPitch(false);
                  setRate(Number(Math.pow(2, semis / 12).toFixed(4)));
                }}
              >
                <Text style={styles.presetText}>+ st</Text>
              </Pressable>
            </View>
            <View style={styles.presetRow}>
              <Pressable
                style={[styles.mode, keepPitch && styles.presetActive]}
                onPress={() => setKeepPitch(true)}
              >
                <Text style={[styles.presetText, keepPitch && styles.presetTextActive]}>
                  Keep pitch
                </Text>
              </Pressable>
              <Pressable
                style={[styles.mode, !keepPitch && styles.presetActive]}
                onPress={() => setKeepPitch(false)}
              >
                <Text style={[styles.presetText, !keepPitch && styles.presetTextActive]}>
                  Slowed / sped
                </Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  blob: {
    position: 'absolute',
    width: 340,
    height: 340,
    borderRadius: 170,
    opacity: 0.35,
  },
  rateBtn: { width: 44, alignItems: 'center' },
  rateText: { color: '#ddd', fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  speedBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  speedSheet: {
    backgroundColor: '#17171d',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 22,
    paddingBottom: 40,
    gap: 8,
  },
  speedHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  speedLabel: { color: '#999', fontSize: 13 },
  speedValue: { color: '#8ab4ff', fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] },
  presetRow: { flexDirection: 'row', gap: 8, marginTop: 6 },
  preset: {
    backgroundColor: '#22222a',
    borderRadius: 14,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  mode: {
    flex: 1,
    backgroundColor: '#22222a',
    borderRadius: 14,
    paddingVertical: 9,
    alignItems: 'center',
  },
  presetActive: { backgroundColor: '#fff' },
  presetText: { color: '#999', fontSize: 13, fontWeight: '600' },
  presetTextActive: { color: '#000' },
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
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 22,
  },
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
