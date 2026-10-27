import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiClient, type SharedItem, type SharedView } from '@baes/core';

// ---- Landing page (signed-out visitors) ----

const FEATURES: { title: string; body: string }[] = [
  {
    title: 'Your library, streamed',
    body: 'Unreleased tracks, demos and local files on your own server, playable anywhere over HTTPS.',
  },
  {
    title: 'Offline on iPhone',
    body: 'A native app with lock-screen controls, downloads for offline listening, and speed and pitch control.',
  },
  {
    title: 'Finds duplicates by ear',
    body: 'An audio fingerprinter written in C++ spots the same recording across re-uploads, re-encodes and renamed copies.',
  },
  {
    title: 'Spotify, mirrored',
    body: 'Your Spotify playlists sync in and match against local files, so one library holds everything.',
  },
  {
    title: 'Share with a link',
    body: 'Send a playlist or a song with an unlisted, expiring link. Friends listen in the browser, no account needed.',
  },
  {
    title: 'Invite only',
    body: 'Private by design: accounts exist only by invite, and the server belongs to whoever runs it.',
  },
];

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
        <h1>
          Your music,
          <br />
          on your own server.
        </h1>
        <p>
          bæs is a self-hosted music player for the tracks streaming services don't have: unreleased
          songs, demos, and everything else in your collection.
        </p>
        <div className="landing-ctas">
          <button className="primary" onClick={onSignIn}>
            Sign in
          </button>
          <a
            className="landing-ghost"
            href="https://github.com/xsebby/baes"
            target="_blank"
            rel="noreferrer"
          >
            View on GitHub
          </a>
        </div>
      </section>
      <section className="landing-grid">
        {FEATURES.map((f) => (
          <div key={f.title} className="landing-card">
            <h3>{f.title}</h3>
            <p>{f.body}</p>
          </div>
        ))}
      </section>
      <footer className="landing-foot">Self-hosted · invite only · built by sebby</footer>
    </div>
  );
}

// ---- Share page (/s/<token>, no account) ----

function formatMs(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function SharePage({ token }: { token: string }) {
  const client = useMemo(() => new ApiClient({ baseUrl: '', getToken: () => null }), []);
  const [view, setView] = useState<SharedView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
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
    if (!el || !view) return;
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
  if (!view) return <div className="share-page share-center">Loading…</div>;

  const now: SharedItem | null = current !== null ? view.items[current]! : null;
  return (
    <div className="share-page">
      <header className="share-head">
        {view.artUrl ? (
          <img className="share-art" src={view.artUrl} alt="" />
        ) : (
          <div className="share-art share-art-empty">♪</div>
        )}
        <div className="share-meta">
          <span className="share-kind">
            {view.kind === 'playlist' ? 'Shared playlist' : 'Shared song'}
          </span>
          <h1>{view.title}</h1>
          <span className="share-sub">
            {view.items.length} {view.items.length === 1 ? 'song' : 'songs'}
            {view.expiresAt
              ? ` · link expires ${new Date(view.expiresAt).toLocaleDateString()}`
              : ''}
          </span>
          {view.items.length > 0 && (
            <button className="primary share-play" onClick={() => play(current ?? 0)}>
              {playing ? 'Pause' : 'Play'}
            </button>
          )}
        </div>
      </header>

      <ol className="share-list">
        {view.items.map((t, i) => (
          <li key={t.id} className={i === current ? 'active' : ''} onClick={() => play(i)}>
            <span className="share-idx">{i === current && playing ? '▶' : i + 1}</span>
            <span className="share-title">
              {t.tag ? <span className="share-tag">{t.tag}</span> : null}
              {t.title}
              <span className="share-artist">
                {t.artistName ?? 'Unknown artist'}
                {t.albumTitle ? ` · ${t.albumTitle}` : ''}
              </span>
            </span>
            <span className="share-dur">{formatMs(t.durationMs)}</span>
            {t.downloadUrl && (
              <a
                className="share-dl"
                href={t.downloadUrl}
                onClick={(e) => e.stopPropagation()}
                title="Download"
              >
                ↓
              </a>
            )}
          </li>
        ))}
      </ol>

      <div className={`share-player${now ? '' : ' hidden'}`}>
        <span className="share-now">{now ? `${now.title} — ${now.artistName ?? ''}` : ''}</span>
        <audio
          ref={audio}
          controls
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            if (current !== null && current + 1 < view.items.length) play(current + 1);
          }}
        />
      </div>
      <footer className="landing-foot">Shared from bæs · a private music server</footer>
    </div>
  );
}
