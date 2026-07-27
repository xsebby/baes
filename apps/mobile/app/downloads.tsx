import { Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { usePlayer } from '../src/player';
import { formatBytes, useDownloads } from '../src/downloads';
import { NowPlayingBar } from '../src/components/NowPlayingBar';
import { TrackRow } from '../src/components/TrackRow';

export default function DownloadsScreen() {
  const { entries, totalBytes, activeId, queueLength, remove, removeAll } = useDownloads();
  const { playTrack } = usePlayer();

  const list = Object.values(entries).sort((a, b) => b.downloadedAt.localeCompare(a.downloadedAt));
  const queue = list.map((e) => e.track);

  return (
    <View style={styles.container}>
      <FlatList
        data={list}
        keyExtractor={(e) => e.track.id}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.title}>Downloads</Text>
            <Text style={styles.meta}>
              {list.length} tracks · {formatBytes(totalBytes)}
              {queueLength > 0 ? ` · downloading ${queueLength}…` : ''}
            </Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              {queue.length > 0 && (
                <Pressable style={styles.playAll} onPress={() => playTrack(queue[0]!, queue)}>
                  <Ionicons name="play" size={18} color="#000" />
                  <Text style={styles.playAllText}>Play</Text>
                </Pressable>
              )}
              {list.length > 0 && (
                <Pressable
                  style={styles.clear}
                  onPress={() =>
                    Alert.alert('Remove all downloads?', formatBytes(totalBytes), [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Remove all', style: 'destructive', onPress: removeAll },
                    ])
                  }
                >
                  <Text style={styles.clearText}>Clear all</Text>
                </Pressable>
              )}
            </View>
          </View>
        }
        ListEmptyComponent={
          <Text style={styles.emptyText}>
            {activeId
              ? 'Downloading…'
              : 'Long-press a track (or use a playlist’s ⤓) to make it available offline.'}
          </Text>
        }
        renderItem={({ item }) => (
          <TrackRow
            track={item.track}
            queue={queue}
            trailing={
              <Pressable onPress={() => remove(item.track.id)} hitSlop={10}>
                <Ionicons name="trash-outline" size={18} color="#666" />
              </Pressable>
            }
          />
        )}
      />
      <NowPlayingBar />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0b0f' },
  header: { padding: 20, gap: 8 },
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
    marginTop: 6,
  },
  playAllText: { color: '#000', fontWeight: '700', fontSize: 15 },
  clear: {
    alignSelf: 'flex-start',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#333',
    paddingHorizontal: 18,
    paddingVertical: 10,
    marginTop: 6,
  },
  clearText: { color: '#ff6b6b', fontSize: 14, fontWeight: '600' },
  emptyText: { color: '#666', fontSize: 14, textAlign: 'center', marginTop: 30, padding: 20 },
});
