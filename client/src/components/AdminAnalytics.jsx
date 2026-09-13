// client/src/components/AdminAnalytics.jsx
import './AdminAnalytics.css';
import { useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  PieChart, Pie, Cell, ResponsiveContainer
} from 'recharts';
import { IconUsers, IconReport, IconSpinner, IconMapPin } from './Icons';
import { API_URL } from '../config';

const COLORS = ['#c8a97e', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#06B6D4', '#F97316'];


export default function AdminAnalytics({ onStatusClick, onWardClick }) {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch(`${API_URL}/api/admin/stats`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('accessToken')}` },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setStats(await res.json());
      } catch (err) {
        console.error('[AdminAnalytics]', err);
        setError(err.message);
      }
    };
    fetchStats();
  }, []);

  if (error) return <p style={{ color: 'red' }}>Analytics error: {error}</p>;
  if (!stats) {
    return (
      <p style={{ color: '#64748b', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
        <IconSpinner size={16} /> Loading analytics…
      </p>
    );
  }

  const users = stats.users.map((r) => ({ ...r, count: Number(r.count) }));
  const reports = stats.reports.map((r) => ({ ...r, count: Number(r.count) }));
  const wards = (stats.wards || []).map((r) => ({
    ...r,
    report_count: Number(r.report_count),
  }));

  return (
    <div className="admin-analytics-grid">
      <div className="chart-wrapper">
        <h3 className="chart-title">
          <IconUsers size={16} /> Users by Role
        </h3>
        <ResponsiveContainer width="100%" height={280}>
          <PieChart>
            <Pie
              data={users}
              dataKey="count"
              nameKey="role"
              cx="50%"
              cy="50%"
              outerRadius={100}
              label={({ role, count }) => `${role}: ${count}`}
            >
              {users.map((_, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </div>

      <div className="chart-wrapper">
        <h3 className="chart-title">
          <IconReport size={16} /> Reports by Status
        </h3>
        <p className="chart-hint">Click a bar to open a matching incident</p>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={reports} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="status" tick={{ fontSize: 12 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
            <Tooltip />
            <Legend />
            <Bar
              dataKey="count"
              fill="#c8a97e"
              name="Reports"
              radius={[4, 4, 0, 0]}
              cursor="pointer"
              onClick={(entry) => onStatusClick && onStatusClick(entry?.status || entry?.payload?.status)}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="chart-wrapper chart-wrapper--full">
        <h3 className="chart-title">
          <IconMapPin size={16} /> Wards – Ranked by Reports
        </h3>
        <p className="chart-hint">Click a ward to open a related incident</p>
        {wards.length === 0 ? (
          <p style={{ color: '#64748b', textAlign: 'center', padding: '2rem' }}>
            No ward data yet — reports will appear here once locations are set.
          </p>
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(280, wards.length * 40)}>
            <BarChart layout="vertical" data={wards} margin={{ top: 10, right: 40, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
              <YAxis
                type="category"
                dataKey="ward"
                width={180}
                tick={{ fontSize: 11 }}
                tickFormatter={(v) => (v.length > 28 ? v.slice(0, 26) + '…' : v)}
              />
              <Tooltip formatter={(v) => [`${v} report${v !== 1 ? 's' : ''}`, 'Count']} />
              <Bar
                dataKey="report_count"
                name="Reports"
                radius={[0, 4, 4, 0]}
                cursor="pointer"
                onClick={(entry) => onWardClick && onWardClick(entry?.ward || entry?.payload?.ward)}
              >
                {wards.map((_, index) => (
                  <Cell key={`ward-cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
