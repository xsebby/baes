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
  RedeemInviteRequest,
  ScanStatus,
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
    this.fetchImpl = opts.fetchImpl ?? fetch;
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
}
