import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
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

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const { client } = useAuth();
  const { localUri } = useDownloads();
  const [current, setCurrent] = useState<Track | null>(null);
  const [queue, setQueue] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [rate, setRateState] = useState(1);
  const [keepPitch, setKeepPitchState] = useState(true);
  const [shuffle, setShuffle] = useState(false);
  const shuffleRef = useRef(false);
  const toggleShuffle = useCallback(() => {
    shuffleRef.current = !shuffleRef.current;
    setShuffle(shuffleRef.current);
  }, []);
  const rateRef = useRef(1);
  const keepPitchRef = useRef(true);
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);

  const applyRate = useCallback(() => {
    try {
      // expo-audio: pitch-correction quality applies on iOS; attempting to
      // disable correction gives the slowed/sped effect where supported.
      (player as unknown as { shouldCorrectPitch?: boolean }).shouldCorrectPitch =
        keepPitchRef.current;
    } catch {
      // property may be read-only on some runtimes
    }
    try {
      player.setPlaybackRate(rateRef.current, keepPitchRef.current ? 'high' : 'low');
    } catch {
      // no-op if unsupported
    }
  }, [player]);

  const setRate = useCallback(
    (r: number) => {
      rateRef.current = r;
      setRateState(r);
      applyRate();
    },
    [applyRate],
  );

  const setKeepPitch = useCallback(
    (b: boolean) => {
      keepPitchRef.current = b;
      setKeepPitchState(b);
      applyRate();
    },
    [applyRate],
  );

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
          // Only hit the network for a fresh signed URL when the embedded one
          // is stale — auto-advance in the background must not depend on a
          // fetch (iOS suspends us the moment audio goes idle).
          let streamPath = track.streamUrl;
          if (!urlIsFresh(streamPath)) {
            try {
              const fresh = await client.refreshStreamUrl(track.id);
              streamPath = fresh.url;
            } catch {
              // offline or transient failure — try the embedded URL anyway
            }
          }
          uri = `${client.mediaUrl(streamPath)}&profile=compat`;
        }
        player.replace({ uri });
        player.play();
        applyRate();
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
    [client, player, localUri, applyRate],
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
      if (shuffleRef.current && direction === 1 && queue.length > 1) {
        let pick = current;
        while (pick.id === current.id) {
          pick = queue[Math.floor(Math.random() * queue.length)]!;
        }
        playTrack(pick);
        return;
      }
      const idx = queue.findIndex((t) => t.id === current.id);
      const nextTrack = queue[idx + direction];
      if (nextTrack) playTrack(nextTrack);
    },
    [current, queue, playTrack],
  );

  // Auto-advance exactly once per finish — didJustFinish stays true across
  // several status updates while skipTo's identity changes, so a naive effect
  // re-fires and skips through multiple tracks.
  const finishHandledRef = useRef(false);
  useEffect(() => {
    if (status.didJustFinish && !finishHandledRef.current) {
      finishHandledRef.current = true;
      skipTo(1);
    } else if (!status.didJustFinish) {
      finishHandledRef.current = false;
    }
  }, [status.didJustFinish, skipTo]);

  const value = useMemo(
    () => ({
      current,
      queue,
      playing: status.playing ?? false,
      loading,
      positionSec: status.currentTime ?? 0,
      durationSec: status.duration ?? 0,
      rate,
      keepPitch,
      shuffle,
      toggleShuffle,
      setRate,
      setKeepPitch,
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
      rate,
      keepPitch,
      shuffle,
      toggleShuffle,
      setRate,
      setKeepPitch,
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
