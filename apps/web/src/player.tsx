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
  shuffle: boolean;
  toggleShuffle: () => void;
  playTrack: (track: Track, queue?: Track[]) => void;
  toggle: () => void;
  next: () => void;
  previous: () => void;
  seekTo: (sec: number) => void;
  setVolume: (v: number) => void;
  setRate: (r: number) => void;
  setPreservePitch: (b: boolean) => void;
  /** 0..1 smoothed audio energy for reactive visuals; 0 when unavailable. */
  getLevel: () => number;
}

const PlayerContext = createContext<PlayerState | null>(null);

/** What the desktop app (apps/desktop/preload.cjs) passes on to Discord. */
interface NowPlaying {
  title: string;
  artist: string | null;
  album: string | null;
  /** Absolute cover URL Discord can fetch, or null. */
  artUrl: string | null;
  positionSec: number;
  durationSec: number;
  rate: number;
}

declare global {
  interface Window {
    /** Only present inside the bæs desktop app. */
    baesDesktop?: { setNowPlaying: (np: NowPlaying | null) => void };
  }
}

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
  const rateRef = useRef(1);
  const preservePitchRef = useRef(true);
  const [shuffle, setShuffle] = useState(false);
  const shuffleRef = useRef(false);
  const toggleShuffle = useCallback(() => {
    shuffleRef.current = !shuffleRef.current;
    setShuffle(shuffleRef.current);
  }, []);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const freqRef = useRef<Uint8Array<ArrayBuffer> | null>(null);

  // Lazily wire the analyser on first play (AudioContext needs a user gesture).
  const ensureAnalyser = useCallback(() => {
    if (analyserRef.current) return;
    try {
      const Ctx =
        window.AudioContext ??
        (window as never as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      const src = ctx.createMediaElementSource(audioRef.current);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.82;
      src.connect(analyser);
      analyser.connect(ctx.destination);
      analyserRef.current = analyser;
      freqRef.current = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
    } catch {
      // analysis unavailable — visuals fall back to time-based animation
    }
  }, []);

  const getLevel = useCallback((): number => {
    const analyser = analyserRef.current;
    const buf = freqRef.current;
    if (!analyser || !buf) return 0;
    analyser.getByteFrequencyData(buf);
    // weight the low end — kick/bass is what you want visuals to breathe with
    let sum = 0;
    const n = Math.max(8, Math.floor(buf.length * 0.25));
    for (let i = 0; i < n; i++) sum += buf[i]!;
    return Math.min(1, sum / n / 220);
  }, []);

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
      if (shuffleRef.current && direction === 1 && q.length > 1) {
        let pick = cur;
        while (pick.id === cur.id) {
          pick = q[Math.floor(Math.random() * q.length)]!;
        }
        playTrack(pick);
        return;
      }
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
    const onPlay = () => {
      ensureAnalyser();
      setPlaying(true);
    };
    const onPause = () => setPlaying(false);
    const onEnded = () => skipTo(1);
    // Browsers reset playbackRate on new sources and Safari defers changes made
    // while paused — re-assert our settings whenever the element (re)activates.
    const reassert = () => {
      audio.playbackRate = rateRef.current;
      audio.preservesPitch = preservePitchRef.current;
    };
    audio.addEventListener('loadedmetadata', reassert);
    audio.addEventListener('canplay', reassert);
    audio.addEventListener('seeked', reassert);
    audio.addEventListener('play', reassert);
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
      audio.removeEventListener('loadedmetadata', reassert);
      audio.removeEventListener('canplay', reassert);
      audio.removeEventListener('seeked', reassert);
      audio.removeEventListener('play', reassert);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skipTo, ensureAnalyser]);

  // Desktop app only: Discord shows what's playing, cleared while paused.
  const artLinks = useRef(new Map<string, { url: string; expiresAt: number }>());
  useEffect(() => {
    const desktop = window.baesDesktop;
    if (!desktop) return;
    const audio = audioRef.current;
    let art: string | null = null;
    let cancelled = false;
    const report = () =>
      desktop.setNowPlaying(
        current && !audio.paused
          ? {
              title: current.title,
              artist: current.artistName,
              album: current.albumTitle,
              artUrl: art,
              positionSec: audio.currentTime,
              durationSec: audio.duration || current.durationMs / 1000,
              rate: audio.playbackRate,
            }
          : null,
      );
    report();
    // Discord fetches the cover itself, so it needs a fresh absolute link
    // (library art URLs expire an hour after the page loaded them).
    const albumId = current?.artUrl ? current.albumId : null;
    if (albumId) {
      const cached = artLinks.current.get(albumId);
      if (cached && cached.expiresAt > Date.now() + 60 * 60 * 1000) {
        art = cached.url;
        report();
      } else {
        client
          .artLink(albumId)
          .then(({ url, expiresAt }) => {
            artLinks.current.set(albumId, { url, expiresAt: Date.parse(expiresAt) });
            if (cancelled) return;
            art = url;
            report();
          })
          .catch(() => {});
      }
    }
    // Seeks and speed changes move the end time Discord counts down to.
    audio.addEventListener('seeked', report);
    audio.addEventListener('ratechange', report);
    audio.addEventListener('durationchange', report);
    return () => {
      cancelled = true;
      audio.removeEventListener('seeked', report);
      audio.removeEventListener('ratechange', report);
      audio.removeEventListener('durationchange', report);
    };
  }, [client, current, playing]);

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
    rateRef.current = r;
    audioRef.current.playbackRate = r;
    setRateState(r);
  }, []);

  const setPreservePitch = useCallback((b: boolean) => {
    preservePitchRef.current = b;
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
      shuffle,
      toggleShuffle,
      playTrack,
      toggle,
      next: () => skipTo(1),
      previous: () => skipTo(-1),
      seekTo,
      setVolume,
      setRate,
      setPreservePitch,
      getLevel,
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
