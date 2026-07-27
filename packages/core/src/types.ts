export type UserRole = 'owner' | 'listener';

export interface User {
  id: string;
  username: string;
  role: UserRole;
  canDownload: boolean;
}

export interface LoginRequest {
  username: string;
  password: string;
  deviceName?: string;
}

export interface LoginResponse {
  token: string;
  user: User;
  expiresAt: string;
}

export interface RedeemInviteRequest {
  token: string;
  username: string;
  password: string;
  deviceName?: string;
}

export interface CreateInviteResponse {
  token: string;
  role: UserRole;
  expiresAt: string;
}

export interface ApiErrorBody {
  error: string;
  message: string;
}

export interface HealthResponse {
  status: 'ok';
  version: string;
}

export interface Track {
  id: string;
  title: string;
  durationMs: number;
  trackNo: number | null;
  codec: string;
  needsReview: boolean;
  artistId: string | null;
  artistName: string | null;
  albumId: string | null;
  albumTitle: string | null;
  /** Signed, relative to server base URL, short-lived. */
  streamUrl: string;
  artUrl: string | null;
}

export interface AlbumSummary {
  id: string;
  title: string;
  year: number | null;
  artistId: string | null;
  artistName: string | null;
  trackCount: number;
  artUrl: string | null;
}

export interface AlbumDetail extends Omit<AlbumSummary, 'trackCount'> {
  tracks: Track[];
}

export interface ArtistSummary {
  id: string;
  name: string;
  trackCount: number;
}

export interface ArtistDetail {
  id: string;
  name: string;
  tracks: Track[];
}

export interface LibraryRoot {
  id: string;
  path: string;
  enabled: boolean;
  lastScanAt: string | null;
}

export interface ScanStatus {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  scanned: number;
  added: number;
  updated: number;
  removed: number;
  errors: { file: string; message: string }[];
}

export interface PlayEventInput {
  trackId: string;
  playedMs: number;
  startedAt: string;
  deviceId?: string;
}

export interface PlaylistSummary {
  id: string;
  title: string;
  source: 'local' | 'spotify';
  createdAt: string;
  trackCount: number;
  artUrl: string | null;
}

export interface ExternalTrackMeta {
  spotifyId: string;
  title: string;
  artist: string;
  album: string | null;
  durationMs: number | null;
  artUrl: string | null;
  matched: boolean;
}

export interface PlaylistItem {
  itemId: string;
  /** Playable local track — present for local items and matched Spotify items. */
  track: Track | null;
  /** Spotify metadata — present for mirrored items. */
  external: ExternalTrackMeta | null;
}

export interface PlaylistDetail {
  id: string;
  title: string;
  source: 'local' | 'spotify';
  artUrl: string | null;
  items: PlaylistItem[];
}

export interface SpotifyStatus {
  configured: boolean;
  connected: boolean;
  lastSyncAt: string | null;
  sync: {
    running: boolean;
    lastSyncAt: string | null;
    lastError: string | null;
    playlists: number;
    tracks: number;
    matched: number;
    skipped: string[];
  };
}

export interface ImportJob {
  id: string;
  url: string;
  status: 'running' | 'done' | 'error';
  error: string | null;
  startedAt: string;
}

export interface TrackPatch {
  title?: string;
  artistName?: string | null;
  albumTitle?: string | null;
}
