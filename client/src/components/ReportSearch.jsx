// client/src/components/ReportSearch.jsx
import { useState, useEffect, useRef } from 'react';

/**
 * ReportSearch – premium client‑side search for reports.
 * Props:
 *   reports: the full array of reports from the server
 *   setReports: the setter from useReports to update the displayed list
 */
export default function ReportSearch({ reports, setReports }) {
  const [query, setQuery] = useState('');
  const originalRef = useRef(reports);

  // Keep the original list up to date when new data arrives
  useEffect(() => {
    originalRef.current = reports;
    // Reset any active filter if the data set refreshed
    setQuery('');
    setReports(reports);
  }, [reports, setReports]);

  const handleChange = (e) => {
    const q = e.target.value;
    setQuery(q);
    if (!q) {
      setReports(originalRef.current);
      return;
    }
    const lower = q.toLowerCase();
    const filtered = originalRef.current.filter((r) => {
      return (
        (r.title && r.title.toLowerCase().includes(lower)) ||
        (r.description && r.description.toLowerCase().includes(lower)) ||
        (r.category && r.category.toLowerCase().includes(lower)) ||
        (r.status && r.status.toLowerCase().includes(lower)) ||
        (r.location && r.location.toLowerCase().includes(lower))
      );
    });
    setReports(filtered);
  };

  return (
    <div className="report-search" style={{ marginBottom: '1rem' }}>
      <input
        type="text"
        placeholder="Search reports…"
        value={query}
        onChange={handleChange}
        className="search-input"
        style={{
          width: '100%',
          padding: '0.5rem',
          borderRadius: '4px',
          border: '1px solid #ccc',
        }}
      />
    </div>
  );
}
