import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiClient, type SharedItem, type SharedView } from '@baes/core';

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

const FEATURES: { icon: string; title: string; body: string }[] = [
  {
    icon: '◉',
    title: 'Your library, streamed',
    body: 'Unreleased tracks, demos and local files on your own server, playable anywhere over HTTPS.',
  },
  {
    icon: '↓',
    title: 'Offline on iPhone',
    body: 'A native app with lock-screen controls, offline downloads, speed and pitch, and a color-reactive player.',
  },
  {
    icon: '≋',
    title: 'Finds duplicates by ear',
    body: 'An audio fingerprinter in C++ spots the same recording across re-uploads, re-encodes and renamed copies.',
  },
  {
    icon: '★',
    title: 'Tracker tags, understood',
    body: 'Grails, best-ofs and snippets from tracker imports become filterable tags instead of emoji clutter.',
  },
  {
    icon: '⇄',
    title: 'Spotify, mirrored',
    body: 'Your Spotify playlists sync in and match against local files, so one library holds everything.',
  },
  {
    icon: '⌁',
    title: 'Share with a link',
    body: 'Send a playlist or a song with an unlisted, expiring link. Friends listen in the browser, no account.',
  },
];

const STATS: { value: string; label: string }[] = [
  { value: '98–100%', label: 'of clean or re-encoded clips identified from 3–10 s' },
  { value: '~4,000×', label: 'realtime fingerprinting (30 s of audio in 7 ms)' },
  { value: '2.9 GB → 373 MB', label: 'peak memory indexing a whole library' },
  { value: '< 0.2 ms', label: 'to match a clip against the library' },
];

const FORMATS = ['MP3', 'FLAC', 'WAV', 'M4A', 'AAC', 'OGG', 'OPUS', 'AIFF'];

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
      <div className="float-card dup">
        <div className="float-head">Possible duplicates</div>
        <div className="float-row">
          <span className="wave" />
          <span>3 copies · same recording</span>
        </div>
      </div>
      <div className="float-card link">
        <div className="float-head">Link ready</div>
        <div className="float-row mono">music…/s/OO1x…</div>
        <div className="float-sub">expires in 7 days · downloads on</div>
      </div>
    </div>
  );
}

export function Landing({ onSignIn }: { onSignIn: () => void }) {
  return (
    <div className="landing">
      <div className="aurora" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>

      <header className="landing-nav">
        <span className="landing-logo">bæs</span>
        <nav>
          <a href="#features">Features</a>
          <a href="#under-the-hood">Under the hood</a>
          <a href="https://github.com/xsebby/baes" target="_blank" rel="noreferrer">
            GitHub
          </a>
          <button className="landing-signin" onClick={onSignIn}>
            Sign in
          </button>
        </nav>
      </header>

      <section className="landing-hero">
        <div className="hero-copy">
          <span className="eyebrow">Self-hosted · invite only</span>
          <h1>
            Your music.
            <br />
            <span className="grad">Every version.</span>
            <br />
            Your server.
          </h1>
          <p>
            bæs is a private music player for the tracks streaming services don't have: unreleased
            songs, demos, alternate mixes, and the rest of your collection, on a server you own.
          </p>
          <div className="landing-ctas">
            <button className="cta" onClick={onSignIn}>
              Sign in
            </button>
            <a className="cta-ghost" href="#features">
              See what it does
            </a>
          </div>
        </div>
        <HeroVisual />
      </section>

      <div className="formats" aria-label="Supported formats">
        <span className="formats-label">Plays</span>
        {FORMATS.map((f) => (
          <span key={f} className="format">
            {f}
          </span>
        ))}
      </div>

      <section id="features" className="landing-section">
        <h2>Built for music that doesn't fit anywhere else.</h2>
        <div className="landing-grid">
          {FEATURES.map((f) => (
            <div key={f.title} className="landing-card">
              <span className="card-icon">{f.icon}</span>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="under-the-hood" className="landing-section hood">
        <div className="hood-copy">
          <span className="eyebrow">Under the hood</span>
          <h2>A fingerprinter written from scratch in C++20.</h2>
          <p>
            Every track is turned into a constellation of spectral peaks, paired into hashes, and
            indexed, so bæs recognizes the same recording even when it's been re-encoded, renamed,
            or re-uploaded. The FFT, the peak picking and the index are hand-built, and every number
            below was measured on a real library.
          </p>
        </div>
        <div className="stats">
          {STATS.map((s) => (
            <div key={s.label} className="stat">
              <span className="stat-value">{s.value}</span>
              <span className="stat-label">{s.label}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="landing-section">
        <h2>Share in three taps.</h2>
        <ol className="steps">
          <li>
            <span className="step-n">1</span>
            <h3>Pick a song or playlist</h3>
            <p>Tap share from the player or any playlist.</p>
          </li>
          <li>
            <span className="step-n">2</span>
            <h3>Choose how long</h3>
            <p>A day, a week, a month, or forever. Downloads on or off.</p>
          </li>
          <li>
            <span className="step-n">3</span>
            <h3>Send the link</h3>
            <p>They listen in any browser. Revoke it whenever you want.</p>
          </li>
        </ol>
      </section>

      <section className="landing-final">
        <h2>Your library deserves better than a folder.</h2>
        <button className="cta" onClick={onSignIn}>
          Sign in to bæs
        </button>
      </section>

      <footer className="landing-foot">bæs · self-hosted · invite only · built by sebby</footer>
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
  const audio = useRef<HTMLAudioElement>(null);

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
          <span className="player-spacer" />
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
      <footer className="landing-foot">Shared from bæs · a private music server</footer>
    </div>
  );
}
