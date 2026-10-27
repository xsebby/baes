import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { DuplicateGroup, DuplicateStatus, DuplicateTrack } from '@baes/core';
import { useAuth } from '../src/auth';
import { formatDuration, usePlayer } from '../src/player';
import { NowPlayingBar } from '../src/components/NowPlayingBar';

/** Tracks the fingerprinter thinks are the same recording, for the owner to review. */
export default function DuplicatesScreen() {
  const { client } = useAuth();
  const { playTrack, current, playing } = usePlayer();
  const [status, setStatus] = useState<DuplicateStatus | null>(null);
  const [groups, setGroups] = useState<DuplicateGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    if (!client) return;
    try {
      const r = await client.listDuplicates();
      setStatus(r.status);
      setGroups(r.groups);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load duplicates');
    }
  }, [client]);

  useEffect(() => {
    load();
  }, [load]);

  // Refresh while detection runs so new groups appear as they're found.
  useEffect(() => {
    if (status?.running && !poll.current) {
      poll.current = setInterval(load, 2000);
    } else if (!status?.running && poll.current) {
      clearInterval(poll.current);
      poll.current = null;
    }
    return () => {
      if (poll.current) clearInterval(poll.current);
      poll.current = null;
    };
  }, [status?.running, load]);

  async function checkNow() {
    if (!client) return;
    try {
      setStatus(await client.findDuplicates());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start');
    }
  }

  async function dismiss(group: DuplicateGroup) {
    if (!client) return;
    await client.dismissDuplicates(group.tracks.map((t) => t.id));
    load();
  }

  function remove(track: DuplicateTrack) {
    Alert.alert(
      'Delete this copy?',
      `${track.fileName}\n\nThe other copies stay in your library.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await client?.deleteTrack(track.id);
            } catch (e) {
              Alert.alert("Couldn't delete", e instanceof Error ? e.message : undefined);
            }
            load();
          },
        },
      ],
    );
  }

  if (!groups && !error) return <ActivityIndicator color="#fff" style={{ marginTop: 60 }} />;

  const statusLine = !status?.enabled
    ? 'Duplicate detection is off on this server (FP_BIN not set).'
    : status.running
      ? 'Checking for duplicates…'
      : `${status.fingerprinted} tracks fingerprinted${
          status.lastRunAt ? ` · last checked ${new Date(status.lastRunAt).toLocaleString()}` : ''
        }`;

  return (
    <View style={styles.container}>
      <FlatList
        data={groups ?? []}
        keyExtractor={(g) => g.tracks.map((t) => t.id).join()}
        contentContainerStyle={{ paddingBottom: 24 }}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.title}>Possible duplicates</Text>
            <Text style={styles.meta}>
              Same recording under different files: re-uploads, re-encodes, renamed copies.
            </Text>
            <Text style={styles.status}>{statusLine}</Text>
            {status?.lastError ? <Text style={styles.error}>{status.lastError}</Text> : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}
            {status?.enabled && (
              <Pressable
                style={[styles.check, status.running && { opacity: 0.4 }]}
                disabled={status.running}
                onPress={checkNow}
              >
                <Text style={styles.checkText}>{status.running ? 'Checking…' : 'Check now'}</Text>
              </Pressable>
            )}
          </View>
        }
        ListEmptyComponent={
          status?.enabled && !status.running ? (
            <Text style={styles.empty}>No duplicates found.</Text>
          ) : null
        }
        renderItem={({ item: group }) => (
          <View style={styles.group}>
            {group.tracks.map((t) => {
              const isCurrent = current?.id === t.id;
              return (
                <View key={t.id} style={styles.row}>
                  <Pressable onPress={() => playTrack(t, group.tracks)} hitSlop={8}>
                    <Ionicons
                      name={isCurrent && playing ? 'pause-circle' : 'play-circle'}
                      size={30}
                      color={isCurrent ? '#8ab4ff' : '#ddd'}
                    />
                  </Pressable>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.trackTitle} numberOfLines={1}>
                      {t.title}
                    </Text>
                    <Text style={styles.trackSub} numberOfLines={1}>
                      {t.fileName}
                    </Text>
                    <Text style={styles.trackSub}>
                      {[
                        t.codec.toUpperCase(),
                        t.bitrate ? `${Math.round(t.bitrate / 1000)} kbps` : null,
                        formatDuration(t.durationMs),
                        t.artistName,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  </View>
                  <Pressable onPress={() => remove(t)} hitSlop={8}>
                    <Ionicons name="trash-outline" size={20} color="#ff6b8a" />
                  </Pressable>
                </View>
              );
            })}
            <Pressable style={styles.dismiss} onPress={() => dismiss(group)}>
              <Text style={styles.dismissText}>Not duplicates</Text>
            </Pressable>
          </View>
        )}
      />
      <NowPlayingBar />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0b0f' },
  header: { padding: 20, gap: 6 },
  title: { color: '#fff', fontSize: 26, fontWeight: '800' },
  meta: { color: '#888', fontSize: 13, lineHeight: 18 },
  status: { color: '#aaa', fontSize: 13, marginTop: 6 },
  error: { color: '#ff6b6b', fontSize: 13 },
  check: {
    alignSelf: 'flex-start',
    backgroundColor: '#8ab4ff',
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingVertical: 8,
    marginTop: 8,
  },
  checkText: { color: '#000', fontWeight: '700' },
  empty: { color: '#666', fontSize: 14, textAlign: 'center', marginTop: 20 },
  group: {
    backgroundColor: '#141419',
    borderRadius: 14,
    marginHorizontal: 12,
    marginBottom: 12,
    paddingVertical: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  trackTitle: { color: '#fff', fontSize: 15, fontWeight: '600' },
  trackSub: { color: '#888', fontSize: 12, marginTop: 2 },
  dismiss: {
    alignItems: 'center',
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#26262e',
  },
  dismissText: { color: '#8ab4ff', fontSize: 14, fontWeight: '600' },
});
