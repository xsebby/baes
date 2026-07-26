import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { ApiClient, type User } from '@baes/core';

const KEY_SERVER_URL = 'baes.serverUrl';
const KEY_TOKEN = 'baes.token';

interface AuthState {
  ready: boolean;
  serverUrl: string | null;
  token: string | null;
  user: User | null;
  client: ApiClient | null;
  signIn: (serverUrl: string, username: string, password: string, setup: boolean) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [serverUrl, setServerUrl] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);

  const client = useMemo(() => {
    if (!serverUrl) return null;
    return new ApiClient({ baseUrl: serverUrl, getToken: () => token });
  }, [serverUrl, token]);

  useEffect(() => {
    (async () => {
      const [storedUrl, storedToken] = await Promise.all([
        SecureStore.getItemAsync(KEY_SERVER_URL),
        SecureStore.getItemAsync(KEY_TOKEN),
      ]);
      setServerUrl(storedUrl);
      setToken(storedToken);
      if (storedUrl && storedToken) {
        try {
          const me = await new ApiClient({
            baseUrl: storedUrl,
            getToken: () => storedToken,
          }).me();
          setUser(me);
        } catch {
          // Token expired/revoked — fall back to login screen.
          setToken(null);
          await SecureStore.deleteItemAsync(KEY_TOKEN);
        }
      }
      setReady(true);
    })();
  }, []);

  const signIn = useCallback(
    async (url: string, username: string, password: string, setup: boolean) => {
      const normalized = url.replace(/\/+$/, '');
      const fresh = new ApiClient({ baseUrl: normalized });
      const req = { username, password, deviceName: 'mobile' };
      const res = setup ? await fresh.setup(req) : await fresh.login(req);
      await SecureStore.setItemAsync(KEY_SERVER_URL, normalized);
      await SecureStore.setItemAsync(KEY_TOKEN, res.token);
      setServerUrl(normalized);
      setToken(res.token);
      setUser(res.user);
    },
    [],
  );

  const signOut = useCallback(async () => {
    try {
      await client?.logout();
    } catch {
      // best-effort; local sign-out proceeds regardless
    }
    await SecureStore.deleteItemAsync(KEY_TOKEN);
    setToken(null);
    setUser(null);
  }, [client]);

  const value = useMemo(
    () => ({ ready, serverUrl, token, user, client, signIn, signOut }),
    [ready, serverUrl, token, user, client, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
