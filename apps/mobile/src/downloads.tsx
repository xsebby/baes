import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Directory, File, Paths } from 'expo-file-system';
import type { Track } from '@baes/core';
import { useAuth } from './auth';

export interface DownloadEntry {
  /** Metadata snapshot so downloads render fully offline. */
  track: Track;
  fileUri: string;
  bytes: number;
  downloadedAt: string;
}

interface DownloadsState {
  entries: Record<string, DownloadEntry>;
  totalBytes: number;
  activeId: string | null;
  queueLength: number;
  isDownloaded: (trackId: string) => boolean;
  localUri: (trackId: string) => string | null;
  download: (tracks: Track[]) => void;
  remove: (trackId: string) => void;
  removeAll: () => void;
}

const DownloadsContext = createContext<DownloadsState | null>(null);

function downloadsDir(): Directory {
  return new Directory(Paths.document, 'downloads');
}

function indexFile(): File {
  return new File(downloadsDir(), 'index.json');
}

function extFromTrack(track: Track): string {
  const codec = track.codec.toLowerCase();
  if (codec.includes('flac')) return 'flac';
  if (codec.includes('wav') || codec.includes('pcm')) return 'wav';
  if (codec.includes('aac') || codec.includes('mp4')) return 'm4a';
  if (codec.includes('ogg') || codec.includes('vorbis')) return 'ogg';
  if (codec.includes('opus')) return 'opus';
  return 'mp3';
}

export function DownloadsProvider({ children }: { children: React.ReactNode }) {
  const { client } = useAuth();
  const [entries, setEntries] = useState<Record<string, DownloadEntry>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [queueLength, setQueueLength] = useState(0);
  const queueRef = useRef<Track[]>([]);
  const runningRef = useRef(false);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  // Load the persisted index on boot.
  useEffect(() => {
    try {
      downloadsDir().create({ intermediates: true, idempotent: true });
      const f = indexFile();
      if (f.exists) {
        const parsed = JSON.parse(f.textSync()) as Record<string, DownloadEntry>;
        // Drop entries whose audio file vanished (e.g. OS cleared storage).
        const alive: Record<string, DownloadEntry> = {};
        for (const [id, e] of Object.entries(parsed)) {
          if (new File(e.fileUri).exists) alive[id] = e;
        }
        setEntries(alive);
      }
    } catch {
      // corrupted index — start fresh; audio files get re-linked on re-download
    }
  }, []);

  const persist = useCallback((next: Record<string, DownloadEntry>) => {
    setEntries(next);
    try {
      indexFile().write(JSON.stringify(next));
    } catch {
      // persistence is best-effort; entries survive in memory for the session
    }
  }, []);

  const pump = useCallback(async () => {
    if (runningRef.current || !client) return;
    runningRef.current = true;
    while (queueRef.current.length > 0) {
      const track = queueRef.current[0]!;
      setQueueLength(queueRef.current.length);
      setActiveId(track.id);
      try {
        if (!entriesRef.current[track.id]) {
          const { url } = await client.refreshStreamUrl(track.id);
          const dest = new File(downloadsDir(), `${track.id}.${extFromTrack(track)}`);
          if (dest.exists) dest.delete();
          const task = File.createDownloadTask(client.mediaUrl(url), dest);
          const file = await task.downloadAsync();
          if (!file) throw new Error('download failed');
          persist({
            ...entriesRef.current,
            [track.id]: {
              track,
              fileUri: file.uri,
              bytes: file.size ?? 0,
              downloadedAt: new Date().toISOString(),
            },
          });
        }
      } catch {
        // skip failed track; continue with the rest of the queue
      }
      queueRef.current.shift();
    }
    setActiveId(null);
    setQueueLength(0);
    runningRef.current = false;
  }, [client, persist]);

  const download = useCallback(
    (tracks: Track[]) => {
      const queuedOrDone = new Set([
        ...Object.keys(entriesRef.current),
        ...queueRef.current.map((t) => t.id),
      ]);
      const fresh = tracks.filter((t) => !queuedOrDone.has(t.id));
      if (fresh.length === 0) return;
      queueRef.current.push(...fresh);
      setQueueLength(queueRef.current.length);
      void pump();
    },
    [pump],
  );

  const remove = useCallback(
    (trackId: string) => {
      const entry = entriesRef.current[trackId];
      if (!entry) return;
      try {
        const f = new File(entry.fileUri);
        if (f.exists) f.delete();
      } catch {
        // file already gone
      }
      const next = { ...entriesRef.current };
      delete next[trackId];
      persist(next);
    },
    [persist],
  );

  const removeAll = useCallback(() => {
    for (const id of Object.keys(entriesRef.current)) remove(id);
  }, [remove]);

  const value = useMemo<DownloadsState>(() => {
    const totalBytes = Object.values(entries).reduce((s, e) => s + e.bytes, 0);
    return {
      entries,
      totalBytes,
      activeId,
      queueLength,
      isDownloaded: (id) => Boolean(entries[id]),
      localUri: (id) => entries[id]?.fileUri ?? null,
      download,
      remove,
      removeAll,
    };
  }, [entries, activeId, queueLength, download, remove, removeAll]);

  return <DownloadsContext.Provider value={value}>{children}</DownloadsContext.Provider>;
}

export function useDownloads(): DownloadsState {
  const ctx = useContext(DownloadsContext);
  if (!ctx) throw new Error('useDownloads must be used within DownloadsProvider');
  return ctx;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
