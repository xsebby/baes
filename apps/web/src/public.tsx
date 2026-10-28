import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiClient, type SharedItem, type SharedView } from '@baes/core';
import { LegalLinks } from './legal';

// ---- Icons ----

const Icon = {
  play: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" />
    </svg>
  ),
  pause: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="6" y="5" width="4" height="14" rx="1.2" />
      <rect x="14" y="5" width="4" height="14" rx="1.2" />
    </svg>
  ),
  prev: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="5" y="5" width="2.5" height="14" rx="1" />
      <path d="M19 6.2v11.6a.8.8 0 0 1-1.22.68L9.6 13.36a1.6 1.6 0 0 1 0-2.72l8.18-5.12A.8.8 0 0 1 19 6.2Z" />
    </svg>
  ),
  next: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="16.5" y="5" width="2.5" height="14" rx="1" />
      <path d="M5 6.2v11.6a.8.8 0 0 0 1.22.68l8.18-5.12a1.6 1.6 0 0 0 0-2.72L6.22 5.52A.8.8 0 0 0 5 6.2Z" />
    </svg>
  ),
  download: (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 4v11" />
      <path d="m7 11 5 5 5-5" />
      <path d="M5 20h14" />
    </svg>
  ),
};

const VolumeIcon = {
  on: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 9.5h3.2L12 5.6v12.8l-4.8-3.9H4z" />
      <path className="stroke" d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
    </svg>
  ),
  off: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 9.5h3.2L12 5.6v12.8l-4.8-3.9H4z" />
      <path className="stroke" d="m16 9.5 5 5m0-5-5 5" />
    </svg>
  ),
};

/** iOS Safari ignores `audio.volume` (hardware buttons only), so the slider would do nothing. */
const canSetVolume = (() => {
  try {
    const a = new Audio();
    a.volume = 0.5;
    return a.volume === 0.5;
  } catch {
    return false;
  }
})();

function readVolume(): number {
  try {
    const v = Number(localStorage.getItem('baes.share.volume'));
    return Number.isFinite(v) && v > 0 && v <= 1 ? v : 1;
  } catch {
    return 1;
  }
}

function Volume({
  volume,
  muted,
  onVolume,
  onMute,
}: {
  volume: number;
  muted: boolean;
  onVolume: (v: number) => void;
  onMute: () => void;
}) {
  if (!canSetVolume) return null;
  const shown = muted ? 0 : volume;
  return (
    <div className="share-volume">
      <button onClick={onMute} aria-label={muted ? 'Unmute' : 'Mute'}>
        {shown === 0 ? VolumeIcon.off : VolumeIcon.on}
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={shown}
        aria-label="Volume"
        style={{ '--pct': `${shown * 100}%` } as React.CSSProperties}
        onChange={(e) => onVolume(Number(e.target.value))}
      />
    </div>
  );
}

function Bars() {
  return (
    <span className="eq" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  );
}

// ---- Landing page (signed-out visitors) ----

const VERSIONS: { title: string; tag?: string; note: string; length: string; playing?: boolean }[] =
  [
    { title: 'untitled (v3)', tag: '⭐', note: 'final', length: '3:04', playing: true },
    { title: 'untitled (alt mix)', note: 'darker drums', length: '3:21' },
    { title: 'untitled (v2)', tag: '✂️', note: 'snippet', length: '0:48' },
    { title: 'untitled (demo)', note: 'voice memo', length: '2:12' },
  ];

const FEATURES: { title: string; body: string }[] = [
  {
    title: 'On your phone, offline',
    body: 'A real iPhone app. Download a playlist and it plays on a plane, with lock-screen controls.',
  },
  {
    title: 'Spotify, in the same place',
    body: 'Your Spotify playlists sync in and play from your own files wherever they match.',
  },
  {
    title: 'Tracker imports',
    body: 'Pull songs straight from a tracker sheet. Its ⭐ and ✂️ markers become tags you can filter by.',
  },
  {
    title: 'No duplicate clutter',
    body: 'Upload the same song twice under a different name and bæs notices.',
  },
  {
    title: 'Any file you have',
    body: 'MP3, FLAC, WAV, M4A, OGG, Opus, AIFF. Streams at full quality.',
  },
  {
    title: 'Private by default',
    body: 'Invite only, on a server you control. Nothing is public unless you share it.',
  },
];

