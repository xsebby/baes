import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
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
  playTrack: (track: Track, queue?: Track[]) => void;
  toggle: () => void;
  next: () => void;
  previous: () => void;
  seekTo: (seconds: number) => void;
}

const PlayerContext = createContext<PlayerState | null>(null);

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const { client } = useAuth();
  const { localUri } = useDownloads();
  const [current, setCurrent] = useState<Track | null>(null);
  const [queue, setQueue] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);

  useEffect(() => {
    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: true,
      interruptionMode: 'doNotMix',
    }).catch(() => {});
  }, []);

  const playTrack = useCallback(
    (track: Track, newQueue?: Track[]) => {
      if (!client) return;
      setCurrent(track);
      if (newQueue) setQueue(newQueue);
      setLoading(true);
      void (async () => {
        // Downloaded tracks play from disk — instant and fully offline.
        const local = localUri(track.id);
        let uri: string;
        if (local) {
          uri = local;
        } else {
          // Always fetch a fresh signed URL — the one embedded in a library
          // listing may have expired while the app sat open.
          let streamPath = track.streamUrl;
          try {
            const fresh = await client.refreshStreamUrl(track.id);
            streamPath = fresh.url;
          } catch {
            // offline or transient failure — try the embedded URL anyway
          }
          uri = client.mediaUrl(streamPath);
        }
        player.replace({ uri });
        player.play();
        try {
          player.setActiveForLockScreen(
            true,
            {
              title: track.title,
              artist: track.artistName ?? 'Unknown artist',
              albumTitle: track.albumTitle ?? undefined,
              artworkUrl: track.artUrl ? client.mediaUrl(track.artUrl) : undefined,
            },
            { showSeekBackward: false, showSeekForward: false },
          );
        } catch {
          // older native runtime without lock-screen support — playback still works
        }
        setLoading(false);
      })();
    },
    [client, player, localUri],
  );

  const toggle = useCallback(() => {
    if (status.playing) player.pause();
    else player.play();
  }, [player, status.playing]);

  const seekTo = useCallback(
    (seconds: number) => {
      void player.seekTo(seconds);
    },
    [player],
  );

  const skipTo = useCallback(
    (direction: 1 | -1) => {
      if (!current) return;
      const idx = queue.findIndex((t) => t.id === current.id);
      const nextTrack = queue[idx + direction];
      if (nextTrack) playTrack(nextTrack);
    },
    [current, queue, playTrack],
  );

  // Auto-advance when a track finishes.
  useEffect(() => {
    if (status.didJustFinish) skipTo(1);
  }, [status.didJustFinish, skipTo]);

  const value = useMemo(
    () => ({
      current,
      queue,
      playing: status.playing ?? false,
      loading,
      positionSec: status.currentTime ?? 0,
      durationSec: status.duration ?? 0,
      playTrack,
      toggle,
      next: () => skipTo(1),
      previous: () => skipTo(-1),
      seekTo,
    }),
    [
      current,
      queue,
      loading,
      status.playing,
      status.currentTime,
      status.duration,
      playTrack,
      toggle,
      skipTo,
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
