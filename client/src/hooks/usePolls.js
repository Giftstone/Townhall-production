// client/src/hooks/usePolls.js
import { useState, useEffect, useCallback } from 'react';
import { API_URL } from '../config';

// In useAuth.js, useReports.js, and usePolls.js

export const usePolls = (token) => {
  const [polls, setPolls] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    const fetchPolls = async () => {
      await new Promise(resolve => setTimeout(resolve, 0)); // Satisfy React Compiler
      if (!isMounted || !token) { setLoading(false); return; }
      
      setLoading(true);
      try {
        const res = await fetch(`${API_URL}/api/polls`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok && isMounted) {
          const data = await res.json();
          setPolls(Array.isArray(data) ? data : data.polls || []);
        }
      } catch (err) { console.error(err); } 
      finally { if (isMounted) setLoading(false); }
    };
    fetchPolls();
    return () => { isMounted = false; };
  }, [token]);

  const createPoll = useCallback(async (data) => {
    const res = await fetch(`${API_URL}/api/polls`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error((await res.json()).error);
    
    // Refresh polls list
    const fetchRes = await fetch(`${API_URL}/api/polls`, { headers: { Authorization: `Bearer ${token}` } });
    if (fetchRes.ok) setPolls(await fetchRes.json());
  }, [token]);

// Inside client/src/hooks/usePolls.js

// Updated the function to include options:
  const castVote = useCallback(async (pollId, optionIndex) => {
    const res = await fetch(`${API_URL}/api/polls/${pollId}/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ optionIndex }) // 
    });
    if (!res.ok) throw new Error((await res.json()).error);
    
    const fetchRes = await fetch(`${API_URL}/api/polls`, { headers: { Authorization: `Bearer ${token}` } });
    if (fetchRes.ok) setPolls(await fetchRes.json());
  }, [token]);

  return { polls, loading, createPoll, castVote };
};