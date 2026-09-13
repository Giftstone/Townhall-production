// client/src/hooks/useNotifications.js
// Works without socket.io-client (optional realtime if the package is installed)
import { useEffect, useState, useCallback, useRef } from 'react';
import toast from 'react-hot-toast';
import { useAuth } from './useAuth';
import { API_URL } from '../config';

const MAX_STORED = 50;
const SEEN_KEY = 'townhall_seen_report_ids';

export function useNotifications() {
  const { user, token } = useAuth();
  const [notifications, setNotifications] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('townhall_notifications') || '[]');
    } catch {
      return [];
    }
  });
  const [unread, setUnread] = useState(0);
  const socketRef = useRef(null);
  const knownIds = useRef(new Set());

  useEffect(() => {
    try {
      const raw = JSON.parse(localStorage.getItem(SEEN_KEY) || '[]');
      knownIds.current = new Set(Array.isArray(raw) ? raw : []);
    } catch {
      knownIds.current = new Set();
    }
  }, []);

  const persist = useCallback((list) => {
    localStorage.setItem('townhall_notifications', JSON.stringify(list.slice(0, MAX_STORED)));
  }, []);

  const addNotification = useCallback(
    (n) => {
      setNotifications((prev) => {
        const next = [n, ...prev].slice(0, MAX_STORED);
        persist(next);
        return next;
      });
      setUnread((u) => u + 1);
      if (n?.title) {
        toast(n.title, { duration: 4000 });
      }
    },
    [persist]
  );

  const markAllRead = useCallback(() => {
    setUnread(0);
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
    setUnread(0);
    localStorage.removeItem('townhall_notifications');
  }, []);

  // Optional Socket.IO — only if the dependency is installed
  useEffect(() => {
    if (!user || !token) return undefined;

    let cancelled = false;
    let socket = null;

    (async () => {
      try {
        const mod = await import('socket.io-client');
        if (cancelled) return;
        const io = mod.io || mod.default;
        if (typeof io !== 'function') return;

        socket = io(API_URL, {
          transports: ['websocket', 'polling'],
          reconnection: true,
          reconnectionAttempts: 5,
        });
        socketRef.current = socket;

        socket.on('connect', () => {
          socket.emit('identify', { userId: user.id, role: user.role });
        });
        socket.on('notification', (payload) => {
          addNotification(payload);
        });
      } catch {
        // socket.io-client not installed — polling fallback below is enough
      }
    })();

    return () => {
      cancelled = true;
      if (socket) socket.disconnect();
      socketRef.current = null;
    };
  }, [user, token, addNotification]);

  // Polling fallback: surface new reports as notifications
  useEffect(() => {
    if (!user || !token) return undefined;

    const poll = async (announce) => {
      try {
        const res = await fetch(`${API_URL}/api/reports`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const rows = await res.json();
        const list = Array.isArray(rows) ? rows.slice(0, 15) : [];

        if (announce) {
          list.forEach((r) => {
            if (!knownIds.current.has(r.id)) {
              addNotification({
                id: `report-${r.id}-${Date.now()}`,
                reportId: r.id,
                type: 'new_report',
                title: r.title || 'New report',
                message: `${r.category || 'Report'} · ${r.status || 'pending'}`,
                timestamp: r.created_at || new Date().toISOString(),
              });
            }
          });
        }

        list.forEach((r) => knownIds.current.add(r.id));
        localStorage.setItem(
          SEEN_KEY,
          JSON.stringify([...knownIds.current].slice(-200))
        );
      } catch {
        /* ignore network errors */
      }
    };

    poll(false);
    const t = setInterval(() => poll(true), 25000);
    return () => clearInterval(t);
  }, [user, token, addNotification]);

  return {
    notifications,
    unread,
    markAllRead,
    clearAll,
  };
}