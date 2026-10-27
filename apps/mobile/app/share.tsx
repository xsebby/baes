import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import type { ShareLink } from '@baes/core';
import { useAuth } from '../src/auth';
import { shareLink } from '../src/share-link';

const EXPIRY: { label: string; days: number | null }[] = [
  { label: '1 day', days: 1 },
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: 'Never', days: null },
];

/** Create and manage unlisted links for one playlist or track. */
export default function ShareScreen() {
  const { kind, id, title } = useLocalSearchParams<{
    kind: 'playlist' | 'track';
    id: string;
    title: string;
  }>();
  const { client } = useAuth();
  const [days, setDays] = useState<number | null>(7);
  const [allowDownload, setAllowDownload] = useState(true);
  const [busy, setBusy] = useState(false);
  const [links, setLinks] = useState<ShareLink[] | null>(null);

  const load = useCallback(async () => {
    if (!client) return;
    const r = await client.listShares().catch(() => ({ shares: [] as ShareLink[] }));
    setLinks(r.shares.filter((s) => s.targetId === id && !s.expired));
  }, [client, id]);

  useEffect(() => {
    load();
  }, [load]);

  async function send(link: ShareLink) {
    await shareLink(link.url);
  }

  async function create() {
    if (!client || !kind || !id) return;
    setBusy(true);
    try {
      const link = await client.createShare({
        kind,
        targetId: id,
        allowDownload,
        expiresInDays: days,
      });
      await load();
      await send(link);
    } catch (e) {
      Alert.alert("Couldn't create link", e instanceof Error ? e.message : undefined);
    } finally {
      setBusy(false);
    }
  }

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

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 20, gap: 14 }}>
      <Stack.Screen options={{ title: 'Share' }} />
      <Text style={styles.title} numberOfLines={2}>
        {title}
      </Text>
      <Text style={styles.hint}>
        Anyone with the link can listen in their browser, no account needed. Links aren't listed
        anywhere, and you can revoke them anytime.
      </Text>

      <Text style={styles.label}>Link expires</Text>
      <View style={styles.row}>
        {EXPIRY.map((e) => (
          <Pressable
            key={e.label}
            style={[styles.chip, days === e.days && styles.chipOn]}
            onPress={() => setDays(e.days)}
          >
            <Text style={[styles.chipText, days === e.days && styles.chipTextOn]}>{e.label}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.switchRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Allow downloads</Text>
          <Text style={styles.hint}>
            Off hides the download button. Anything that can be streamed can still be saved by
            someone determined.
          </Text>
        </View>
        <Switch value={allowDownload} onValueChange={setAllowDownload} />
      </View>

      <Pressable style={[styles.create, busy && { opacity: 0.5 }]} disabled={busy} onPress={create}>
        {busy ? (
          <ActivityIndicator color="#000" />
        ) : (
          <Text style={styles.createText}>Create link</Text>
        )}
      </Pressable>

      {links && links.length > 0 && (
        <>
          <Text style={[styles.label, { marginTop: 10 }]}>Active links</Text>
          {links.map((l) => (
            <View key={l.id} style={styles.link}>
              <View style={{ flex: 1 }}>
                <Text style={styles.linkUrl} numberOfLines={1}>
                  {l.url}
                </Text>
                <Text style={styles.hint}>
                  {l.expiresAt
                    ? `Expires ${new Date(l.expiresAt).toLocaleDateString()}`
                    : 'Never expires'}
                  {' · '}
                  {l.allowDownload ? 'downloads on' : 'no downloads'} · {l.views} view
                  {l.views === 1 ? '' : 's'}
                </Text>
              </View>
              <Pressable onPress={() => send(l)} hitSlop={8}>
                <Text style={styles.action}>Send</Text>
              </Pressable>
              <Pressable onPress={() => revoke(l)} hitSlop={8}>
                <Text style={[styles.action, { color: '#ff6b8a' }]}>Revoke</Text>
              </Pressable>
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0b0f' },
  title: { color: '#fff', fontSize: 22, fontWeight: '800' },
  hint: { color: '#888', fontSize: 12, lineHeight: 17 },
  label: { color: '#ddd', fontSize: 14, fontWeight: '600' },
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2a2a33',
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  chipOn: { backgroundColor: '#fff', borderColor: '#fff' },
  chipText: { color: '#aaa', fontWeight: '600' },
  chipTextOn: { color: '#000' },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  create: {
    backgroundColor: '#8ab4ff',
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  createText: { color: '#000', fontWeight: '700', fontSize: 15 },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: '#141419',
    borderRadius: 12,
    padding: 12,
  },
  linkUrl: { color: '#fff', fontSize: 13 },
  action: { color: '#8ab4ff', fontWeight: '600' },
});
