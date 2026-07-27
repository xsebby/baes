import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  SpotifyStatus,
  AlbumDetail,
  AlbumSummary,
  ArtistDetail,
  ArtistSummary,
  LibraryRoot,
  PlaylistDetail,
  PlaylistSummary,
  ScanStatus,
  Track,
} from '@baes/core';
import { formatDuration, useAuth } from './state';
import { usePlayer } from './player';
import { TrackRow } from './components';

export type View =
  | { type: 'library' }
  | { type: 'album'; id: string }
  | { type: 'artist'; id: string }
  | { type: 'playlist'; id: string }
  | { type: 'liked' }
  | { type: 'admin' };

interface ViewProps {
  navigate: (v: View) => void;
  onAddToPlaylist: (t: Track) => void;
}

// ---- login ----

export function Login() {
  const { signIn } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [setup, setSetup] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(username.trim(), password, setup);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <h1>bæs</h1>
        <p>{setup ? 'Create the owner account' : 'Sign in to your library'}</p>
        <input
          placeholder="Username"
          value={username}
          autoCapitalize="none"
          onChange={(e) => setUsername(e.target.value)}
        />
        <input
          placeholder="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {error && <div className="error">{error}</div>}
        <button className="primary" disabled={busy || username.length < 2 || password.length < 10}>
          {setup ? 'Create & sign in' : 'Sign in'}
        </button>
        <button type="button" className="toggle" onClick={() => setSetup((v) => !v)}>
          {setup ? 'Already set up? Sign in' : 'Fresh server? Create owner account'}
        </button>
      </form>
    </div>
  );
}

// ---- library (segments) ----

type Segment = 'songs' | 'albums' | 'artists' | 'playlists';

