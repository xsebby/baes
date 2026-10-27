import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { ShareLink } from '@baes/core';
import { useAuth } from '../src/auth';
import { shareLink } from '../src/share-link';

/** Every active share link, for the owner to resend or revoke. */
export default function SharesScreen() {
  const { client } = useAuth();
  const [links, setLinks] = useState<ShareLink[] | null>(null);

  const load = useCallback(async () => {
    if (!client) return;
    const r = await client.listShares().catch(() => ({ shares: [] as ShareLink[] }));
    setLinks(r.shares);
  }, [client]);

  useEffect(() => {
    load();
  }, [load]);

  function revoke(link: ShareLink) {
    Alert.alert('Revoke this link?', 'Anyone who has it will lose access.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Revoke',
        style: 'destructive',
        onPress: async () => {
          await client?.revokeShare(link.id);
          load();
        },
      },
    ]);
  }

  if (!links) return <ActivityIndicator color="#fff" style={{ marginTop: 60 }} />;

  return (
    <FlatList
      style={styles.container}
      data={links}
      keyExtractor={(l) => l.id}
      contentContainerStyle={{ padding: 16, gap: 10 }}
      ListHeaderComponent={<Text style={styles.title}>Shared links</Text>}
      ListEmptyComponent={
        <Text style={styles.empty}>No links yet. Share a playlist or a song from the player.</Text>
      }
      renderItem={({ item: l }) => (
        <View style={[styles.link, l.expired && { opacity: 0.45 }]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.linkTitle} numberOfLines={1}>
              {l.kind === 'playlist' ? 'Playlist · ' : ''}
              {l.title}
            </Text>
            <Text style={styles.hint}>
              {l.expired
                ? 'Expired'
                : l.expiresAt
                  ? `Expires ${new Date(l.expiresAt).toLocaleDateString()}`
                  : 'Never expires'}
              {' · '}
              {l.allowDownload ? 'downloads on' : 'no downloads'} · {l.views} view
              {l.views === 1 ? '' : 's'}
            </Text>
          </View>
          {!l.expired && (
            <Pressable onPress={() => shareLink(l.url)} hitSlop={8}>
              <Text style={styles.action}>Send</Text>
            </Pressable>
          )}
          <Pressable onPress={() => revoke(l)} hitSlop={8}>
            <Text style={[styles.action, { color: '#ff6b8a' }]}>
              {l.expired ? 'Remove' : 'Revoke'}
            </Text>
          </Pressable>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0b0f' },
  title: { color: '#fff', fontSize: 26, fontWeight: '800', marginBottom: 6 },
  empty: { color: '#666', fontSize: 14, textAlign: 'center', marginTop: 20 },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: '#141419',
    borderRadius: 12,
    padding: 12,
  },
  linkTitle: { color: '#fff', fontSize: 15, fontWeight: '600' },
  hint: { color: '#888', fontSize: 12, marginTop: 2 },
  action: { color: '#8ab4ff', fontWeight: '600' },
});
