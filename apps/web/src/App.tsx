import { useState } from 'react';
import type { Track } from '@baes/core';
import { AuthProvider, useAuth } from './state';
import { PlayerProvider } from './player';
import { AddToPlaylistModal, LikesProvider, PlayerBar } from './components';
import {
  AdminView,
  AlbumView,
  ArtistView,
  LikedView,
  LibraryView,
  Login,
  PlaylistView,
  type View,
} from './views';

function Main() {
  const { user } = useAuth();
  const [view, setView] = useState<View>({ type: 'library' });
  const [query, setQuery] = useState('');
  const [modalTrack, setModalTrack] = useState<Track | null>(null);

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
        {user?.role === 'owner' && (
          <button className="iconbtn" title="Admin" onClick={() => setView({ type: 'admin' })}>
            ⚙
          </button>
        )}
      </div>

      {view.type === 'library' && <LibraryView {...common} query={query} />}
      {view.type === 'album' && <AlbumView {...common} id={view.id} />}
      {view.type === 'artist' && <ArtistView {...common} id={view.id} />}
      {view.type === 'playlist' && <PlaylistView {...common} id={view.id} />}
      {view.type === 'liked' && <LikedView {...common} />}
      {view.type === 'admin' && <AdminView navigate={setView} />}

      <PlayerBar />
      {modalTrack && <AddToPlaylistModal track={modalTrack} onClose={() => setModalTrack(null)} />}
    </>
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
