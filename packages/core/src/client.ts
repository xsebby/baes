import type {
  AlbumDetail,
  AlbumSummary,
  ApiErrorBody,
  ArtistDetail,
  ArtistSummary,
  CreateInviteResponse,
  HealthResponse,
  LibraryRoot,
  LoginRequest,
  LoginResponse,
  PlayEventInput,
  PlaylistDetail,
  PlaylistSummary,
  RedeemInviteRequest,
  ImportJob,
  ScanStatus,
  SpotifyStatus,
  TrackPatch,
  Track,
  User,
} from './types.js';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiClientOptions {
  baseUrl: string;
  getToken?: () => string | null | Promise<string | null>;
  fetchImpl?: typeof fetch;
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly getToken: NonNullable<ApiClientOptions['getToken']>;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: ApiClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.getToken = opts.getToken ?? (() => null);
    // Wrap rather than store bare `fetch` — browsers throw "Illegal invocation"
    // when fetch is called detached from its global.
    this.fetchImpl = opts.fetchImpl ?? ((...args) => fetch(...args));
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' };
    const token = await this.getToken();
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';

    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!res.ok) {
      let parsed: Partial<ApiErrorBody> = {};
      try {
        parsed = (await res.json()) as ApiErrorBody;
      } catch {
        // non-JSON error body
      }
      throw new ApiError(res.status, parsed.error ?? 'unknown', parsed.message ?? res.statusText);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  health(): Promise<HealthResponse> {
    return this.request('GET', '/api/health');
  }

  login(req: LoginRequest): Promise<LoginResponse> {
    return this.request('POST', '/api/auth/login', req);
  }

  /** First-run owner bootstrap; only succeeds while the server has zero users. */
  setup(req: LoginRequest): Promise<LoginResponse> {
    return this.request('POST', '/api/auth/setup', req);
  }

  logout(): Promise<void> {
    return this.request('POST', '/api/auth/logout');
  }

  me(): Promise<User> {
    return this.request('GET', '/api/auth/me');
  }

  redeemInvite(req: RedeemInviteRequest): Promise<LoginResponse> {
    return this.request('POST', '/api/auth/invite/redeem', req);
  }

  createInvite(role: 'listener' | 'owner' = 'listener'): Promise<CreateInviteResponse> {
    return this.request('POST', '/api/admin/invites', { role });
  }

  // ---- Library ----

  listTracks(opts: { q?: string; limit?: number; offset?: number } = {}): Promise<{
    tracks: Track[];
  }> {
    const params = new URLSearchParams();
    if (opts.q) params.set('q', opts.q);
    if (opts.limit) params.set('limit', String(opts.limit));
    if (opts.offset) params.set('offset', String(opts.offset));
    const qs = params.toString();
    return this.request('GET', `/api/tracks${qs ? `?${qs}` : ''}`);
  }

  listAlbums(): Promise<{ albums: AlbumSummary[] }> {
    return this.request('GET', '/api/albums');
  }

  getAlbum(id: string): Promise<AlbumDetail> {
    return this.request('GET', `/api/albums/${id}`);
  }

  listArtists(): Promise<{ artists: ArtistSummary[] }> {
    return this.request('GET', '/api/artists');
  }

  getArtist(id: string): Promise<ArtistDetail> {
    return this.request('GET', `/api/artists/${id}`);
  }

  refreshStreamUrl(trackId: string): Promise<{ url: string; expiresAt: string }> {
    return this.request('GET', `/api/tracks/${trackId}/stream-url`);
  }

  reportPlays(events: PlayEventInput[]): Promise<void> {
    return this.request('POST', '/api/plays', { events });
  }

  /** Resolve a signed relative media path against the server base URL. */
  mediaUrl(relative: string): string {
    return `${this.baseUrl}${relative}`;
  }

  // ---- Playlists & likes ----

  listPlaylists(): Promise<{ playlists: PlaylistSummary[] }> {
    return this.request('GET', '/api/playlists');
  }

  createPlaylist(title: string): Promise<{ playlist: { id: string; title: string } }> {
    return this.request('POST', '/api/playlists', { title });
  }

  getPlaylist(id: string): Promise<PlaylistDetail> {
    return this.request('GET', `/api/playlists/${id}`);
  }

  deletePlaylist(id: string): Promise<void> {
    return this.request('DELETE', `/api/playlists/${id}`);
  }

  addToPlaylist(playlistId: string, trackId: string): Promise<{ item: { id: string } }> {
    return this.request('POST', `/api/playlists/${playlistId}/items`, { trackId });
  }

  removeFromPlaylist(playlistId: string, itemId: string): Promise<void> {
    return this.request('DELETE', `/api/playlists/${playlistId}/items/${itemId}`);
  }

  // ---- Spotify ----

  spotifyStatus(): Promise<SpotifyStatus> {
    return this.request('GET', '/api/spotify/status');
  }

  spotifyAuthStart(): Promise<{ url: string }> {
    return this.request('POST', '/api/spotify/auth-start');
  }

  spotifySyncNow(): Promise<void> {
    return this.request('POST', '/api/spotify/sync');
  }

  spotifyDisconnect(): Promise<void> {
    return this.request('DELETE', '/api/spotify/link');
  }

  listLikedTracks(): Promise<{ tracks: Track[] }> {
    return this.request('GET', '/api/likes');
  }

  listLikedTrackIds(): Promise<{ trackIds: string[] }> {
    return this.request('GET', '/api/likes/ids');
  }

  likeTrack(trackId: string): Promise<void> {
    return this.request('PUT', `/api/tracks/${trackId}/like`);
  }

  unlikeTrack(trackId: string): Promise<void> {
    return this.request('DELETE', `/api/tracks/${trackId}/like`);
  }

  // ---- Admin: library roots + scanning ----

  listRoots(): Promise<{ roots: LibraryRoot[] }> {
    return this.request('GET', '/api/admin/roots');
  }

  addRoot(path: string): Promise<{ root: LibraryRoot }> {
    return this.request('POST', '/api/admin/roots', { path });
  }

  removeRoot(id: string): Promise<void> {
    return this.request('DELETE', `/api/admin/roots/${id}`);
  }

  startScan(): Promise<ScanStatus> {
    return this.request('POST', '/api/admin/scan');
  }

  scanStatus(): Promise<ScanStatus> {
    return this.request('GET', '/api/admin/scan/status');
  }

  // ---- Ingest ----

  updateTrack(id: string, patch: TrackPatch): Promise<void> {
    return this.request('PATCH', `/api/tracks/${id}`, patch);
  }

  importUrl(url: string): Promise<{ job: ImportJob }> {
    return this.request('POST', '/api/import-url', { url });
  }

  listImportJobs(): Promise<{ jobs: ImportJob[] }> {
    return this.request('GET', '/api/import-jobs');
  }

  /** Multipart upload (browser): pass a FormData with one or more `file` parts. */
  async uploadFiles(form: FormData): Promise<{ saved: string[]; rejected: string[] }> {
    const headers: Record<string, string> = {};
    const token = await this.getToken();
    if (token) headers.authorization = `Bearer ${token}`;
    const res = await this.fetchImpl(`${this.baseUrl}/api/upload`, {
      method: 'POST',
      headers,
      body: form,
    });
    if (!res.ok) {
      throw new ApiError(res.status, 'upload_failed', `Upload failed (${res.status})`);
    }
    return (await res.json()) as { saved: string[]; rejected: string[] };
  }
}
