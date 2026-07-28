import { useEffect, useState } from 'react';
import type { Track } from '@baes/core';
import { AuthProvider, useAuth } from './state';
import { PlayerProvider } from './player';
import { AddToPlaylistModal, LikesProvider, PlayerBar } from './components';
import { FullscreenPlayer } from './Fullscreen';
import { ACCENTS, applyTheme, loadTheme, saveTheme, type ThemeSettings } from './theme';
import {
  AdminView,
  AlbumView,
  ArtistView,
  LikedView,
  LibraryView,
  Login,
  PlaylistView,
  type Segment,
  type View,
} from './views';

function Main() {
  const { user } = useAuth();
  useEffect(() => {
    if (navigator.userAgent.includes('Electron')) document.body.classList.add('electron');
    applyTheme(loadTheme());
  }, []);
  const [view, setView] = useState<View>({ type: 'library' });
  const [query, setQuery] = useState('');
  // Owned here so returning from a detail view keeps the tab you were on.
  const [segment, setSegment] = useState<Segment>('songs');
  const [modalTrack, setModalTrack] = useState<Track | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [showAppearance, setShowAppearance] = useState(false);

  const common = { navigate: setView, onAddToPlaylist: setModalTrack };

  return (
    <>
      <div className="topbar">
        <span className="logo" onClick={() => setView({ type: 'library' })}>
          bæs
        </span>
        {view.type === 'library' ? (
          <input
            placeholder="Search your library"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        ) : (
          <span className="spacer" />
        )}
        <span className="spacer" />
        <button className="iconbtn" title="Appearance" onClick={() => setShowAppearance(true)}>
          🎨
        </button>
        {user?.role === 'owner' && (
          <button className="iconbtn" title="Admin" onClick={() => setView({ type: 'admin' })}>
            ⚙
          </button>
        )}
      </div>

      {view.type === 'library' && (
        <LibraryView {...common} query={query} segment={segment} setSegment={setSegment} />
      )}
      {view.type === 'album' && <AlbumView {...common} id={view.id} />}
      {view.type === 'artist' && <ArtistView {...common} id={view.id} />}
      {view.type === 'playlist' && <PlaylistView {...common} id={view.id} />}
      {view.type === 'liked' && <LikedView {...common} />}
      {view.type === 'admin' && <AdminView navigate={setView} />}

      <PlayerBar onExpand={() => setFullscreen(true)} />
      {fullscreen && <FullscreenPlayer onClose={() => setFullscreen(false)} />}
      {showAppearance && <AppearanceModal onClose={() => setShowAppearance(false)} />}
      {modalTrack && <AddToPlaylistModal track={modalTrack} onClose={() => setModalTrack(null)} />}
    </>
  );
}

function AppearanceModal({ onClose }: { onClose: () => void }) {
  const [theme, setTheme] = useState<ThemeSettings>(loadTheme);

  function update(patch: Partial<ThemeSettings>) {
    const next = { ...theme, ...patch };
    setTheme(next);
    saveTheme(next);
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Appearance</h3>

        <div className="muted small">Accent</div>
        <div className="swatches">
          {ACCENTS.map((a) => (
            <button
              key={a.value}
              className={`swatch${theme.accent === a.value ? ' active' : ''}`}
              style={{ background: a.value }}
              title={a.name}
              onClick={() => update({ accent: a.value })}
            />
          ))}
          <label
            className={`swatch${!ACCENTS.some((a) => a.value === theme.accent) ? ' active' : ''}`}
            title="Custom color"
            style={{
              background: 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)',
              display: 'inline-block',
              cursor: 'pointer',
              overflow: 'hidden',
            }}
          >
            <input
              type="color"
              value={theme.accent}
              style={{ opacity: 0, width: '100%', height: '100%', cursor: 'pointer' }}
              onChange={(e) => update({ accent: e.target.value })}
            />
          </label>
        </div>

        <div className="muted small">Panels</div>
        <div className="opt-row">
          {(['opaque', 'clear'] as const).map((p) => (
            <button
              key={p}
              className={`opt${theme.panels === p ? ' active' : ''}`}
              onClick={() => update({ panels: p })}
            >
              {p === 'opaque' ? 'Opaque' : 'Clear glass'}
            </button>
          ))}
        </div>

        <div className="muted small">Fullscreen background</div>
        <div className="opt-row">
          {(
            [
              ['aurora', 'Aurora'],
              ['pulse', 'Pulse'],
              ['minimal', 'Minimal'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              className={`opt${theme.fsStyle === key ? ' active' : ''}`}
              onClick={() => update({ fsStyle: key })}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Gate() {
  const { ready, user } = useAuth();
  if (!ready) return <div className="empty">Loading…</div>;
  if (!user) return <Login />;
  return (
    <PlayerProvider>
      <LikesProvider>
        <Main />
      </LikesProvider>
    </PlayerProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
