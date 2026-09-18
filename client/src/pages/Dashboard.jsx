// client/src/pages/Dashboard.jsx
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useReports } from '../hooks/useReports';
import { usePolls } from '../hooks/usePolls';
import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import IncidentMap from '../components/IncidentMap';
import AdminAnalytics from '../components/AdminAnalytics';
import ReportSearch from '../components/ReportSearch';
import NotificationBell from '../components/NotificationBell';
import {
  IconBuilding,
  IconPoll,
  IconReport,
  IconUsers,
  IconMapPin,
  IconShield,
  IconChart,
  IconCheck,
  IconPlus,
  IconLogout,
  IconSpinner,
} from '../components/Icons';
import { API_URL } from '../config';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

// Fix for default marker icon issues with React-Leaflet
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
});

// --- Helper Component for Click-to-Pin Map ---
function LocationPicker({ form, setForm }) {
  useMapEvents({
    click(e) {
      const { lat, lng } = e.latlng;
      setForm({ ...form, latitude: lat, longitude: lng });
    },
  });

  return (form.latitude && form.longitude) ? (
    <Marker position={[form.latitude, form.longitude]}><Popup>Incident Location</Popup></Marker>
  ) : null;
}

export default function Dashboard() {
  const { user, token, logout, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { reports, loading: repLoading, createReport, updateStatus, setReports } = useReports(token);
  const { polls, loading: pollLoading, createPoll, castVote } = usePolls(token);

  // ── Search fix: separate display state so search never corrupts source ──
  const [displayedReports, setDisplayedReports] = useState([]);
  useEffect(() => {
    setDisplayedReports(Array.isArray(reports) ? reports : []);
  }, [reports]);

  // Hooks must run every render — never put useEffect after a conditional return
  useEffect(() => {
    if (!authLoading && !user && !token) {
      navigate('/login', { replace: true });
    }
  }, [authLoading, user, token, navigate]);

  if (authLoading || (!user && token)) {
    return (
      <div className="loading-screen">
        <IconSpinner size={22} /> Loading…
      </div>
    );
  }

  if (!user) {
    return (
      <div className="loading-screen">
        <IconSpinner size={22} /> Redirecting to login…
      </div>
    );
  }

  const safeReports = displayedReports;
  const sourceReports = Array.isArray(reports) ? reports : [];
  const safePolls = Array.isArray(polls) ? polls : [];

  return (
    <div className="dashboard-container">
      <header className="dash-header">
        <h1 className="dash-title">
          <span className="brand-icon brand-icon-inline" aria-hidden="true">
            <IconBuilding size={20} />
          </span>
          Townhall Dashboard
        </h1>
        <div className="user-info">
          <NotificationBell />
          <span>{user.email}</span>
          <span className={`role-badge ${user.role}`}>{user.role}</span>
          <button
            type="button"
            className="btn-secondary btn-with-icon"
            onClick={() =>
              navigate(`/forgot-password?email=${encodeURIComponent(user.email || '')}`)
            }
            title="Email a reset code to change your password"
          >
            Change password
          </button>
          <button
            type="button"
            onClick={() => {
              logout();
              navigate('/login');
            }}
            className="btn-secondary btn-with-icon"
          >
            <IconLogout size={16} /> Logout
          </button>
        </div>
      </header>

      <main className="dash-grid">
        {/* Polls first */}
        <PollsPanel
          polls={safePolls}
          loading={pollLoading}
          createPoll={createPoll}
          castVote={castVote}
        />

        {/* Search gets SOURCE reports, writes to displayedReports */}
        <ReportSearch reports={sourceReports} setReports={setDisplayedReports} />

        {/* Role workspaces (forms / admin tools) */}
        {user.role === 'administrator' && (
          <AdminPanel
            reports={safeReports}
            loading={repLoading}
            updateStatus={updateStatus}
            setReports={setReports}
          />
        )}
        {user.role === 'responder' && (
          <ResponderPanel
            reports={safeReports}
            loading={repLoading}
            updateStatus={updateStatus}
          />
        )}
        {(user.role === 'citizen' ||
          !['administrator', 'responder'].includes(user.role)) && (
          <CitizenPanel
            reports={safeReports}
            loading={repLoading}
            createReport={createReport}
            createPoll={createPoll}
          />
        )}

        {/* Reports list last — click opens detail + map site */}
        <ReportsListPanel reports={safeReports} loading={repLoading} />
      </main>
    </div>
  );
}

// --- Shared: all-role report list (opens detail / site map) ---
function ReportsListPanel({ reports, loading }) {
  const navigate = useNavigate();
  return (
    <div className="panel">
      <h2 className="panel-title">
        <IconReport size={20} /> All reports
      </h2>
      <p className="muted" style={{ marginBottom: '0.75rem' }}>
        Click any report to open its detail view and map location.
      </p>
      {loading ? (
        <p>Loading…</p>
      ) : reports.length === 0 ? (
        <p className="muted">No reports yet.</p>
      ) : (
        <ul className="report-list">
          {reports.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className="report-hit"
                onClick={() => navigate(`/reports/${r.id}`)}
              >
                <div>
                  <strong>{r.title}</strong>
                  <span className={`status-pill ${r.status}`}>{r.status}</span>
                </div>
                <p>
                  {r.category} · {r.location || 'No address'} · {r.reporter_name || 'Citizen'}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// --- POLLS PANEL (With Options + optional images) ---
function PollsPanel({ polls, loading, createPoll, castVote }) {
  const [form, setForm] = useState({ category: 'roads', description: '', options: ['', ''] });
  const [pollImageFiles, setPollImageFiles] = useState([]);
  const [pollImagePreviews, setPollImagePreviews] = useState([]);

  const handleAddOption = () => setForm({ ...form, options: [...form.options, ''] });
  const handleOptionChange = (index, value) => {
    const newOptions = [...form.options];
    newOptions[index] = value;
    setForm({ ...form, options: newOptions });
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    const validOptions = form.options.filter(opt => opt.trim() !== '');
    if (validOptions.length < 2) return toast.error('Please provide at least 2 options');

    try {
      await createPoll(
        { ...form, options: validOptions },
        pollImageFiles.length ? pollImageFiles : undefined
      );
      toast.success('Poll proposed!');
      setForm({ category: 'roads', description: '', options: ['', ''] });
      pollImagePreviews.forEach((url) => {
        try { URL.revokeObjectURL(url); } catch (_) {}
      });
      setPollImageFiles([]);
      setPollImagePreviews([]);
    } catch (err) { toast.error(err.message); }
  };

  const handleVote = async (pollId, optionIndex) => {
    try {
      await castVote(pollId, optionIndex);
      toast.success('Vote cast!');
    } catch (err) { toast.error(err.message); }
  };

  return (
    <div className="panel">
      <h2 className="panel-title">
        <IconPoll size={20} /> Townhall Polls
      </h2>
      <form onSubmit={handleCreate} style={{ marginBottom: '1.5rem', padding: '1rem', background: '#f8fafc', borderRadius: '8px' }}>
        <div className="form-group">
          <label>Category</label>
          <select value={form.category} onChange={e => setForm({...form, category: e.target.value})}>
            <option value="healthcare">Healthcare</option><option value="education">Education</option>
            <option value="water">Water</option><option value="roads">Roads</option><option value="security">Security</option>
          </select>
        </div>
        <div className="form-group">
          <label>Description</label>
          <input placeholder="What should we vote on?" value={form.description} onChange={e => setForm({...form, description: e.target.value})} required />
        </div>
        <div className="form-group">
          <label>Voting Options</label>
          {form.options.map((opt, idx) => (
            <input key={idx} placeholder={`Option ${idx + 1}`} value={opt} onChange={e => handleOptionChange(idx, e.target.value)} style={{ marginBottom: '0.5rem' }} />
          ))}
          <button
            type="button"
            onClick={handleAddOption}
            className="btn-secondary btn-with-icon"
            style={{ fontSize: '0.8rem', padding: '0.25rem 0.5rem' }}
          >
            <IconPlus size={14} /> Add Option
          </button>
        </div>
        <div className="form-group">
          <label>Optional images (max 5)</label>
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => {
              const selected = Array.from(e.target.files || []);
              const valid = selected.filter((f) => {
                if (f.size > 5 * 1024 * 1024) {
                  toast.error(`${f.name} is larger than 5MB`);
                  return false;
                }
                return true;
              }).slice(0, 5);
              pollImagePreviews.forEach((url) => {
                try { URL.revokeObjectURL(url); } catch (_) {}
              });
              setPollImageFiles(valid);
              setPollImagePreviews(valid.map((f) => URL.createObjectURL(f)));
            }}
          />
          {pollImagePreviews.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
              {pollImagePreviews.map((src, i) => (
                <img
                  key={i}
                  src={src}
                  alt={`Poll preview ${i + 1}`}
                  style={{ width: 72, height: 72, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }}
                />
              ))}
            </div>
          )}
        </div>
        <button type="submit" className="btn-primary btn-with-icon">
          <IconPoll size={16} /> Propose Poll
        </button>
      </form>

      {loading ? <p>Loading...</p> : polls.length === 0 ? <p>No active polls.</p> : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}>
          {polls.map(p => (
            <div key={p.id} className="poll-card" style={{ padding: '1rem', border: '1px solid #eee', borderRadius: '8px' }}>
              <div className="poll-header">
                <strong>{p.category}</strong>
                <span>{p.total_votes} votes</span>
              </div>
              <p className="poll-desc">{p.description}</p>

              {Array.isArray(p.image_urls) && p.image_urls.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: '0.75rem' }}>
                  {p.image_urls.map((src, i) => (
                    <img
                      key={i}
                      src={`${API_URL}${src}`}
                      alt={`Poll image ${i + 1}`}
                      style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }}
                    />
                  ))}
                </div>
              )}

              {(() => {
                const options = p.options ?? [];
                const counts = p.option_counts ?? options.map(() => 0);
                const total = Number(p.total_votes) || counts.reduce((a, b) => a + b, 0);
                return (
                  <>
                    <div className="poll-results" style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', marginBottom: '0.75rem' }}>
                      {options.map((opt, idx) => {
                        const n = Number(counts[idx] || 0);
                        const pct = total > 0 ? Math.round((n / total) * 100) : 0;
                        return (
                          <div key={idx} className="poll-result-row">
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: 2 }}>
                              <span>{opt}</span>
                              <span style={{ color: 'var(--muted)' }}>{n} vote{n === 1 ? '' : 's'} ({pct}%)</span>
                            </div>
                            <div style={{ height: 8, background: 'var(--border, #e5e7eb)', borderRadius: 999, overflow: 'hidden' }}>
                              <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent, #c8a97e)', borderRadius: 999 }} />
                            </div>
                          </div>
                        );
                      })}
                      {options.length === 0 && (
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>No voting options available for this poll.</p>
                      )}
                    </div>
                    {p.has_voted ? (
                      <div style={{ background: '#d1fae5', color: '#065f46', padding: '0.5rem', borderRadius: '4px', textAlign: 'center' }}>
                        <IconCheck size={14} /> You voted for:{' '}
                        <strong>{options[p.voted_option] ?? `Option ${p.voted_option + 1}`}</strong>
                        <div style={{ fontSize: '0.75rem', marginTop: 4, opacity: 0.85 }}>Votes are anonymous — names are never shown.</div>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        {options.map((opt, idx) => (
                          <button key={idx} type="button" onClick={() => handleVote(p.id, idx)} className="poll-btn vote">
                            Vote: {opt}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- 🛡️ ADMIN PANEL (tabs: Overview | Reports | Users) ---

function AdminPanel({ reports, loading, updateStatus, setReports }) {
  const navigate = useNavigate();
  const [tab, setTab] = useState('overview');
  const [users, setUsers] = useState([]);
  const [responders, setResponders] = useState([]);
  const [wards, setWards] = useState([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [assigning, setAssigning] = useState({});
  const [pendingRole, setPendingRole] = useState({}); // userId -> role awaiting ward

  const openMatching = (predicate) => {
    const matches = reports.filter(predicate);
    const withCoords = matches.filter((r) => r.latitude != null && r.longitude != null);
    const target = withCoords[0] || matches[0];
    if (target) navigate(`/reports/${target.id}`);
    else toast('No matching incidents');
  };

  const authHeaders = () => ({
    Authorization: `Bearer ${localStorage.getItem('accessToken')}`,
    'Content-Type': 'application/json',
  });

  const loadUsers = async () => {
    setUsersLoading(true);
    try {
      const [uRes, rRes, wRes] = await Promise.all([
        fetch(`${API_URL}/api/admin/users`, { headers: authHeaders() }),
        fetch(`${API_URL}/api/admin/responders`, { headers: authHeaders() }),
        fetch(`${API_URL}/api/admin/wards`, { headers: authHeaders() }),
      ]);
      if (uRes.ok) setUsers(await uRes.json());
      if (rRes.ok) setResponders(await rRes.json());
      if (wRes.ok) setWards(await wRes.json());
    } catch {
      toast.error('Failed to load users');
    } finally {
      setUsersLoading(false);
    }
  };

  const switchTab = (t) => {
    setTab(t);
    if (t === 'users' || t === 'reports') loadUsers();
  };

  const changeRole = async (userId, role, wardId = null) => {
    try {
      const body = { role };
      if (role === 'responder') {
        if (!wardId) {
          setPendingRole((p) => ({ ...p, [userId]: role }));
          toast('Select a ward for this responder');
          return;
        }
        body.ward_id = Number(wardId);
      }
      const res = await fetch(`${API_URL}/api/admin/users/${userId}/role`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      const updated = await res.json();
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? { ...u, ...updated } : u)));
      setPendingRole((p) => {
        const n = { ...p };
        delete n[userId];
        return n;
      });
      const rRes = await fetch(`${API_URL}/api/admin/responders`, { headers: authHeaders() });
      if (rRes.ok) setResponders(await rRes.json());
      toast.success(`Role updated to ${role}`);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const changeWard = async (userId, wardId) => {
    if (!wardId) return;
    // If role change to responder is pending, complete it with this ward
    if (pendingRole[userId] === 'responder') {
      return changeRole(userId, 'responder', wardId);
    }
    try {
      const res = await fetch(`${API_URL}/api/admin/users/${userId}/ward`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ ward_id: Number(wardId) }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      const updated = await res.json();
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? { ...u, ...updated } : u)));
      const rRes = await fetch(`${API_URL}/api/admin/responders`, { headers: authHeaders() });
      if (rRes.ok) setResponders(await rRes.json());
      toast.success(`Ward updated${updated.ward_name ? ` to ${updated.ward_name}` : ''}`);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const assignReport = async (reportId, responderId) => {
    if (!responderId) return;
    setAssigning((a) => ({ ...a, [reportId]: true }));
    try {
      const res = await fetch(`${API_URL}/api/admin/reports/${reportId}/assign`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ responderId }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Assign failed');
      const updated = await res.json();
      if (setReports) {
        setReports((prev) => prev.map((r) => (r.id === updated.id ? { ...r, ...updated } : r)));
      }
      toast.success('Report assigned');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setAssigning((a) => ({ ...a, [reportId]: false }));
    }
  };

  const pending = reports.filter((r) => r.status === 'pending');
  const assigned = reports.filter((r) => r.status === 'assigned' || r.status === 'in_progress');
  const resolved = reports.filter((r) => r.status === 'resolved');

  return (
    <div className="panel">
      <h2 className="panel-title">
        <IconShield size={20} /> Administrator Controls
      </h2>

      <div className="admin-tabs">
        <button className={`admin-tab ${tab === 'overview' ? 'active' : ''}`} onClick={() => switchTab('overview')}>
          <IconChart size={16} /> Overview
        </button>
        <button className={`admin-tab ${tab === 'reports' ? 'active' : ''}`} onClick={() => switchTab('reports')}>
          <IconReport size={16} /> Reports ({reports.length})
        </button>
        <button className={`admin-tab ${tab === 'users' ? 'active' : ''}`} onClick={() => switchTab('users')}>
          <IconUsers size={16} /> Users
        </button>
      </div>

      {tab === 'overview' && (
        <>
          <AdminAnalytics
            onStatusClick={(status) => openMatching((r) => r.status === status)}
            onWardClick={(ward) =>
              openMatching(
                (r) =>
                  (r.ward_name || r.location || '')
                    .toLowerCase()
                    .includes(String(ward || '').toLowerCase())
              )
            }
          />
          <div style={{ marginTop: '1.5rem' }}>
            <h3 style={{ marginBottom: '0.75rem' }}>Quick stats</h3>
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
              <StatCard label="Pending" value={pending.length} color="#f59e0b" />
              <StatCard label="Assigned" value={assigned.length} color="#3b82f6" />
              <StatCard label="Resolved" value={resolved.length} color="#10b981" />
              <StatCard label="Total" value={reports.length} color="#8b5cf6" />
            </div>
          </div>
        </>
      )}

      {tab === 'reports' && (
        <div>
          {loading ? (
            <p>Loading reports…</p>
          ) : reports.length === 0 ? (
            <p>No reports yet.</p>
          ) : (
            reports.map((r) => (
              <div key={r.id} className="report-card-admin">
                <div
                  style={{ flex: 1, cursor: 'pointer' }}
                  onClick={() => navigate(`/reports/${r.id}`)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && navigate(`/reports/${r.id}`)}
                >
                  <strong>{r.title}</strong>
                  <div className="meta">
                    {r.category} · {r.reporter_name || 'Unknown'} ·{' '}
                    <span className={`status-pill ${r.status}`}>{r.status}</span>
                    {r.assignee_name && <> · Assigned to {r.assignee_name}</>}
                  </div>
                  <p style={{ fontSize: '13px', marginTop: '6px', color: 'var(--muted)' }}>
                    {r.description}
                  </p>

                  {(r.status === 'pending' || r.status === 'assigned') && (
                    <div className="assign-row">
                      <select
                        defaultValue=""
                        onChange={(e) => {
                          if (e.target.value) assignReport(r.id, e.target.value);
                        }}
                        disabled={!!assigning[r.id]}
                      >
                        <option value="">Assign to responder…</option>
                        {responders.map((resp) => (
                          <option key={resp.id} value={resp.id}>
                            {resp.name}
                          </option>
                        ))}
                      </select>
                      {r.status !== 'resolved' && (
                        <button
                          className="btn-primary"
                          style={{ width: 'auto', padding: '6px 12px', marginTop: 0 }}
                          onClick={async () => {
                            try {
                              await updateStatus(r.id, 'resolved');
                              toast.success('Marked resolved');
                            } catch (err) {
                              toast.error(err.message);
                            }
                          }}
                        >
                          Resolve
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'users' && (
        <div>
          {usersLoading ? (
            <p>Loading users…</p>
          ) : (
            <table className="admin-user-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Ward</th>
                  <th>Joined</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>{u.name}</td>
                    <td style={{ color: 'var(--muted)' }}>{u.email}</td>
                    <td>
                      <select
                        className="role-select"
                        value={pendingRole[u.id] || u.role}
                        onChange={(e) => changeRole(u.id, e.target.value, u.ward_id)}
                      >
                        <option value="citizen">citizen</option>
                        <option value="responder">responder</option>
                        <option value="administrator">administrator</option>
                      </select>
                    </td>
                    <td>
                      <select
                        className="role-select"
                        value={u.ward_id || ''}
                        onChange={(e) => changeWard(u.id, e.target.value)}
                        disabled={!(pendingRole[u.id] === 'responder' || u.role === 'responder' || u.role === 'administrator')}
                        title={pendingRole[u.id] === 'responder' ? 'Select ward to finish promoting to responder' : 'Assign ward'}
                      >
                        <option value="">— No ward —</option>
                        {wards.map((w) => (
                          <option key={w.id} value={w.id}>{w.name}</option>
                        ))}
                      </select>
                    </td>
                    <td style={{ color: 'var(--muted)', fontSize: '12px' }}>
                      {u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, color }) {
  return (
    <div
      style={{
        background: 'var(--surface2)',
        border: '1px solid var(--border)',
        borderRadius: '10px',
        padding: '12px 18px',
        minWidth: '100px',
      }}
    >
      <div style={{ fontSize: '22px', fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: '12px', color: 'var(--muted)', marginTop: '2px' }}>{label}</div>
    </div>
  );
}

// ---  RESPONDER PANEL (Accepts Pending Reports) ---
function ResponderPanel({ reports, loading, updateStatus }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const pending = reports.filter((r) => r.status === 'pending' || r.status === 'assigned');
  const [wardAnalytics, setWardAnalytics] = useState(null);
  const [analyticsError, setAnalyticsError] = useState('');
  const [selectedCategory, setSelectedCategory] = useState(null);

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
    fetch(`${API_URL}/api/dashboard/ward-analytics`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'Failed to load analytics');
        setWardAnalytics(data);
      })
      .catch((err) => setAnalyticsError(err.message));
  }, []);

  const chartData = (wardAnalytics?.byCategory || []).map((c) => ({
    name: c.category,
    count: c.count,
    reports: c.reports,
  }));

  return (
    <>
      <div className="panel">
        <h2 className="panel-title">
          <IconShield size={20} /> Responder Queue
          {user?.ward_name && (
            <span style={{ marginLeft: 10, fontSize: 13, color: 'var(--muted)', fontWeight: 400 }}>
              · {user.ward_name}
            </span>
          )}
        </h2>
        <h3 className="panel-title" style={{ marginBottom: '0.5rem' }}>
          <IconMapPin size={18} /> Incident Map
        </h3>
        <IncidentMap reports={reports} />
        {loading ? (
          <p>Loading...</p>
        ) : pending.length === 0 ? (
          <p>All caught up! No pending / assigned reports.</p>
        ) : (
          <ul style={{ marginTop: '1rem' }}>
            {pending.map((r) => (
              <li key={r.id}>
                <button type="button" className="report-hit" onClick={() => navigate(`/reports/${r.id}`)}>
                  <div>
                    <strong>{r.title}</strong> ({r.category})
                  </div>
                  <p>{r.description}</p>
                </button>
                {r.status === 'pending' && (
                  <button
                    type="button"
                    onClick={async (e) => {
                      e.stopPropagation();
                      try {
                        await updateStatus(r.id, 'assigned');
                        toast.success('Accepted report!');
                      } catch (err) {
                        toast.error(err.message);
                      }
                    }}
                    className="btn-primary btn-with-icon"
                    style={{ width: 'auto', marginTop: 8 }}
                  >
                    <IconCheck size={14} /> Accept & Assign
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="panel">
        <h2 className="panel-title">
          Ward Analytics
          {wardAnalytics?.ward_name && (
            <span style={{ marginLeft: 8, fontSize: 13, color: 'var(--muted)', fontWeight: 400 }}>
              · {wardAnalytics.ward_name} ({wardAnalytics.totalReports} reports)
            </span>
          )}
        </h2>
        {analyticsError && <p className="field-error">{analyticsError}</p>}
        {!analyticsError && !wardAnalytics && <p>Loading analytics…</p>}
        {wardAnalytics && chartData.length === 0 && (
          <p style={{ color: 'var(--muted)' }}>No reports in your ward yet.</p>
        )}
        {chartData.length > 0 && (
          <>
            <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>
              Click a bar to see the list of reports in that category.
            </p>
            <div style={{ width: '100%', height: 280 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={chartData}
                  margin={{ top: 8, right: 16, left: 0, bottom: 8 }}
                >
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar
                    dataKey="count"
                    fill="#3B5D3A"
                    cursor="pointer"
                    radius={[6, 6, 0, 0]}
                    onClick={(data) => {
                      // data.payload holds the full category object including reports[]
                      const payload = data?.payload || data;
                      if (payload && payload.name) {
                        setSelectedCategory(payload);
                      }
                    }}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Also allow clicking category labels as a fallback list */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
              {chartData.map((c) => (
                <button
                  key={c.name}
                  type="button"
                  onClick={() => setSelectedCategory(c)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 8,
                    border: selectedCategory?.name === c.name ? '2px solid #3B5D3A' : '1px solid var(--border)',
                    background: selectedCategory?.name === c.name ? 'rgba(59,93,58,0.12)' : 'var(--surface2)',
                    color: 'var(--text)',
                    cursor: 'pointer',
                    fontSize: 13,
                  }}
                >
                  {c.name}: <strong>{c.count}</strong>
                </button>
              ))}
            </div>

            {selectedCategory && (
              <div style={{ marginTop: 16 }}>
                <h3 className="panel-title" style={{ fontSize: 16 }}>
                  {selectedCategory.name} reports ({selectedCategory.count})
                  <button
                    type="button"
                    onClick={() => setSelectedCategory(null)}
                    style={{
                      marginLeft: 12,
                      fontSize: 12,
                      background: 'none',
                      border: 'none',
                      color: 'var(--muted)',
                      cursor: 'pointer',
                    }}
                  >
                    Clear
                  </button>
                </h3>
                <ul style={{ marginTop: 8 }}>
                  {(selectedCategory.reports || []).map((r) => (
                    <li key={r.id} style={{ marginBottom: 6 }}>
                      <button
                        type="button"
                        className="report-hit"
                        onClick={() => navigate(`/reports/${r.id}`)}
                      >
                        <strong>{r.title}</strong>
                        <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--muted)' }}>
                          {r.status} · {r.created_at ? new Date(r.created_at).toLocaleDateString() : ''}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

// --- 🗺️ Helper: fly map to new position when search result chosen ---
function MapFlyTo({ position }) {
  const map = useMapEvents({});
  if (position) map.flyTo(position, 13);
  return null;
}

// --- 🏠 CITIZEN PANEL (Click-to-Pin Map + Search) ---
function CitizenPanel({ reports, loading, createReport, createPoll }) {
  const navigate = useNavigate();
  const [form, setForm] = useState({ title: '', description: '', category: 'Infrastructure', location: '', latitude: null, longitude: null });
  const [coordInput, setCoordInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [flyTo, setFlyTo] = useState(null);
  const [locating, setLocating] = useState(false);
  const [attachPoll, setAttachPoll] = useState(false);
  const [pollOptions, setPollOptions] = useState(['Yes — this needs attention', 'No — not a priority']);
  const [imageFiles, setImageFiles] = useState([]);
  const [imagePreviews, setImagePreviews] = useState([]);

  const mapReportCategoryToPoll = (cat) => {
    const m = {
      Infrastructure: 'roads',
      Safety: 'security',
      Health: 'healthcare',
      Water: 'water',
      Education: 'education',
      Other: 'roads',
    };
    return m[cat] || 'roads';
  };

  // Zambia center
  const ZAMBIA_CENTER = [-13.1339, 27.8493];

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      toast.error('Geolocation not supported');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setForm((f) => ({ ...f, latitude: lat, longitude: lng }));
        setFlyTo([lat, lng]);
        setCoordInput(`${lat.toFixed(6)}, ${lng.toFixed(6)}`);
        toast.success('Location attached');
        setLocating(false);
      },
      () => {
        toast.error('Could not get location');
        setLocating(false);
      }
    );
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.latitude || !form.longitude) return toast.error('Please pin a location on the map first');
    if (attachPoll) {
      const valid = pollOptions.map((o) => o.trim()).filter(Boolean);
      if (valid.length < 2) return toast.error('Poll needs at least 2 options (or turn off "Add a poll")');
    }
    try {
      const created = await createReport(form, imageFiles.length ? imageFiles : undefined);
      if (attachPoll && createPoll) {
        const valid = pollOptions.map((o) => o.trim()).filter(Boolean);
        await createPoll({
          category: mapReportCategoryToPoll(form.category),
          description: `Community vote on report: ${form.title}`,
          options: valid,
          report_id: created?.id,
        });
        toast.success('Report submitted and community poll opened (anonymous votes).');
      } else {
        toast.success('Report submitted! Awaiting responder review.');
      }
      setForm({ title: '', description: '', category: 'Infrastructure', location: '', latitude: null, longitude: null });
      setCoordInput('');
      setFlyTo(null);
      setAttachPoll(false);
      setPollOptions(['Yes — this needs attention', 'No — not a priority']);
      imagePreviews.forEach((url) => {
        try { URL.revokeObjectURL(url); } catch (_) {}
      });
      setImageFiles([]);
      setImagePreviews([]);
    } catch (err) { toast.error(err.message); }
  };

  // Paste coordinates handler (e.g. "-15.4167, 28.2833")
  const handleCoordPaste = () => {
    const parts = coordInput.split(',').map(s => parseFloat(s.trim()));
    if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      const [lat, lng] = parts;
      setForm(f => ({ ...f, latitude: lat, longitude: lng }));
      setFlyTo([lat, lng]);
      toast.success('Location set from coordinates!');
    } else {
      toast.error('Invalid format. Use: latitude, longitude (e.g. -15.4167, 28.2833)');
    }
  };

  // Nominatim search within Zambia
  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setSearchResults([]);
    try {
      const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(searchQuery)}&countrycodes=zm&format=json&limit=5&addressdetails=1`;
      const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
      const data = await res.json();
      setSearchResults(data);
      if (data.length === 0) toast.error('No results found in Zambia. Try a different search.');
    } catch {
      toast.error('Search failed. Check your connection.');
    } finally {
      setSearching(false);
    }
  };

  const applySearchResult = (result) => {
    const lat = parseFloat(result.lat);
    const lng = parseFloat(result.lon);
    setForm(f => ({ ...f, latitude: lat, longitude: lng, location: result.display_name }));
    setFlyTo([lat, lng]);
    setSearchResults([]);
    setSearchQuery(result.display_name);
    toast.success('Location set from search!');
  };

  return (
    <div className="panel">
      <h2 className="panel-title">
        <IconReport size={20} /> Submit Incident Report
      </h2>
      <form onSubmit={handleSubmit} style={{ marginBottom: '1.5rem' }}>
        <div className="form-group">
          <label>Title</label>
          <input value={form.title} onChange={e => setForm({...form, title: e.target.value})} placeholder="Brief description of the incident" required />
        </div>
        <div className="form-group">
          <label>Category</label>
          <select value={form.category} onChange={e => setForm({...form, category: e.target.value})}>
            <option>Infrastructure</option><option>Safety</option><option>Health</option><option>Other</option>
          </select>
        </div>
        <div className="form-group">
          <label>Description</label>
          <textarea value={form.description} onChange={e => setForm({...form, description: e.target.value})} placeholder="Describe the incident in detail..." required />
        </div>

        {/* 🔍 LOCATION SEARCH */}
        <div className="form-group">
          <label className="label-with-icon">
            <IconMapPin size={14} /> Search location in Zambia
          </label>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleSearch())}
              placeholder="e.g. Lusaka, Kitwe, Ndola Market..."
              style={{ flex: 1 }}
            />
            <button
              type="button"
              onClick={handleSearch}
              className="btn-primary btn-with-icon"
              style={{ width: 'auto', padding: '0.75rem 1rem', whiteSpace: 'nowrap' }}
              disabled={searching}
            >
              {searching ? <IconSpinner size={14} /> : <IconMapPin size={14} />} Search
            </button>
          </div>
          {searchResults.length > 0 && (
            <ul style={{ border: '1px solid var(--border)', borderRadius: '8px', marginTop: '0.5rem', background: 'white', maxHeight: '180px', overflowY: 'auto', padding: 0 }}>
              {searchResults.map((r, i) => (
                <li key={i} onClick={() => applySearchResult(r)}
                  style={{ padding: '0.6rem 0.75rem', cursor: 'pointer', borderBottom: '1px solid var(--border)', fontSize: '0.85rem', transform: 'none', display: 'flex', gap: '0.4rem', alignItems: 'flex-start' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#eff6ff'}
                  onMouseLeave={e => e.currentTarget.style.background = 'white'}
                >
                  <IconMapPin size={14} /> <span>{r.display_name}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="form-group">
          <label className="label-with-icon">
            <IconReport size={14} /> Or paste coordinates{' '}
            <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(latitude, longitude)</span>
          </label>
          <div className="coord-row">
            <input
              value={coordInput}
              onChange={(e) => setCoordInput(e.target.value)}
              placeholder="e.g. -15.4167, 28.2833"
            />
            <button type="button" onClick={handleCoordPaste} className="btn-secondary btn-with-icon">
              <IconMapPin size={14} /> Set Pin
            </button>
            <button
              type="button"
              onClick={useMyLocation}
              className="btn-primary btn-with-icon btn-location"
              disabled={locating}
            >
              {locating ? <IconSpinner size={14} /> : <IconMapPin size={14} />}
              Use my location
            </button>
          </div>
        </div>

        <div className="form-group">
          <label className="label-with-icon">
            <IconMapPin size={14} /> Or click the map to pin the incident location
          </label>
          <MapContainer center={ZAMBIA_CENTER} zoom={6} style={{ height: '320px', width: '100%', borderRadius: '8px', border: '1px solid var(--border)' }}>
            <TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            <LocationPicker form={form} setForm={setForm} />
            {flyTo && <MapFlyTo position={flyTo} />}
          </MapContainer>
          {form.latitude
            ? (
              <p style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: '#10b981', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                <IconCheck size={14} /> Location pinned: {form.latitude.toFixed(5)}, {form.longitude.toFixed(5)}
              </p>
              )
            : <p style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>No location set yet — search, paste coordinates, or click the map.</p>
          }
        </div>

        <div className="form-group" style={{ borderTop: '1px solid var(--border)', paddingTop: '1rem', marginTop: '0.5rem' }}>
          <label className="label-with-icon">Optional photo evidence</label>
          <p className="muted" style={{ fontSize: '0.8rem', marginBottom: '0.5rem' }}>
            You can attach multiple photos (max 10, 5MB each) to document the incident.
          </p>
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={(e) => {
              const selected = Array.from(e.target.files || []);
              const valid = [];
              for (const file of selected) {
                if (file.size > 5 * 1024 * 1024) {
                  toast.error(`${file.name} is larger than 5MB and was skipped`);
                  continue;
                }
                valid.push(file);
              }
              const limited = valid.slice(0, 10);
              if (valid.length > 10) toast.error('Maximum 10 images — extra files were ignored');

              imagePreviews.forEach((url) => {
                try { URL.revokeObjectURL(url); } catch (_) {}
              });
              setImageFiles(limited);
              setImagePreviews(limited.map((f) => URL.createObjectURL(f)));
            }}
          />
          {imagePreviews.length > 0 && (
            <div style={{ marginTop: '0.75rem' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                {imagePreviews.map((src, i) => (
                  <div key={i} style={{ position: 'relative' }}>
                    <img
                      src={src}
                      alt={`Evidence preview ${i + 1}`}
                      style={{ width: 120, height: 120, objectFit: 'cover', borderRadius: 10, border: '1px solid var(--border)' }}
                    />
                    <button
                      type="button"
                      className="btn-secondary"
                      style={{ position: 'absolute', top: 4, right: 4, padding: '2px 6px', fontSize: 11 }}
                      onClick={() => {
                        try { URL.revokeObjectURL(imagePreviews[i]); } catch (_) {}
                        setImageFiles((prev) => prev.filter((_, idx) => idx !== i));
                        setImagePreviews((prev) => prev.filter((_, idx) => idx !== i));
                      }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="btn-secondary"
                style={{ marginTop: 8 }}
                onClick={() => {
                  imagePreviews.forEach((url) => {
                    try { URL.revokeObjectURL(url); } catch (_) {}
                  });
                  setImageFiles([]);
                  setImagePreviews([]);
                }}
              >
                Remove all photos
              </button>
            </div>
          )}
        </div>

        <div className="form-group" style={{ borderTop: '1px solid var(--border)', paddingTop: '1rem', marginTop: '0.5rem' }}>
          <label className="label-with-icon" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', textTransform: 'none', letterSpacing: 0 }}>
            <input
              type="checkbox"
              checked={attachPoll}
              onChange={(e) => setAttachPoll(e.target.checked)}
              style={{ width: 'auto' }}
            />
            Also open a community poll on this report (optional)
          </label>
          <p className="muted" style={{ fontSize: '0.8rem', marginTop: 4 }}>
            Not every report needs a poll. If enabled, residents can vote anonymously — names are never shown.
          </p>
          {attachPoll && (
            <div style={{ marginTop: '0.75rem' }}>
              <label>Poll options</label>
              {pollOptions.map((opt, idx) => (
                <input
                  key={idx}
                  value={opt}
                  onChange={(e) => {
                    const next = [...pollOptions];
                    next[idx] = e.target.value;
                    setPollOptions(next);
                  }}
                  placeholder={`Option ${idx + 1}`}
                  style={{ marginBottom: '0.5rem' }}
                />
              ))}
              <button
                type="button"
                className="btn-secondary btn-with-icon"
                style={{ fontSize: '0.8rem', padding: '0.25rem 0.5rem' }}
                onClick={() => setPollOptions((o) => [...o, ''])}
              >
                <IconPlus size={14} /> Add option
              </button>
            </div>
          )}
        </div>

        <button type="submit" className="btn-primary btn-with-icon">
          <IconReport size={16} /> Submit Report for Review
        </button>
      </form>

      <h3 className="panel-title">
        <IconReport size={18} /> My report history
      </h3>
      {loading ? <p>Loading...</p> : reports.length === 0 ? <p style={{ color: 'var(--text-muted)' }}>No reports submitted yet.</p> : (
        <ul className="report-list">
          {reports.map((r) => (
            <li key={r.id}>
              <button type="button" className="report-hit" onClick={() => navigate(`/reports/${r.id}`)}>
                <div>
                  <strong>{r.title}</strong>
                  <span className={`status-pill ${r.status}`}>{r.status}</span>
                </div>
                <p>
                  {r.category} · {new Date(r.created_at).toLocaleDateString()}
                </p>
              </button>
              <span style={{
                padding: '0.2rem 0.6rem', borderRadius: '9999px', fontSize: '0.75rem', fontWeight: 700,
                background: r.status === 'resolved' ? '#d1fae5' : r.status === 'assigned' ? '#dbeafe' : '#fef3c7',
                color: r.status === 'resolved' ? '#065f46' : r.status === 'assigned' ? '#1e40af' : '#92400e'
              }}>{r.status.toUpperCase()}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}