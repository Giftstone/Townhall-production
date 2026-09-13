// client/src/pages/ReportDetail.jsx
import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { useAuth } from '../hooks/useAuth';
import NotificationBell from '../components/NotificationBell';
import {
  IconBuilding,
  IconLogout,
  IconMapPin,
  IconReport,
  IconSpinner,
} from '../components/Icons';
import { API_URL } from '../config';

export default function ReportDetail() {
  const { id } = useParams();
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [report, setReport]       = useState(null);
  const [error, setError]         = useState('');
  const [loading, setLoading]     = useState(true);
  const [responses, setResponses] = useState([]);
  const [meta, setMeta]           = useState(null);
  const [message, setMessage]     = useState('');
  const [posting, setPosting]     = useState(false);

  const token = localStorage.getItem('accessToken');
  const canManage = user?.role === 'administrator' || user?.role === 'responder';

  useEffect(() => {
    setLoading(true);
    fetch(`${API_URL}/api/reports/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'Not found');
        setReport(data);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id, token]);

  const fetchResponses = useCallback(() => {
    fetch(`${API_URL}/api/responses/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok) throw new Error(data.error);
        setResponses(data.responses || []);
        setMeta(data.meta || null);
      })
      .catch(() => {});
  }, [id, token]);

  useEffect(() => {
    fetchResponses();
  }, [fetchResponses]);

  const hasCoords =
    report &&
    report.latitude != null &&
    report.longitude != null &&
    !Number.isNaN(Number(report.latitude));

  const updateStatus = async (status) => {
    try {
      const res = await fetch(`${API_URL}/api/reports/${id}/status`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Update failed');
      setReport((prev) => ({ ...prev, ...data }));
      toast.success('Status updated');
    } catch (err) {
      toast.error(err.message);
    }
  };

  const postResponse = async () => {
    if (!message.trim()) return;
    setPosting(true);
    try {
      const res = await fetch(`${API_URL}/api/responses/${id}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to post');
      setMessage('');
      fetchResponses();
      toast.success('Response posted');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setPosting(false);
    }
  };

  const deleteResponse = async (responseId) => {
    try {
      const res = await fetch(`${API_URL}/api/responses/${responseId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Delete failed');
      fetchResponses();
      toast.success('Response deleted');
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="dashboard-container">
      <header className="dash-header">
        <h1 className="dash-title">
          <span className="brand-icon brand-icon-inline" aria-hidden="true">
            <IconBuilding size={20} />
          </span>
          Incident detail
        </h1>
        <div className="user-info">
          <NotificationBell />
          <span>{user?.email}</span>
          <span className={`role-badge ${user?.role}`}>{user?.role}</span>
          <Link to="/dashboard" className="btn-secondary btn-with-icon">
            Dashboard
          </Link>
          <button
            type="button"
            className="btn-secondary btn-with-icon"
            onClick={() =>
              navigate(`/forgot-password?email=${encodeURIComponent(user?.email || '')}`)
            }
          >
            Change password
          </button>
          <button
            type="button"
            className="btn-secondary btn-with-icon"
            onClick={() => { logout(); navigate('/login'); }}
          >
            <IconLogout size={16} /> Logout
          </button>
        </div>
      </header>

      <main className="dash-grid">
        {/* ── Report details ── */}
        <div className="panel">
          {loading && (
            <p style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <IconSpinner size={16} /> Loading…
            </p>
          )}
          {error && <p className="field-error">{error}</p>}

          {report && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                <h2 className="panel-title" style={{ margin: 0 }}>
                  <IconReport size={20} /> {report.title}
                </h2>
                <span className={`status-pill ${report.status}`}>{report.status}</span>
              </div>

              {/* 72-hour overdue banner */}
              {meta?.isOverdue && (
                <div style={{
                  marginTop: 12,
                  padding: '10px 14px',
                  borderRadius: 8,
                  background: 'rgba(226,75,74,0.1)',
                  border: '1px solid var(--red)',
                  color: 'var(--red)',
                  fontSize: 13,
                }}>
                  ⚠ No official response after {meta.hoursElapsed} hours — this report is overdue.
                </div>
              )}

              {/* 72-hour countdown (not overdue yet, no responses) */}
              {meta && !meta.isOverdue && responses.length === 0 && report.status !== 'resolved' && (
                <div style={{
                  marginTop: 12,
                  padding: '10px 14px',
                  borderRadius: 8,
                  background: 'rgba(200,169,126,0.08)',
                  border: '1px solid var(--accent-dim)',
                  color: 'var(--accent)',
                  fontSize: 13,
                }}>
                  🕐 {Math.max(0, 72 - meta.hoursElapsed)}h remaining for an official response.
                </div>
              )}

              <p style={{ marginTop: 12, color: 'var(--muted)' }}>{report.description}</p>

              {(() => {
                const urls = Array.isArray(report.image_urls) && report.image_urls.length
                  ? report.image_urls
                  : report.image_url
                    ? [report.image_url]
                    : [];
                if (!urls.length) return null;
                return (
                  <div style={{ marginTop: 16 }}>
                    <h3 className="panel-title" style={{ fontSize: 16 }}>
                      Evidence photo{urls.length > 1 ? 's' : ''}
                    </h3>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 8 }}>
                      {urls.map((src, i) => (
                        <img
                          key={i}
                          src={`${API_URL}${src}`}
                          alt={`Report evidence ${i + 1}`}
                          style={{
                            maxWidth: urls.length === 1 ? '100%' : 280,
                            maxHeight: 320,
                            borderRadius: 12,
                            border: '1px solid var(--border)',
                            objectFit: 'cover',
                          }}
                        />
                      ))}
                    </div>
                  </div>
                );
              })()}

              <ul style={{ marginTop: 12, paddingLeft: 18, lineHeight: 1.7 }}>
                <li><strong>Category:</strong> {report.category}</li>
                <li><strong>Address:</strong> {report.location || '—'}</li>
                <li><strong>Reporter:</strong> {report.reporter_name || 'Citizen'}</li>
                {report.assignee_name && (
                  <li><strong>Assigned:</strong> {report.assignee_name}</li>
                )}
                {hasCoords && (
                  <li>
                    <strong>Coordinates:</strong> {Number(report.latitude).toFixed(5)},{' '}
                    {Number(report.longitude).toFixed(5)}
                  </li>
                )}
              </ul>

              {canManage && (
                <div className="status-actions" style={{ marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button type="button" className="btn-secondary" onClick={() => updateStatus('pending')}>Pending</button>
                  <button type="button" className="btn-secondary" onClick={() => updateStatus('assigned')}>Assigned</button>
                  <button type="button" className="btn-secondary" onClick={() => updateStatus('in_progress')}>In progress</button>
                  <button type="button" className="btn-primary" style={{ width: 'auto' }} onClick={() => updateStatus('resolved')}>Resolved</button>
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Map ── */}
        {report && (
          <div className="panel">
            <h2 className="panel-title">
              <IconMapPin size={20} /> Site location
            </h2>
            {hasCoords ? (
              <MapContainer
                center={[Number(report.latitude), Number(report.longitude)]}
                zoom={15}
                style={{ height: 400, width: '100%', borderRadius: 12 }}
                scrollWheelZoom
              >
                <TileLayer
                  attribution="&copy; OpenStreetMap"
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <Marker position={[Number(report.latitude), Number(report.longitude)]}>
                  <Popup>{report.title}</Popup>
                </Marker>
              </MapContainer>
            ) : (
              <p className="muted">No map coordinates for this incident.</p>
            )}
          </div>
        )}

        {/* ── Official responses ── */}
        {report && (
          <div className="panel" style={{ gridColumn: '1 / -1' }}>
            <h2 className="panel-title">Official responses</h2>

            {responses.length === 0 ? (
              <p style={{ color: 'var(--muted)', fontSize: 14 }}>No official responses yet.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
                {responses.map((r) => (
                  <div key={r.id} style={{
                    padding: '14px 16px',
                    borderRadius: 10,
                    background: 'var(--surface2)',
                    border: '1px solid var(--border)',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--accent)' }}>
                        {r.author_name} · <span style={{ color: 'var(--muted)', textTransform: 'capitalize' }}>{r.author_role}</span>
                      </span>
                      <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                        {new Date(r.created_at).toLocaleString()}
                      </span>
                    </div>
                    <p style={{ fontSize: 14, lineHeight: 1.6, margin: 0 }}>{r.message}</p>
                    {user?.role === 'administrator' && (
                      <button
                        type="button"
                        onClick={() => deleteResponse(r.id)}
                        style={{ marginTop: 8, fontSize: 12, color: 'var(--red)', background: 'none', border: 'none', cursor: 'pointer' }}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Post response — responders and admins only */}
            {canManage && (
              <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Write an official response..."
                  rows={3}
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    borderRadius: 10,
                    border: '1px solid var(--border)',
                    background: 'var(--surface2)',
                    color: 'var(--text)',
                    fontSize: 14,
                    fontFamily: 'inherit',
                    resize: 'vertical',
                    outline: 'none',
                  }}
                />
                <button
                  type="button"
                  className="btn-primary"
                  style={{ width: 'auto', alignSelf: 'flex-end' }}
                  onClick={postResponse}
                  disabled={posting || !message.trim()}
                >
                  {posting ? 'Posting...' : 'Post response'}
                </button>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}