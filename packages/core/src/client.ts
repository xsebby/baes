import type {
  ApiErrorBody,
  CreateInviteResponse,
  HealthResponse,
  LoginRequest,
  LoginResponse,
  RedeemInviteRequest,
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
}
