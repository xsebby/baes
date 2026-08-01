import { useCallback, useEffect, useState } from 'react';
import { Image, type ImageStyle, type StyleProp, View } from 'react-native';
import { Directory, File, Paths } from 'expo-file-system';

/**
 * Offline support for browsing: every library payload the app fetches is
 * mirrored to disk, and cover art is cached alongside it. When the network is
 * unavailable the screens fall back to the last known good copy, so albums,
 * artists and playlists stay navigable and their downloaded tracks playable.
 */

function cacheDir(): Directory {
  return new Directory(Paths.document, 'cache');
}

function artDir(): Directory {
  return new Directory(Paths.document, 'artcache');
}

function ensureDirs(): void {
  try {
    cacheDir().create({ intermediates: true, idempotent: true });
    artDir().create({ intermediates: true, idempotent: true });
  } catch {
    // already exists
  }
}

function safeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export function writeCache(key: string, value: unknown): void {
  try {
    ensureDirs();
    new File(cacheDir(), `${safeKey(key)}.json`).write(JSON.stringify(value));
  } catch {
    // best-effort; caching must never break a working screen
  }
}

export function readCache<T>(key: string): T | null {
  try {
    const f = new File(cacheDir(), `${safeKey(key)}.json`);
    if (!f.exists) return null;
    return JSON.parse(f.textSync()) as T;
  } catch {
    return null;
  }
}

export function clearCache(): void {
  try {
    const dir = cacheDir();
    if (dir.exists) dir.delete();
    const art = artDir();
    if (art.exists) art.delete();
  } catch {
    // best-effort
  }
}

/**
 * Fetch with cache fallback. Returns cached data immediately when present so
 * screens paint instantly, then refreshes from the network in the background.
 */
export function useCachedData<T>(
  key: string,
  fetcher: (() => Promise<T>) | null,
): {
  data: T | null;
  fromCache: boolean;
  error: string | null;
  reload: () => void;
} {
  const [data, setData] = useState<T | null>(() => readCache<T>(key));
  const [fromCache, setFromCache] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(() => {
    if (!fetcher) return;
    fetcher()
      .then((fresh) => {
        setData(fresh);
        setFromCache(false);
        setError(null);
        writeCache(key, fresh);
      })
      .catch((e) => {
        const cached = readCache<T>(key);
        if (cached) {
          setData(cached);
          setFromCache(true);
          setError(null);
        } else {
          setError(e instanceof Error ? e.message : 'Failed to load');
        }
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, fetcher]);

  useEffect(run, [run]);

  return { data, fromCache, error, reload: run };
}

/**
 * Cover art that survives going offline: the first successful load is written
 * to disk and reused thereafter. Signed URLs change every request, so the cache
 * is keyed by the album/playlist id instead of the URL.
 */
export function CachedImage({
  id,
  remoteUri,
  style,
  placeholder,
}: {
  id: string | null | undefined;
  remoteUri: string | null | undefined;
  style?: StyleProp<ImageStyle>;
  placeholder?: React.ReactNode;
}) {
  const [uri, setUri] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!id) {
      setUri(null);
      return;
    }
    ensureDirs();
    const dest = new File(artDir(), `${safeKey(id)}.img`);
    if (dest.exists) {
      setUri(dest.uri);
      return;
    }
    if (!remoteUri) {
      setUri(null);
      return;
    }
    // Show the remote image now, persist a copy for offline use.
    setUri(remoteUri);
    (async () => {
      try {
        const file = await File.createDownloadTask(remoteUri, dest).downloadAsync();
        if (!cancelled && file) setUri(file.uri);
      } catch {
        // offline or transient failure — remote URI already set
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, remoteUri]);

  if (!uri) return <View style={style}>{placeholder}</View>;
  return <Image source={{ uri }} style={style} onError={() => setUri(null)} />;
}