const SHARE_ROWS: { title: string; length: string }[] = [
  { title: 'untitled (v3)', length: '3:04' },
  { title: 'pink sky', length: '2:47' },
  { title: 'no signal (demo)', length: '1:58' },
];

function HeroVisual() {
  return (
    <div className="hero-visual" aria-hidden="true">
      <div className="phone">
        <div className="phone-art">
          <div className="phone-art-glow" />
        </div>
        <div className="phone-title">
          <span className="phone-tag">⭐</span> untitled (v3)
        </div>
        <div className="phone-artist">unreleased · 2026</div>
        <div className="phone-progress">
          <span />
        </div>
        <div className="phone-times">
          <span>1:12</span>
          <span>3:04</span>
        </div>
        <div className="phone-controls">
          <span className="ctl">{Icon.prev}</span>
          <span className="ctl big">{Icon.pause}</span>
          <span className="ctl">{Icon.next}</span>
        </div>
      </div>
    </div>
  );
}

export function Landing({ onSignIn }: { onSignIn: () => void }) {
  return (
    <div className="landing">
      <header className="landing-nav">
        <span className="landing-logo">bæs</span>
        <button className="landing-signin" onClick={onSignIn}>
          Sign in
        </button>
      </header>

      <section className="landing-hero">
        <div className="hero-copy">
          <h1>
            Your music.
            <br />
            <span className="dim">Every version.</span>
            <br />
            Your server.
          </h1>
          <p>
            A private player for the songs streaming doesn't have: unreleased tracks, demos, alt
            mixes and snippets, all in one library you own.
          </p>
          <div className="landing-ctas">
            <button className="cta" onClick={onSignIn}>
              Sign in
            </button>
            <span className="cta-note">Invite only</span>
          </div>
        </div>
        <HeroVisual />
      </section>

      <section className="landing-section split">
        <div className="split-copy">
          <h2>One song, every take.</h2>
          <p>
            The demo, the snippet, the mix that never came out. bæs keeps them together under one
            title, so the song stays one song and you pick the take.
          </p>
        </div>
        <div className="versions" aria-hidden="true">
          <div className="versions-head">
            <span>untitled</span>
            <span>4 versions</span>
          </div>
          {VERSIONS.map((v) => (
            <div key={v.title} className={'version' + (v.playing ? ' playing' : '')}>
              <span className="version-icon">{v.playing ? <Bars /> : Icon.play}</span>
              <span className="version-title">
                {v.tag && <span className="version-tag">{v.tag}</span>}
                {v.title}
              </span>
              <span className="version-note">{v.note}</span>
              <span className="version-len">{v.length}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="landing-section">
        <h2>Everything else you'd want.</h2>
        <dl className="feature-list">
          {FEATURES.map((f) => (
            <div key={f.title}>
              <dt>{f.title}</dt>
              <dd>{f.body}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="landing-section split reverse">
        <div className="split-copy">
          <h2>Send a song, not a file.</h2>
          <p>
            Make a link for a song or a playlist. It can expire in a day or never, downloads on or
            off, and you can take it back anytime. Friends listen in the browser, no account needed.
          </p>
        </div>
        <div className="share-mock" aria-hidden="true">
          <div className="share-mock-top">
            <div className="share-mock-art" />
            <div>
              <div className="share-mock-title">late nights</div>
              <div className="share-mock-sub">3 songs · shared by sebby</div>
            </div>
          </div>
          {SHARE_ROWS.map((r, i) => (
            <div key={r.title} className="share-mock-row">
              <span className="share-mock-n">{i + 1}</span>
              <span className="share-mock-name">{r.title}</span>
              <span className="share-mock-len">{r.length}</span>
            </div>
          ))}
          <div className="share-mock-foot">
            <span className="share-mock-btn">{Icon.download} Download all</span>
            <span>expires in 7 days</span>
          </div>
        </div>
      </section>

      <footer className="landing-foot">
        <span className="landing-logo small">bæs</span>
        <span>Invite only.</span>
        <LegalLinks />
        <button className="landing-foot-link" onClick={onSignIn}>
          Sign in →
        </button>
      </footer>
    </div>
  );
}

// ---- Share page (/s/<token>, no account) ----

function formatMs(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function totalLength(items: SharedItem[]): string {
  const min = Math.round(items.reduce((n, t) => n + t.durationMs, 0) / 60000);
  return min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`;
}

function Art({ src, className }: { src: string | null; className: string }) {
  return src ? (
    <img className={className} src={src} alt="" />
  ) : (
    <div className={`${className} art-empty`}>♪</div>
  );
}

export function SharePage({ token }: { token: string }) {
  const client = useMemo(() => new ApiClient({ baseUrl: '', getToken: () => null }), []);
  const [view, setView] = useState<SharedView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState({ at: 0, total: 0 });
  const [volume, setVolume] = useState(readVolume);
  const [muted, setMuted] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const el = audio.current;
    if (!el) return;
    el.volume = volume;
    el.muted = muted;
  }, [volume, muted, view]);

  function changeVolume(v: number) {
    setVolume(v);
    setMuted(v === 0);
    if (v > 0) {
      try {
        localStorage.setItem('baes.share.volume', String(v));
      } catch {
        // private mode: volume just won't be remembered
      }
    }
  }

  const volumeControl = (
    <Volume
      volume={volume}
      muted={muted}
      onVolume={changeVolume}
      onMute={() => (muted || volume === 0 ? changeVolume(volume || 1) : setMuted(true))}
    />
  );

  useEffect(() => {
    client
      .openShare(token)
      .then((v) => {
        setView(v);
        document.title = `${v.title} · bæs`;
      })
      .catch((e) =>
        setError(e instanceof Error ? e.message : 'This link is invalid or has expired'),
      );
  }, [client, token]);

  function play(i: number) {
    const el = audio.current;
    if (!el || !view?.items[i]) return;
    if (current === i) {
      if (el.paused) void el.play();
      else el.pause();
      return;
    }
    setCurrent(i);
    el.src = view.items[i]!.streamUrl;
    void el.play();
  }

  if (error) {
    return (
      <div className="share-page share-center">
        <div className="landing-logo">bæs</div>
        <p className="share-gone">{error}</p>
        <p className="share-sub">Ask whoever sent it for a new link.</p>
      </div>
    );
  }
  if (!view) {
    return (
      <div className="share-page share-center">
        <Bars />
      </div>
    );
  }

  const now = current !== null ? view.items[current]! : null;
  const single = view.kind === 'track' && view.items.length === 1;
  const first = view.items[0];
  const pct = time.total > 0 ? (time.at / time.total) * 100 : 0;

  const downloadButton =
    single && first?.downloadUrl ? (
      <a className="btn-ghost" href={first.downloadUrl}>
        <span className="btn-icon">{Icon.download}</span> Download
      </a>
    ) : !single && view.downloadAllUrl && view.items.length > 0 ? (
      <a className="btn-ghost" href={view.downloadAllUrl}>
        <span className="btn-icon">{Icon.download}</span> Download all
      </a>
    ) : null;

  return (
    <div className="share-page">
      {view.artUrl && (
        <div className="share-backdrop" style={{ backgroundImage: `url("${view.artUrl}")` }} />
      )}

      <header className="share-top">
        <span className="landing-logo small">bæs</span>
      </header>

      {single && first ? (
        <section className="share-single">
          <Art src={view.artUrl} className="single-art" />
          <span className="share-kind">Shared song</span>
          <h1>
            {first.tag && <span className="share-tag">{first.tag}</span>}
            {first.title}
          </h1>
          <p className="share-sub">
            {first.artistName ?? 'Unknown artist'}
            {first.albumTitle ? ` · ${first.albumTitle}` : ''}
          </p>
          <button
            className="play-big"
            onClick={() => play(0)}
            aria-label={playing ? 'Pause' : 'Play'}
          >
            {playing ? Icon.pause : Icon.play}
          </button>
          <div className="single-seek">
            <span>{formatMs(time.at * 1000)}</span>
            <input
              type="range"
              min={0}
              max={time.total || first.durationMs / 1000}
              step={0.1}
              value={time.at}
              style={{ '--pct': `${pct}%` } as React.CSSProperties}
              onChange={(e) => {
                if (current === null) play(0);
                if (audio.current) audio.current.currentTime = Number(e.target.value);
              }}
            />
            <span>{formatMs((time.total || first.durationMs / 1000) * 1000)}</span>
          </div>
          {volumeControl}
          {downloadButton}
          {view.expiresAt && (
            <p className="share-expiry">
              Link expires {new Date(view.expiresAt).toLocaleDateString()}
            </p>
          )}
        </section>
      ) : (
        <>
          <section className="share-head">
            <Art src={view.artUrl} className="share-art" />
            <div className="share-meta">
              <span className="share-kind">Shared playlist</span>
              <h1>{view.title}</h1>
              <span className="share-sub">
                {view.items.length} {view.items.length === 1 ? 'song' : 'songs'} ·{' '}
                {totalLength(view.items)}
                {view.expiresAt
                  ? ` · link expires ${new Date(view.expiresAt).toLocaleDateString()}`
                  : ''}
              </span>
              <div className="share-actions">
                {view.items.length > 0 && (
                  <button className="btn-play" onClick={() => play(current ?? 0)}>
                    <span className="btn-icon">{playing ? Icon.pause : Icon.play}</span>
                    {playing ? 'Pause' : 'Play'}
                  </button>
                )}
                {downloadButton}
              </div>
            </div>
          </section>

          <ol className="share-list">
            {view.items.map((t, i) => (
              <li key={t.id} className={i === current ? 'active' : ''} onClick={() => play(i)}>
                <span className="share-idx">{i === current && playing ? <Bars /> : i + 1}</span>
                <Art src={t.artUrl} className="row-art" />
                <span className="share-title">
                  <span className="row-title">
                    {t.tag && <span className="share-tag">{t.tag}</span>}
                    {t.title}
                  </span>
                  <span className="share-artist">
                    {t.artistName ?? 'Unknown artist'}
                    {t.albumTitle ? ` · ${t.albumTitle}` : ''}
                  </span>
                </span>
                <span className="share-dur">{formatMs(t.durationMs)}</span>
                {t.downloadUrl ? (
                  <a
                    className="row-dl"
                    href={t.downloadUrl}
                    onClick={(e) => e.stopPropagation()}
                    title="Download"
                    aria-label={`Download ${t.title}`}
                  >
                    {Icon.download}
                  </a>
                ) : (
                  <span />
                )}
              </li>
            ))}
          </ol>
        </>
      )}

      {!single && now && (
        <div className="share-player">
          <Art src={now.artUrl} className="player-art" />
          <div className="player-meta">
            <span className="player-title">{now.title}</span>
            <span className="player-artist">{now.artistName ?? 'Unknown artist'}</span>
          </div>
          <div className="player-center">
            <div className="player-buttons">
              <button onClick={() => current! > 0 && play(current! - 1)} aria-label="Previous">
                {Icon.prev}
              </button>
              <button
                className="big"
                onClick={() => play(current!)}
                aria-label={playing ? 'Pause' : 'Play'}
              >
                {playing ? Icon.pause : Icon.play}
              </button>
              <button
                onClick={() => current! + 1 < view.items.length && play(current! + 1)}
                aria-label="Next"
              >
                {Icon.next}
              </button>
            </div>
            <div className="player-seek">
              <span>{formatMs(time.at * 1000)}</span>
              <input
                type="range"
                min={0}
                max={time.total || 1}
                step={0.1}
                value={time.at}
                style={{ '--pct': `${pct}%` } as React.CSSProperties}
                onChange={(e) => {
                  if (audio.current) audio.current.currentTime = Number(e.target.value);
                }}
              />
              <span>{formatMs(time.total * 1000)}</span>
            </div>
          </div>
          <div className="player-right">{volumeControl}</div>
        </div>
      )}

      <audio
        ref={audio}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) =>
          setTime({ at: e.currentTarget.currentTime, total: e.currentTarget.duration || 0 })
        }
        onLoadedMetadata={(e) => setTime({ at: 0, total: e.currentTarget.duration || 0 })}
        onEnded={() => {
          setPlaying(false);
          if (current !== null && current + 1 < view.items.length) play(current + 1);
        }}
      />
      <footer className="landing-foot">
        Shared from bæs · a private music server
        <LegalLinks />
      </footer>
    </div>
  );
}
