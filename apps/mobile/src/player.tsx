import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import type { Track } from '@baes/core';
import { useAuth } from './auth';

interface PlayerState {
  current: Track | null;
  queue: Track[];
  playing: boolean;
  positionSec: number;
  durationSec: number;
  playTrack: (track: Track, queue?: Track[]) => void;
  toggle: () => void;
  next: () => void;
  previous: () => void;
}

const PlayerContext = createContext<PlayerState | null>(null);

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const { client } = useAuth();
  const [current, setCurrent] = useState<Track | null>(null);
  const [queue, setQueue] = useState<Track[]>([]);
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);

  useEffect(() => {
    // Keep playing when the phone is on silent; background audio proper lands with M2's dev build.
    setAudioModeAsync({ playsInSilentMode: true }).catch(() => {});
  }, []);

  const playTrack = useCallback(
    (track: Track, newQueue?: Track[]) => {
      if (!client) return;
      setCurrent(track);
      if (newQueue) setQueue(newQueue);
      player.replace({ uri: client.mediaUrl(track.streamUrl) });
      player.play();
    },
    [client, player],
  );

  const toggle = useCallback(() => {
    if (status.playing) player.pause();
    else player.play();
  }, [player, status.playing]);

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
      positionSec: status.currentTime ?? 0,
      durationSec: status.duration ?? 0,
      playTrack,
      toggle,
      next: () => skipTo(1),
      previous: () => skipTo(-1),
    }),
    [
      current,
      queue,
      status.playing,
      status.currentTime,
      status.duration,
      playTrack,
      toggle,
      skipTo,
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
