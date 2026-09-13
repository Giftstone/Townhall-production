// client/src/hooks/useReports.js
import { useState, useEffect, useCallback } from 'react';
import { API_URL } from '../config';

export const useReports = (token) => {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    const fetchData = async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
      if (!isMounted) return;
      if (!token) { setReports([]); setLoading(false); return; }
      setLoading(true);
      try {
        const res = await fetch(`${API_URL}/api/reports`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!isMounted) return;
        if (res.ok) {
          const data = await res.json();
          setReports(Array.isArray(data) ? data : data.reports || []);
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };
    fetchData();
    return () => { isMounted = false; };
  }, [token]);

  // imageFiles: single File OR File[] OR null
  const createReport = useCallback(async (data, imageFiles) => {
    setLoading(true);
    try {
      let res;
      const files = imageFiles
        ? Array.isArray(imageFiles) ? imageFiles : [imageFiles]
        : [];

      if (files.length > 0) {
        const fd = new FormData();
        Object.entries(data || {}).forEach(([k, v]) => {
          if (v !== undefined && v !== null) fd.append(k, String(v));
        });
        files.forEach(f => fd.append('images', f));
        res = await fetch(`${API_URL}/api/reports`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
        });
      } else {
        res = await fetch(`${API_URL}/api/reports`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(data),
        });
      }

      if (!res.ok) throw new Error((await res.json()).error || 'Failed to create');
      const created = await res.json();
      const fetchRes = await fetch(`${API_URL}/api/reports`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (fetchRes.ok) setReports(await fetchRes.json());
      return created;
    } finally {
      setLoading(false);
    }
  }, [token]);

  const updateStatus = useCallback(async (id, status) => {
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/reports/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ status })
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to update');
      const fetchRes = await fetch(`${API_URL}/api/reports`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (fetchRes.ok) setReports(await fetchRes.json());
    } finally {
      setLoading(false);
    }
  }, [token]);

  return { reports, loading, createReport, updateStatus, setReports };
};