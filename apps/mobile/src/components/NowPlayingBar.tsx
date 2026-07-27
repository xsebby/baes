import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useAuth } from '../auth';
import { usePlayer } from '../player';

export function NowPlayingBar() {
  const { client } = useAuth();
  const { current, playing, toggle, next, positionSec, durationSec } = usePlayer();

  if (!current || !client) return null;
  const progress = durationSec > 0 ? Math.min(positionSec / durationSec, 1) : 0;

  return (
    <Pressable style={styles.wrap} onPress={() => router.push('/player')}>
      <View style={[styles.progress, { width: `${progress * 100}%` }]} />
      <View style={styles.row}>
        {current.artUrl ? (
          <Image source={{ uri: client.mediaUrl(current.artUrl) }} style={styles.art} />
        ) : (
          <View style={[styles.art, styles.artPlaceholder]}>
            <Ionicons name="musical-note" size={16} color="#666" />
          </View>
        )}
        <View style={styles.meta}>
          <Text style={styles.title} numberOfLines={1}>
            {current.title}
          </Text>
          <Text style={styles.artist} numberOfLines={1}>
            {current.artistName ?? 'Unknown artist'}
          </Text>
        </View>
        <Pressable
          onPress={(e) => {
            e.stopPropagation();
            toggle();
          }}
          style={styles.button}
          hitSlop={8}
        >
          <Ionicons name={playing ? 'pause' : 'play'} size={24} color="#fff" />
        </Pressable>
        <Pressable
          onPress={(e) => {
            e.stopPropagation();
            next();
          }}
          style={styles.button}
          hitSlop={8}
        >
          <Ionicons name="play-skip-forward" size={22} color="#fff" />
        </Pressable>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: '#17171d',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#2a2a33',
  },
  progress: { height: 2, backgroundColor: '#8ab4ff' },
  row: { flexDirection: 'row', alignItems: 'center', padding: 10, gap: 12 },
  art: { width: 40, height: 40, borderRadius: 6 },
  artPlaceholder: { backgroundColor: '#2a2a33', alignItems: 'center', justifyContent: 'center' },
  artGlyph: { color: '#666', fontSize: 18 },
  meta: { flex: 1 },
  title: { color: '#fff', fontSize: 14, fontWeight: '600' },
  artist: { color: '#999', fontSize: 12, marginTop: 2 },
  button: { paddingHorizontal: 6 },
  buttonText: { color: '#fff', fontSize: 22 },
});