export function LibraryView({ navigate, onAddToPlaylist, query }: ViewProps & { query: string }) {
  const { client } = useAuth();
  const [segment, setSegment] = useState<Segment>('songs');
  const [tracks, setTracks] = useState<Track[]>([]);
  const [albums, setAlbums] = useState<AlbumSummary[]>([]);
  const [artists, setArtists] = useState<ArtistSummary[]>([]);
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(
    async (q: string) => {
      try {
        const [t, al, ar, pl] = await Promise.all([
          client.listTracks({ q: q || undefined, limit: 500 }),
          client.listAlbums(),
          client.listArtists(),
          client.listPlaylists(),
        ]);
        setTracks(t.tracks);
        setAlbums(al.albums);
        setArtists(ar.artists);
        setPlaylists(pl.playlists);
      } finally {
        setLoading(false);
      }
    },
    [client],
  );

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void load(query), query ? 250 : 0);
  }, [query, load]);

  return (
    <>
      <div className="segments">
        {(['songs', 'albums', 'artists', 'playlists'] as const).map((s) => (
          <button
            key={s}
            className={`segment${segment === s ? ' active' : ''}`}
            onClick={() => setSegment(s)}
          >
            {s[0]!.toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>
      <div className="content">
        {loading ? (
          <div className="empty">Loading…</div>
        ) : segment === 'songs' ? (
          tracks.length === 0 ? (
            <div className="empty">{query ? 'No matches' : 'No music yet — scan in Admin'}</div>
          ) : (
            tracks.map((t) => (
              <TrackRow key={t.id} track={t} queue={tracks} onAddToPlaylist={onAddToPlaylist} />
            ))
          )
        ) : segment === 'albums' ? (
          <div className="album-grid">
            {albums.map((a) => (
              <div
                key={a.id}
                className="album-card"
                onClick={() => navigate({ type: 'album', id: a.id })}
              >
                {a.artUrl ? (
                  <img className="cover" src={client.mediaUrl(a.artUrl)} alt="" />
                ) : (
                  <div className="cover">◎</div>
                )}
                <div className="t">{a.title}</div>
                <div className="s">
                  {a.artistName ?? 'Unknown'} · {a.trackCount}
                </div>
              </div>
            ))}
          </div>
        ) : segment === 'artists' ? (
          artists.map((a) => (
            <div
              key={a.id}
              className="list-row"
              onClick={() => navigate({ type: 'artist', id: a.id })}
            >
              <div className="bubble">◉</div>
              <div className="name">{a.name}</div>
              <div className="count">{a.trackCount} tracks</div>
            </div>
          ))
        ) : (
          <>
            <div className="list-row" onClick={() => navigate({ type: 'liked' })}>
              <div className="bubble" style={{ color: 'var(--heart)' }}>
                ♥
              </div>
              <div className="name">Liked songs</div>
            </div>
            <div
              className="list-row"
              onClick={async () => {
                const title = prompt('New playlist name');
                if (title?.trim()) {
                  await client.createPlaylist(title.trim());
                  void load(query);
                }
              }}
            >
              <div className="bubble" style={{ color: 'var(--accent)' }}>
                ＋
              </div>
              <div className="name" style={{ color: 'var(--accent)' }}>
                New playlist…
              </div>
            </div>
            {playlists.map((p) => (
              <div
                key={p.id}
                className="list-row"
                onClick={() => navigate({ type: 'playlist', id: p.id })}
              >
                <div className="bubble">☰</div>
                <div className="name">{p.title}</div>
                <div className="count">{p.trackCount} tracks</div>
              </div>
            ))}
          </>
        )}
      </div>
    </>
  );
}

// ---- detail views ----

function DetailShell({
  navigate,
  children,
}: {
  navigate: (v: View) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="content">
      <button className="backbtn" onClick={() => navigate({ type: 'library' })}>
        ← Library
      </button>
      {children}
    </div>
  );
}

function PlayAllButton({ tracks }: { tracks: Track[] }) {
  const { playTrack } = usePlayer();
  if (tracks.length === 0) return null;
  return (
    <button className="primary" onClick={() => playTrack(tracks[0]!, tracks)}>
      ▶ Play
    </button>
  );
}

export function AlbumView({ id, navigate, onAddToPlaylist }: ViewProps & { id: string }) {
  const { client } = useAuth();
  const [album, setAlbum] = useState<AlbumDetail | null>(null);

  useEffect(() => {
    client
      .getAlbum(id)
      .then(setAlbum)
      .catch(() => {});
  }, [client, id]);

  if (!album) return <div className="empty">Loading…</div>;
  return (
    <DetailShell navigate={navigate}>
      <div className="detail-header">
        {album.artUrl ? (
          <img className="cover" src={client.mediaUrl(album.artUrl)} alt="" />
        ) : (
          <div className="cover">◎</div>
        )}
        <div>
          <h2>{album.title}</h2>
          <div className="sub">
            {album.artistName ?? 'Unknown artist'}
            {album.year ? ` · ${album.year}` : ''} · {album.tracks.length} tracks
          </div>
          <div className="actions">
            <PlayAllButton tracks={album.tracks} />
          </div>
        </div>
      </div>
      {album.tracks.map((t) => (
        <TrackRow key={t.id} track={t} queue={album.tracks} onAddToPlaylist={onAddToPlaylist} />
      ))}
    </DetailShell>
  );
}

export function ArtistView({ id, navigate, onAddToPlaylist }: ViewProps & { id: string }) {
  const { client } = useAuth();
  const [artist, setArtist] = useState<ArtistDetail | null>(null);

  useEffect(() => {
    client
      .getArtist(id)
      .then(setArtist)
      .catch(() => {});
  }, [client, id]);

  if (!artist) return <div className="empty">Loading…</div>;

  const byAlbum = new Map<string, { title: string; albumId: string | null; tracks: Track[] }>();
  for (const t of artist.tracks) {
    const key = t.albumId ?? '__none__';
    if (!byAlbum.has(key)) {
      byAlbum.set(key, {
        title: t.albumTitle ?? 'Singles & loosies',
        albumId: t.albumId,
        tracks: [],
      });
    }
    byAlbum.get(key)!.tracks.push(t);
  }
  const sections = [...byAlbum.values()].sort((a, b) =>
    a.albumId === null ? 1 : b.albumId === null ? -1 : a.title.localeCompare(b.title),
  );

  return (
    <DetailShell navigate={navigate}>
      <div className="detail-header">
        <div>
          <h2>{artist.name}</h2>
          <div className="sub">{artist.tracks.length} tracks</div>
          <div className="actions">
            <PlayAllButton tracks={artist.tracks} />
          </div>
        </div>
      </div>
      {sections.map((s) => (
        <div key={s.albumId ?? 'none'}>
          <div className="section-title">{s.title}</div>
          {s.tracks.map((t) => (
            <TrackRow key={t.id} track={t} queue={s.tracks} onAddToPlaylist={onAddToPlaylist} />
          ))}
        </div>
      ))}
    </DetailShell>
  );
}

export function PlaylistView({ id, navigate, onAddToPlaylist }: ViewProps & { id: string }) {
  const { client } = useAuth();
  const [playlist, setPlaylist] = useState<PlaylistDetail | null>(null);

  const load = useCallback(() => {
    client
      .getPlaylist(id)
      .then(setPlaylist)
      .catch(() => {});
  }, [client, id]);
  useEffect(load, [load]);

  if (!playlist) return <div className="empty">Loading…</div>;
  const queue = playlist.items.flatMap((i) => (i.track ? [i.track] : []));
  const isMirror = playlist.source === 'spotify';

  return (
    <DetailShell navigate={navigate}>
      <div className="detail-header">
        <div>
          <h2>{playlist.title}</h2>
          <div className="sub">{playlist.items.length} tracks</div>
          <div className="actions">
            <PlayAllButton tracks={queue} />
            <button
              className="iconbtn"
              onClick={async () => {
                if (confirm(`Delete playlist “${playlist.title}”?`)) {
                  await client.deletePlaylist(playlist.id);
                  navigate({ type: 'library' });
                }
              }}
            >
              Delete
            </button>
          </div>
        </div>
      </div>
      {playlist.items.map((item) =>
        item.track ? (
          <TrackRow
            key={item.itemId}
            track={item.track}
            queue={queue}
            onAddToPlaylist={onAddToPlaylist}
            trailing={
              isMirror ? undefined : (
                <button
                  className="rowbtn"
                  title="Remove from playlist"
                  onClick={async (e) => {
                    e.stopPropagation();
                    await client.removeFromPlaylist(playlist.id, item.itemId);
                    load();
                  }}
                >
                  ✕
                </button>
              )
            }
          />
        ) : item.external ? (
          <a
            key={item.itemId}
            className="track-row"
            style={{ opacity: 0.55, textDecoration: 'none', color: 'inherit' }}
            href={`https://open.spotify.com/track/${item.external.spotifyId}`}
            target="_blank"
            rel="noreferrer"
            title="Not in your library — opens in Spotify"
          >
            {item.external.artUrl ? (
              <img className="art" src={item.external.artUrl} alt="" />
            ) : (
              <div className="art">♪</div>
            )}
            <div className="meta">
              <div className="title">{item.external.title}</div>
              <div className="sub">{item.external.artist} · via Spotify ↗</div>
            </div>
            <div className="dur">
              {item.external.durationMs ? formatDuration(item.external.durationMs) : ''}
            </div>
          </a>
        ) : null,
      )}
    </DetailShell>
  );
}

export function LikedView({ navigate, onAddToPlaylist }: ViewProps) {
  const { client } = useAuth();
  const [tracks, setTracks] = useState<Track[] | null>(null);

  useEffect(() => {
    client
      .listLikedTracks()
      .then((r) => setTracks(r.tracks))
      .catch(() => setTracks([]));
  }, [client]);

  if (!tracks) return <div className="empty">Loading…</div>;
  return (
    <DetailShell navigate={navigate}>
      <div className="detail-header">
        <div>
          <h2>Liked songs</h2>
          <div className="sub">{tracks.length} tracks</div>
          <div className="actions">
            <PlayAllButton tracks={tracks} />
          </div>
        </div>
      </div>
      {tracks.map((t) => (
        <TrackRow key={t.id} track={t} queue={tracks} onAddToPlaylist={onAddToPlaylist} />
      ))}
    </DetailShell>
  );
}

// ---- admin ----

export function AdminView({ navigate }: { navigate: (v: View) => void }) {
  const { client, signOut } = useAuth();
  const [roots, setRoots] = useState<LibraryRoot[]>([]);
  const [scan, setScan] = useState<ScanStatus | null>(null);
  const [newPath, setNewPath] = useState('');
  const [error, setError] = useState<string | null>(null);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [r, s] = await Promise.all([client.listRoots(), client.scanStatus()]);
      setRoots(r.roots.filter((x) => x.enabled));
      setScan(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    }
  }, [client]);

  useEffect(() => {
    void refresh();
    return () => {
      if (poll.current) clearInterval(poll.current);
    };
  }, [refresh]);

  useEffect(() => {
    if (scan?.running && !poll.current) poll.current = setInterval(refresh, 1500);
    if (!scan?.running && poll.current) {
      clearInterval(poll.current);
      poll.current = null;
    }
  }, [scan?.running, refresh]);

  return (
    <DetailShell navigate={navigate}>
      <div className="detail-header">
        <div>
          <h2>Admin</h2>
        </div>
      </div>

      <div className="section-title">Library roots</div>
      <div style={{ display: 'flex', gap: 8, padding: '4px 8px 12px' }}>
        <input
          style={{
            flex: 1,
            maxWidth: 420,
            background: 'var(--panel)',
            border: 'none',
            borderRadius: 8,
            padding: '10px 12px',
            color: 'var(--text)',
          }}
          placeholder="/srv/music"
          value={newPath}
          onChange={(e) => setNewPath(e.target.value)}
        />
        <button
          className="primary"
          onClick={async () => {
            setError(null);
            try {
              await client.addRoot(newPath.trim());
              setNewPath('');
              void refresh();
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Failed');
            }
          }}
        >
          Add
        </button>
      </div>
      {roots.map((r) => (
        <div key={r.id} className="list-row" style={{ cursor: 'default' }}>
          <div className="name">{r.path}</div>
          <div className="count">
            {r.lastScanAt ? `scanned ${new Date(r.lastScanAt).toLocaleString()}` : 'never scanned'}
          </div>
          <button
            className="iconbtn"
            onClick={async () => {
              if (confirm(`Remove root ${r.path}?`)) {
                await client.removeRoot(r.id);
                void refresh();
              }
            }}
          >
            ✕
          </button>
        </div>
      ))}

      <div className="section-title">Scan</div>
      <div style={{ padding: '4px 8px' }} className="muted small">
        {scan?.running
          ? `Scanning… ${scan.scanned} files (${scan.added} new, ${scan.updated} updated)`
          : scan?.startedAt
            ? `Last scan: ${scan.scanned} scanned, ${scan.added} added, ${scan.updated} updated, ${scan.removed} removed${scan.errors.length ? `, ${scan.errors.length} errors` : ''}`
            : 'No scan yet'}
      </div>
      {scan?.errors.slice(0, 3).map((e, i) => (
        <div key={i} className="small" style={{ color: '#ff9f6b', padding: '2px 8px' }}>
          {e.file}: {e.message}
        </div>
      ))}
      <div style={{ padding: '10px 8px' }}>
        <button
          className="primary"
          disabled={scan?.running}
          onClick={async () => {
            setScan(await client.startScan());
          }}
        >
          {scan?.running ? 'Scanning…' : 'Scan now'}
        </button>
      </div>

      {error && (
        <div className="error" style={{ textAlign: 'left', padding: 8 }}>
          {error}
        </div>
      )}

      <SpotifySection />

      <div style={{ padding: '30px 8px' }}>
        <button style={{ color: 'var(--danger)' }} onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    </DetailShell>
  );
}

function SpotifySection() {
  const { client } = useAuth();
  const [status, setStatus] = useState<SpotifyStatus | null>(null);

  const refresh = useCallback(() => {
    client
      .spotifyStatus()
      .then(setStatus)
      .catch(() => {});
  }, [client]);
  useEffect(refresh, [refresh]);

  useEffect(() => {
    if (!status?.sync.running) return;
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, [status?.sync.running, refresh]);

  if (!status) return null;

  return (
    <>
      <div className="section-title">Spotify</div>
      {!status.configured ? (
        <div className="muted small" style={{ padding: '4px 8px' }}>
          Not configured — set SPOTIFY_CLIENT_ID and PUBLIC_URL on the server.
        </div>
      ) : !status.connected ? (
        <div style={{ padding: '8px' }}>
          <button
            className="primary"
            onClick={async () => {
              const { url } = await client.spotifyAuthStart();
              window.location.href = url;
            }}
          >
            Connect Spotify
          </button>
        </div>
      ) : (
        <div style={{ padding: '4px 8px' }}>
          <div className="muted small">
            Connected ·{' '}
            {status.sync.running
              ? `syncing… ${status.sync.tracks} tracks (${status.sync.matched} matched)`
              : status.lastSyncAt
                ? `last sync ${new Date(status.lastSyncAt).toLocaleString()} — ${status.sync.matched} matched to your library`
                : 'never synced'}
            {status.sync.lastError ? ` — error: ${status.sync.lastError}` : ''}
            {status.sync.skipped.length
              ? ` — ${status.sync.skipped.length} Spotify-owned playlists unavailable (${status.sync.skipped.slice(0, 3).join(', ')}${status.sync.skipped.length > 3 ? '…' : ''})`
              : ''}
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
            <button
              className="primary"
              disabled={status.sync.running}
              onClick={async () => {
                await client.spotifySyncNow().catch(() => {});
                refresh();
              }}
            >
              Sync now
            </button>
            <button
              className="iconbtn"
              onClick={async () => {
                if (confirm('Disconnect Spotify?')) {
                  await client.spotifyDisconnect();
                  refresh();
                }
              }}
            >
              Disconnect
            </button>
          </div>
        </div>
      )}
    </>
  );
}
