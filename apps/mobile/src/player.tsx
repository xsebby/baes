import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import TrackPlayer, {
  AppKilledPlaybackBehavior,
  Capability,
  Event,
  RepeatMode,
  useActiveTrack,
  useIsPlaying,
  useProgress,
  useTrackPlayerEvents,
} from 'react-native-track-player';
import type { Track } from '@baes/core';
import { useAuth } from './auth';
import { useDownloads } from './downloads';

interface PlayerState {
  current: Track | null;
  queue: Track[];
  playing: boolean;
  loading: boolean;
  positionSec: number;
  durationSec: number;
  rate: number;
  keepPitch: boolean;
  shuffle: boolean;
  toggleShuffle: () => void;
  setRate: (r: number) => void;
  setKeepPitch: (b: boolean) => void;
  playTrack: (track: Track, queue?: Track[]) => void;
  toggle: () => void;
  next: () => void;
  previous: () => void;
  seekTo: (seconds: number) => void;
}

const PlayerContext = createContext<PlayerState | null>(null);

/** Signed stream URLs carry their expiry; fresh = >90s of validity left. */
function urlIsFresh(streamPath: string): boolean {
  const m = /[?&]exp=(\d+)/.exec(streamPath);
  if (!m) return false;
  return Number(m[1]) * 1000 - Date.now() > 90 * 1000;
}

function shuffledFrom<T>(items: T[], firstIndex: number): T[] {
  const rest = items.filter((_, i) => i !== firstIndex);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j]!, rest[i]!];
  }
  return [items[firstIndex]!, ...rest];
}

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const { client } = useAuth();
  const { localUri } = useDownloads();
  const [queue, setQueue] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [rate, setRateState] = useState(1);
  const [keepPitch, setKeepPitchState] = useState(true);
  const [shuffle, setShuffle] = useState(false);
  const [ready, setReady] = useState(false);

  const rateRef = useRef(1);
  const keepPitchRef = useRef(true);
  const shuffleRef = useRef(false);
  const queueRef = useRef<Track[]>([]);
  queueRef.current = queue;

  const activeTrack = useActiveTrack();
  const { playing } = useIsPlaying();
  const progress = useProgress(500);

  // Whatever the native player is on — the lock screen and headphone buttons
  // can change tracks without going through us.
  const current = useMemo(() => {
    const id = activeTrack?.id as string | undefined;
    if (!id) return null;
    return queue.find((t) => t.id === id) ?? null;
  }, [activeTrack, queue]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await TrackPlayer.setupPlayer({ autoHandleInterruptions: true });
      } catch {
        // already initialised by a previous mount
      }
      if (cancelled) return;
      await TrackPlayer.updateOptions({
        android: {
          appKilledPlaybackBehavior: AppKilledPlaybackBehavior.StopPlaybackAndRemoveNotification,
        },
        capabilities: [
          Capability.Play,
          Capability.Pause,
          Capability.SkipToNext,
          Capability.SkipToPrevious,
          Capability.SeekTo,
        ],
        compactCapabilities: [Capability.Play, Capability.Pause, Capability.SkipToNext],
      });
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Rate resets per item — re-apply whenever the native player advances.
  useTrackPlayerEvents([Event.PlaybackActiveTrackChanged], () => {
    void TrackPlayer.setRate(rateRef.current);
  });

  const toRNTrack = useCallback(
    async (t: Track, resolveUrl: boolean) => {
      const local = localUri(t.id);
      let url: string;
      if (local) {
        url = local;
      } else {
        let streamPath = t.streamUrl;
        if (resolveUrl && !urlIsFresh(streamPath)) {
          try {
            streamPath = (await client!.refreshStreamUrl(t.id)).url;
          } catch {
            // offline or transient failure — fall through with what we have
          }
        }
        url = `${client!.mediaUrl(streamPath)}&profile=compat`;
      }
      return {
        id: t.id,
        url,
        title: t.title,
        artist: t.artistName ?? 'Unknown artist',
        album: t.albumTitle ?? undefined,
        artwork: t.artUrl ? client!.mediaUrl(t.artUrl) : undefined,
        duration: t.durationMs / 1000,
      };
    },
    [client, localUri],
  );

  const playTrack = useCallback(
    (track: Track, newQueue?: Track[]) => {
      if (!client || !ready) return;
      const base = newQueue ?? queueRef.current;
      const startIndex = Math.max(
        0,
        base.findIndex((t) => t.id === track.id),
      );
      const ordered = shuffleRef.current ? shuffledFrom(base, startIndex) : base;
      const orderedStart = shuffleRef.current
        ? 0
        : Math.max(
            0,
            ordered.findIndex((t) => t.id === track.id),
          );

      setQueue(ordered);
      setLoading(true);
      void (async () => {
        try {
          // Only the starting track needs a guaranteed-fresh signed URL; the
          // rest still have plenty of validity when they come around.
          const rnTracks = await Promise.all(
            ordered.map((t, i) => toRNTrack(t, i === orderedStart)),
          );
          await TrackPlayer.setQueue(rnTracks);
          await TrackPlayer.skip(orderedStart);
          await TrackPlayer.setRate(rateRef.current);
          await TrackPlayer.play();
        } catch {
          // playback failed to start; UI stays on the previous track
        } finally {
          setLoading(false);
        }
      })();
    },
    [client, ready, toRNTrack],
  );

  const toggle = useCallback(() => {
    if (playing) void TrackPlayer.pause();
    else void TrackPlayer.play();
  }, [playing]);

  const seekTo = useCallback((seconds: number) => {
    void TrackPlayer.seekTo(seconds);
  }, []);

  const next = useCallback(() => {
    void TrackPlayer.skipToNext().catch(() => {});
  }, []);

  /** Restart the track first, like every other music player. */
  const previous = useCallback(() => {
    if (progress.position > 3) {
      void TrackPlayer.seekTo(0);
      return;
    }
    void TrackPlayer.skipToPrevious().catch(() => TrackPlayer.seekTo(0));
  }, [progress.position]);

  const setRate = useCallback((r: number) => {
    rateRef.current = r;
    setRateState(r);
    void TrackPlayer.setRate(r);
  }, []);

  const setKeepPitch = useCallback((b: boolean) => {
    keepPitchRef.current = b;
    setKeepPitchState(b);
    // Re-assert so the change lands on the current item.
    void TrackPlayer.setRate(rateRef.current);
  }, []);

  const toggleShuffle = useCallback(() => {
    shuffleRef.current = !shuffleRef.current;
    setShuffle(shuffleRef.current);
    void TrackPlayer.setRepeatMode(RepeatMode.Off);
  }, []);

  const value = useMemo<PlayerState>(
    () => ({
      current,
      queue,
      playing: playing ?? false,
      loading,
      positionSec: progress.position,
      durationSec: progress.duration,
      rate,
      keepPitch,
      shuffle,
      toggleShuffle,
      setRate,
      setKeepPitch,
      playTrack,
      toggle,
      next,
      previous,
      seekTo,
    }),
    [
      current,
      queue,
      playing,
      loading,
      progress.position,
      progress.duration,
      rate,
      keepPitch,
      shuffle,
      toggleShuffle,
      setRate,
      setKeepPitch,
      playTrack,
      toggle,
      next,
      previous,
      seekTo,
    ],
  );

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export function usePlayer(): PlayerState {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayer must be used within PlayerProvider');
  return ctx;
}

export function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function formatSeconds(sec: number): string {
  return formatDuration(sec * 1000);
}
