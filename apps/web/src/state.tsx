import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ApiClient, type User } from '@baes/core';

const TOKEN_KEY = 'baes.token';

interface AuthState {
  ready: boolean;
  user: User | null;
  client: ApiClient;
  signIn: (username: string, password: string, setup: boolean) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

// Served from the same origin as the API, so the base URL is simply ''.
function makeClient(): ApiClient {
  return new ApiClient({
    baseUrl: '',
    getToken: () => localStorage.getItem(TOKEN_KEY),
  });
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const client = useMemo(makeClient, []);
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    if (!localStorage.getItem(TOKEN_KEY)) {
      setReady(true);
      return;
    }
    client
      .me()
      .then(setUser)
      .catch(() => localStorage.removeItem(TOKEN_KEY))
      .finally(() => setReady(true));
  }, [client]);

  const signIn = useCallback(
    async (username: string, password: string, setup: boolean) => {
      const req = { username, password, deviceName: 'web' };
      const res = setup ? await client.setup(req) : await client.login(req);
      localStorage.setItem(TOKEN_KEY, res.token);
      setUser(res.user);
    },
    [client],
  );

  const signOut = useCallback(async () => {
    try {
      await client.logout();
    } catch {
      // best-effort
    }
    localStorage.removeItem(TOKEN_KEY);
    setUser(null);
  }, [client]);

  const value = useMemo(
    () => ({ ready, user, client, signIn, signOut }),
    [ready, user, client, signIn, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside provider');
  return ctx;
}

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function formatSeconds(sec: number): string {
  return formatDuration(sec * 1000);
}
