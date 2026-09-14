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

export const useProvideAuth = () => {
  const [user, setUser] = useState(() => readStoredUser());
  const [token, setToken] = useState(() => localStorage.getItem(ACCESS_KEY));
  const [loading, setLoading] = useState(true);
  const verifyingRef = useRef(false);

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

  // Try refresh once; returns new access token or null
  const tryRefresh = useCallback(async () => {
    const refreshToken = localStorage.getItem(REFRESH_KEY);
    if (!refreshToken) return null;

    try {
      const res = await fetch(`${API_URL}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data.accessToken) return null;

      localStorage.setItem(ACCESS_KEY, data.accessToken);
      if (data.refreshToken) localStorage.setItem(REFRESH_KEY, data.refreshToken);
      setToken(data.accessToken);
      return data.accessToken;
    } catch {
      // Network blip — do NOT wipe session
      return null;
    }
  }, []);

  // INITIAL LOAD + whenever access token changes
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
        return;
      }

      try {
        let res = await fetch(`${API_URL}/api/auth/me`, {
          headers: { Authorization: `Bearer ${currentToken}` },
        });

        // Access expired/invalid → try refresh once
        if (res.status === 401 || res.status === 403) {
          const newAccess = await tryRefresh();
          if (newAccess) {
            res = await fetch(`${API_URL}/api/auth/me`, {
              headers: { Authorization: `Bearer ${newAccess}` },
            });
          } else {
            // Refresh also rejected → real logout
            if (!cancelled) logout();
            if (!cancelled) setLoading(false);
            verifyingRef.current = false;
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
          if (!cancelled) logout();
        } else {
          // 5xx / unexpected — keep cached session; don't log out
          const cached = readStoredUser();
          if (cached && !cancelled) setUser(cached);
        }
      } catch {
        // Network error (common when toggling device toolbar / offline blip)
        // Keep existing token + cached user. Do NOT logout.
        const cached = readStoredUser();
        if (cached && !cancelled) setUser(cached);
      } finally {
        if (!cancelled) setLoading(false);
        verifyingRef.current = false;
      }
    };

    verifyToken();
    return () => {
      cancelled = true;
    };
  }, [token, logout, tryRefresh]);

  // SILENT REFRESH on an interval — never logout on network failure
  useEffect(() => {
    if (!token) return;

    const refreshTimer = setInterval(async () => {
      const newAccess = await tryRefresh();
      if (!newAccess) {
        // Only logout if refresh token is explicitly rejected (handled inside tryRefresh
        // returning null after a 401/403). If it was a network error, leave session alone.
        const stillHasRefresh = !!localStorage.getItem(REFRESH_KEY);
        if (!stillHasRefresh) logout();
      }
    }, 12 * 60 * 1000);

    return () => clearInterval(refreshTimer);
  }, [token, tryRefresh, logout]);

  // LOGIN
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

  // REGISTER
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
