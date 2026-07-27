import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { PlaylistSummary, Track } from '@baes/core';
import { formatSeconds, formatDuration, useAuth } from './state';
import { usePlayer } from './player';

// ---- likes ----

interface LikesState {
  likedIds: Set<string>;
  toggleLike: (trackId: string) => void;
}

const LikesContext = createContext<LikesState | null>(null);

export function LikesProvider({ children }: { children: React.ReactNode }) {
  const { client } = useAuth();
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    client
      .listLikedTrackIds()
      .then((r) => setLikedIds(new Set(r.trackIds)))
      .catch(() => {});
  }, [client]);

  const toggleLike = useCallback(
    (trackId: string) => {
      setLikedIds((prev) => {
        const next = new Set(prev);
        if (next.has(trackId)) {
          next.delete(trackId);
          client.unlikeTrack(trackId).catch(() => {});
        } else {
          next.add(trackId);
          client.likeTrack(trackId).catch(() => {});
        }
        return next;
      });
    },
    [client],
  );

  return <LikesContext.Provider value={{ likedIds, toggleLike }}>{children}</LikesContext.Provider>;
}

export function useLikes(): LikesState {
  const ctx = useContext(LikesContext);
  if (!ctx) throw new Error('useLikes outside provider');
  return ctx;
}

// ---- track row ----

export function TrackRow({
  track,
  queue,
  onAddToPlaylist,
  trailing,
}: {
  track: Track;
  queue: Track[];
  onAddToPlaylist: (track: Track) => void;
  trailing?: React.ReactNode;
}) {
  const { client } = useAuth();
  const { playTrack, current } = usePlayer();
  const { likedIds, toggleLike } = useLikes();
  const active = current?.id === track.id;
  const liked = likedIds.has(track.id);

  return (
    <div className="track-row" onClick={() => playTrack(track, queue)}>
      {track.artUrl ? (
        <img className="art" src={client.mediaUrl(track.artUrl)} alt="" />
      ) : (
        <div className="art">♪</div>
      )}
      <div className="meta">
        <div className={`title${active ? ' active' : ''}`}>{track.title}</div>
        <div className="sub">
          {track.artistName ?? 'Unknown artist'}
          {track.albumTitle ? ` · ${track.albumTitle}` : ''}
        </div>
      </div>
      <button
        className={`rowbtn${liked ? ' liked' : ''}`}
        title={liked ? 'Unlike' : 'Like'}
        onClick={(e) => {
          e.stopPropagation();
          toggleLike(track.id);
        }}
      >
        {liked ? '♥' : '♡'}
      </button>
      <button
        className="rowbtn"
        title="Add to playlist"
        onClick={(e) => {
          e.stopPropagation();
          onAddToPlaylist(track);
        }}
      >
        +
      </button>
      <div className="dur">{formatDuration(track.durationMs)}</div>
      {trailing}
    </div>
  );
}

// ---- add-to-playlist modal ----

export function AddToPlaylistModal({ track, onClose }: { track: Track; onClose: () => void }) {
  const { client } = useAuth();
  const [playlists, setPlaylists] = useState<PlaylistSummary[] | null>(null);
  const [title, setTitle] = useState('');

  useEffect(() => {
    client
      .listPlaylists()
      .then((r) => setPlaylists(r.playlists.filter((p) => p.source === 'local')))
      .catch(() => setPlaylists([]));
  }, [client]);

  async function addTo(playlistId: string) {
    await client.addToPlaylist(playlistId, track.id);
    onClose();
  }

  async function createAndAdd() {
    if (!title.trim()) return;
    const { playlist } = await client.createPlaylist(title.trim());
    await client.addToPlaylist(playlist.id, track.id);
    onClose();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>
          Add <span className="muted">“{track.title}”</span> to…
        </h3>
        <input
          placeholder="New playlist name…"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && createAndAdd()}
        />
        {title.trim() && (
          <div className="row" onClick={createAndAdd}>
            <span style={{ color: 'var(--accent)' }}>＋ Create “{title.trim()}” and add</span>
          </div>
        )}
        {playlists === null ? (
          <div className="muted small">Loading…</div>
        ) : (
          playlists.map((p) => (
            <div key={p.id} className="row" onClick={() => addTo(p.id)}>
              <span>{p.title}</span>
              <span className="muted small" style={{ marginLeft: 'auto' }}>
                {p.trackCount}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ---- bottom player bar ----

export function PlayerBar() {
  const { client } = useAuth();
  const {
    current,
    playing,
    positionSec,
    durationSec,
    volume,
    toggle,
    next,
    previous,
    seekTo,
    setVolume,
  } = usePlayer();
  const { likedIds, toggleLike } = useLikes();
  const [dragSec, setDragSec] = useState<number | null>(null);

  if (!current) return null;
  const shown = dragSec ?? positionSec;
  const liked = likedIds.has(current.id);

  return (
    <div className="playerbar">
      <div className="now">
        {current.artUrl ? (
          <img src={client.mediaUrl(current.artUrl)} alt="" />
        ) : (
          <div className="art">♪</div>
        )}
        <div className="meta" style={{ minWidth: 0 }}>
          <div className="title" style={{ fontSize: 14, fontWeight: 600 }}>
            {current.title}
          </div>
          <div className="sub muted small">{current.artistName ?? 'Unknown artist'}</div>
        </div>
        <button
          className={`rowbtn${liked ? ' liked' : ''}`}
          style={{ visibility: 'visible' }}
          onClick={() => toggleLike(current.id)}
        >
          {liked ? '♥' : '♡'}
        </button>
      </div>

      <div className="center">
        <div className="controls">
          <button onClick={previous} title="Previous">
            ⏮
          </button>
          <button className="play" onClick={toggle} title="Play/pause">
            {playing ? '❚❚' : '▶'}
          </button>
          <button onClick={next} title="Next">
            ⏭
          </button>
        </div>
        <div className="scrub">
          <span className="t">{formatSeconds(shown)}</span>
          <input
            type="range"
            min={0}
            max={Math.max(durationSec, 1)}
            step={0.5}
            value={Math.min(shown, durationSec || shown)}
            onChange={(e) => setDragSec(Number(e.target.value))}
            onMouseUp={() => {
              if (dragSec != null) seekTo(dragSec);
              setDragSec(null);
            }}
          />
          <span className="t" style={{ textAlign: 'right' }}>
            {formatSeconds(durationSec)}
          </span>
        </div>
      </div>

      <div className="right">
        <span className="muted small">🔊</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.02}
          value={volume}
          onChange={(e) => setVolume(Number(e.target.value))}
        />
      </div>
    </div>
  );
}
