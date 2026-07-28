import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { Track } from '@baes/core';
import { useAuth } from './state';

interface PlayerState {
  current: Track | null;
  queue: Track[];
  playing: boolean;
  positionSec: number;
  durationSec: number;
  volume: number;
  rate: number;
  preservePitch: boolean;
  playTrack: (track: Track, queue?: Track[]) => void;
  toggle: () => void;
  next: () => void;
  previous: () => void;
  seekTo: (sec: number) => void;
  setVolume: (v: number) => void;
  setRate: (r: number) => void;
  setPreservePitch: (b: boolean) => void;
}

const PlayerContext = createContext<PlayerState | null>(null);

export function PlayerProvider({ children }: { children: React.ReactNode }) {
  const { client } = useAuth();
  const audioRef = useRef<HTMLAudioElement>(new Audio());
  const [current, setCurrent] = useState<Track | null>(null);
  const [queue, setQueue] = useState<Track[]>([]);
  const [playing, setPlaying] = useState(false);
  const [positionSec, setPositionSec] = useState(0);
  const [durationSec, setDurationSec] = useState(0);
  const [volume, setVolumeState] = useState(
    () => Number(localStorage.getItem('baes.volume') ?? '1') || 1,
  );
  const [rate, setRateState] = useState(1);
  const [preservePitch, setPreservePitchState] = useState(true);

  // Refs so MediaSession/ended handlers see fresh values without re-binding.
  const currentRef = useRef(current);
  currentRef.current = current;
  const queueRef = useRef(queue);
  queueRef.current = queue;

  const playTrack = useCallback(
    (track: Track, newQueue?: Track[]) => {
      const audio = audioRef.current;
      setCurrent(track);
      if (newQueue) setQueue(newQueue);
      void (async () => {
        let path = track.streamUrl;
        try {
          path = (await client.refreshStreamUrl(track.id)).url;
        } catch {
          // fall back to the embedded URL
        }
        audio.src = client.mediaUrl(path);
        audio.play().catch(() => {});
        if ('mediaSession' in navigator) {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: track.title,
            artist: track.artistName ?? 'Unknown artist',
            album: track.albumTitle ?? undefined,
            artwork: track.artUrl ? [{ src: client.mediaUrl(track.artUrl) }] : [],
          });
        }
      })();
    },
    [client],
  );

  const skipTo = useCallback(
    (direction: 1 | -1) => {
      const cur = currentRef.current;
      const q = queueRef.current;
      if (!cur) return;
      const idx = q.findIndex((t) => t.id === cur.id);
      const nextTrack = q[idx + direction];
      if (nextTrack) playTrack(nextTrack);
    },
    [playTrack],
  );

  useEffect(() => {
    const audio = audioRef.current;
    audio.volume = volume;
    audio.playbackRate = rate;
    audio.preservesPitch = preservePitch;
    const onTime = () => setPositionSec(audio.currentTime);
    const onDur = () => setDurationSec(audio.duration || 0);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => skipTo(1);
    audio.addEventListener('timeupdate', onTime);
    audio.addEventListener('durationchange', onDur);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', onEnded);
    return () => {
      audio.removeEventListener('timeupdate', onTime);
      audio.removeEventListener('durationchange', onDur);
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('ended', onEnded);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skipTo]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    ms.setActionHandler('play', () => audioRef.current.play());
    ms.setActionHandler('pause', () => audioRef.current.pause());
    ms.setActionHandler('previoustrack', () => skipTo(-1));
    ms.setActionHandler('nexttrack', () => skipTo(1));
    ms.setActionHandler('seekto', (d) => {
      if (d.seekTime != null) audioRef.current.currentTime = d.seekTime;
    });
  }, [skipTo]);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  }, []);

  const seekTo = useCallback((sec: number) => {
    audioRef.current.currentTime = sec;
    setPositionSec(sec);
  }, []);

  const setVolume = useCallback((v: number) => {
    audioRef.current.volume = v;
    setVolumeState(v);
    localStorage.setItem('baes.volume', String(v));
  }, []);

  const setRate = useCallback((r: number) => {
    audioRef.current.playbackRate = r;
    setRateState(r);
  }, []);

  const setPreservePitch = useCallback((b: boolean) => {
    audioRef.current.preservesPitch = b;
    setPreservePitchState(b);
  }, []);

  const value = useMemo(
    () => ({
      current,
      queue,
      playing,
      positionSec,
      durationSec,
      volume,
      rate,
      preservePitch,
      playTrack,
      toggle,
      next: () => skipTo(1),
      previous: () => skipTo(-1),
      seekTo,
      setVolume,
      setRate,
      setPreservePitch,
    }),
    [
      current,
      queue,
      playing,
      positionSec,
      durationSec,
      volume,
      playTrack,
      toggle,
      skipTo,
      seekTo,
      setVolume,
    ],
  );

  return <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>;
}

export function usePlayer(): PlayerState {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayer outside provider');
  return ctx;
}
