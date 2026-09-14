// client/src/hooks/useAuth.js
import { useState, useEffect, useCallback, useContext, useRef } from 'react';
import { AuthContext } from '../context/AuthContext';
import { API_URL } from '../config';

const ACCESS_KEY = 'accessToken';
const REFRESH_KEY = 'refreshToken';
const USER_KEY = 'authUser';

function readStoredUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function persistUser(user) {
  if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
  else localStorage.removeItem(USER_KEY);
}

/** Best-effort decode of JWT payload (no signature check — server still authenticates). */
function userFromAccessToken(accessToken) {
  try {
    const part = String(accessToken).split('.')[1];
    if (!part) return null;
    const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/')));
    if (!json || (!json.id && !json.sub)) return null;
    return {
      id: json.id || json.sub,
      email: json.email || '',
      name: json.name || json.email || 'User',
      role: json.role || 'citizen',
    };
  } catch {
    return null;
  }
}

export const useProvideAuth = () => {
  const [user, setUser] = useState(() => readStoredUser());
  const [token, setToken] = useState(() => localStorage.getItem(ACCESS_KEY));
  const [loading, setLoading] = useState(true);
  const verifyingRef = useRef(false);
  // Prevent effect re-entry loops when setToken is called from inside verify/refresh
  const bootstrappedRef = useRef(false);

  const logout = useCallback(() => {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
    localStorage.removeItem(USER_KEY);
    setToken(null);
    setUser(null);
  }, []);

  const applySession = useCallback((accessToken, refreshToken, nextUser) => {
    if (accessToken) localStorage.setItem(ACCESS_KEY, accessToken);
    if (refreshToken) localStorage.setItem(REFRESH_KEY, refreshToken);
    if (nextUser) {
      persistUser(nextUser);
      setUser(nextUser);
    }
    if (accessToken) setToken(accessToken);
  }, []);

  /**
   * @returns {{ status: 'ok'|'rejected'|'network', accessToken?: string }}
   * - ok: got new tokens
   * - rejected: server said refresh is invalid (true logout case)
   * - network: fetch failed / CORS / offline — MUST NOT logout
   */
  const tryRefresh = useCallback(async () => {
    const refreshToken = localStorage.getItem(REFRESH_KEY);
    if (!refreshToken) return { status: 'rejected' };

    try {
      const res = await fetch(`${API_URL}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });

      if (res.status === 401 || res.status === 403) {
        return { status: 'rejected' };
      }
      if (!res.ok) {
        // 5xx etc. — treat as soft failure, keep session
        return { status: 'network' };
      }

      const data = await res.json();
      if (!data.accessToken) return { status: 'rejected' };

      localStorage.setItem(ACCESS_KEY, data.accessToken);
      if (data.refreshToken) localStorage.setItem(REFRESH_KEY, data.refreshToken);
      // Don't setToken here — caller controls that to avoid effect storms
      return { status: 'ok', accessToken: data.accessToken };
    } catch {
      return { status: 'network' };
    }
  }, []);

  // Bootstrap session once on mount; only re-run when token is cleared/set from login/logout
  useEffect(() => {
    let cancelled = false;

    const verifyToken = async () => {
      if (verifyingRef.current) return;
      verifyingRef.current = true;

      const currentToken = localStorage.getItem(ACCESS_KEY);

      if (!currentToken) {
        if (!cancelled) {
          setUser(null);
          setLoading(false);
        }
        verifyingRef.current = false;
        bootstrappedRef.current = true;
        return;
      }

      // Optimistic: show cached or JWT-decoded user immediately so viewport
      // switches never flash the login screen while /me is in flight.
      const optimistic = readStoredUser() || userFromAccessToken(currentToken);
      if (optimistic && !cancelled) {
        setUser((prev) => prev || optimistic);
      }

      try {
        let res = await fetch(`${API_URL}/api/auth/me`, {
          headers: { Authorization: `Bearer ${currentToken}` },
        });

        // Access expired/invalid → try refresh once
        if (res.status === 401 || res.status === 403) {
          const refreshed = await tryRefresh();

          if (refreshed.status === 'ok' && refreshed.accessToken) {
            if (!cancelled) setToken(refreshed.accessToken);
            res = await fetch(`${API_URL}/api/auth/me`, {
              headers: { Authorization: `Bearer ${refreshed.accessToken}` },
            });
          } else if (refreshed.status === 'rejected') {
            // Server explicitly rejected refresh — real logout
            if (!cancelled) logout();
            if (!cancelled) setLoading(false);
            verifyingRef.current = false;
            bootstrappedRef.current = true;
            return;
          } else {
            // network — keep optimistic session
            if (!cancelled) {
              const keep = readStoredUser() || userFromAccessToken(currentToken);
              if (keep) setUser(keep);
              setLoading(false);
            }
            verifyingRef.current = false;
            bootstrappedRef.current = true;
            return;
          }
        }

        if (res.ok) {
          const userData = await res.json();
          if (!cancelled) {
            persistUser(userData);
            setUser(userData);
          }
        } else if (res.status === 401 || res.status === 403) {
          // /me still unauthorized after refresh attempt
          if (!cancelled) logout();
        } else {
          // Non-auth failure — keep session
          const keep = readStoredUser() || userFromAccessToken(currentToken);
          if (keep && !cancelled) setUser(keep);
        }
      } catch {
        // Network / CORS / offline — NEVER logout
        const keep = readStoredUser() || userFromAccessToken(currentToken);
        if (keep && !cancelled) setUser(keep);
      } finally {
        if (!cancelled) setLoading(false);
        verifyingRef.current = false;
        bootstrappedRef.current = true;
      }
    };

    verifyToken();
    return () => {
      cancelled = true;
    };
    // Intentionally only depend on token identity changes from login/logout/refresh success.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Silent refresh interval
  useEffect(() => {
    if (!token) return undefined;

    const refreshTimer = setInterval(async () => {
      const result = await tryRefresh();
      if (result.status === 'ok' && result.accessToken) {
        setToken(result.accessToken);
      } else if (result.status === 'rejected') {
        logout();
      }
      // network → ignore
    }, 12 * 60 * 1000);

    return () => clearInterval(refreshTimer);
  }, [token, tryRefresh, logout]);

  const login = async (email, password) => {
    const res = await fetch(`${API_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Login failed');
    }

    applySession(data.accessToken, data.refreshToken, data.user);
    return data;
  };

  const register = async (name, email, password, role) => {
    const res = await fetch(`${API_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password, role }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Register failed');
    return data;
  };

  return { user, token, login, register, logout, loading };
};

export const useAuth = () => useContext(AuthContext);
