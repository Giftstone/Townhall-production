// client/src/components/ReportSearch.jsx
import { useState, useRef, useEffect } from 'react';

export default function ReportSearch({ reports, setReports }) {
  const [query, setQuery] = useState('');
  const originalRef = useRef(reports);

  // Update original ref when fresh data arrives but DON'T reset query
  useEffect(() => {
    originalRef.current = reports;
    // Re-apply current filter against fresh data
    if (query) {
      const lower = query.toLowerCase();
      const filtered = reports.filter((r) =>
        (r.title       && r.title.toLowerCase().includes(lower))       ||
        (r.description && r.description.toLowerCase().includes(lower)) ||
        (r.category    && r.category.toLowerCase().includes(lower))    ||
        (r.status      && r.status.toLowerCase().includes(lower))      ||
        (r.location    && r.location.toLowerCase().includes(lower))
      );
      setReports(filtered);
    } else {
      setReports(reports);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reports]);

  const handleChange = (e) => {
    const q = e.target.value;
    setQuery(q);
    if (!q) {
      setReports(originalRef.current);
      return;
    }
    const lower = q.toLowerCase();
    const filtered = originalRef.current.filter((r) =>
      (r.title       && r.title.toLowerCase().includes(lower))       ||
      (r.description && r.description.toLowerCase().includes(lower)) ||
      (r.category    && r.category.toLowerCase().includes(lower))    ||
      (r.status      && r.status.toLowerCase().includes(lower))      ||
      (r.location    && r.location.toLowerCase().includes(lower))
    );
    setReports(filtered);
  };

  return (
    <div style={{ marginBottom: '1rem' }}>
      <input
        type="text"
        placeholder="Search reports…"
        value={query}
        onChange={handleChange}
        style={{
          width: '100%',
          padding: '10px 14px',
          borderRadius: '10px',
          border: '1px solid var(--border)',
          background: 'var(--surface2)',
          color: 'var(--text)',
          fontSize: '14px',
          fontFamily: 'inherit',
          outline: 'none',
        }}
      />
    </div>
  );
}