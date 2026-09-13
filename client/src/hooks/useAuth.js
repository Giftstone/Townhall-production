// client/src/hooks/useAuth.js
import { useState, useEffect, useCallback, useContext } from 'react';
import { AuthContext } from '../context/AuthContext';
import { API_URL } from '../config';

// In useAuth.js, useReports.js, and usePolls.js

export const useProvideAuth = () => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(localStorage.getItem('accessToken'));
  const [loading, setLoading] = useState(true);

  //  LOGOUT
    const logout = useCallback(() => {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    setToken(null);
    setUser(null);
  }, []);

  // INITIAL LOAD: Verify token on mount 
  useEffect(() => {
    const verifyToken = async () => {
      if (!token) {
        setLoading(false);
        return;
      }

      try {
        const res = await fetch(`${API_URL}/api/auth/me`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        
        if (res.ok) {
          const userData = await res.json();
          setUser(userData);
        } else {
         logout();
        }
      } catch  {
        logout();
      } finally {
        setLoading(false); 
      }
    };

    verifyToken();
  }, [token, logout]); 

  // SILENT REFRESH
  useEffect(() => {
    if (!token) return;
    
    const refreshTimer = setInterval(async () => {
      const refreshToken = localStorage.getItem('refreshToken');
      if (!refreshToken) return;
      
      try {
        const res = await fetch(`${API_URL}/api/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken })
        });
        
        if (res.ok) {
          const { accessToken, refreshToken: newRefresh } = await res.json();
          localStorage.setItem('accessToken', accessToken);
          localStorage.setItem('refreshToken', newRefresh);
          setToken(accessToken);
        } else {
          logout();
        }
      } catch {
        logout();
      }
    }, 12 * 60 * 1000); // Every 12 min 
    
    return () => clearInterval(refreshTimer);
  }, [token, logout]);

  
  // LOGIN
  const login = async (email, password) => {
    const res = await fetch(`${API_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Login failed');
    }

    //save tokens
    localStorage.setItem('accessToken', data.accessToken);
    localStorage.setItem('refreshToken', data.refreshToken);
    setToken(data.accessToken);
    setUser(data.user);
    return data;
  };

  // REGISTER
  const register = async (name, email, password, role) => {
    const res = await fetch(`${API_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password, role })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Register failed');
    return data;
  };

  return { user, token, login, register, logout, loading };
};

export const useAuth = () => useContext(AuthContext);