// client/src/pages/ReportDetail.jsx
import { useEffect, useState } from 'react';
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
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('accessToken');
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
  }, [id]);

  const canManage = user?.role === 'administrator' || user?.role === 'responder';
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
          Authorization: `Bearer ${localStorage.getItem('accessToken')}`,
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
            onClick={() => {
              logout();
              navigate('/login');
            }}
          >
            <IconLogout size={16} /> Logout
          </button>
        </div>
      </header>

      <main className="dash-grid">
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
              <p style={{ marginTop: 12, color: 'var(--muted)' }}>{report.description}</p>
              {report.image_url && (
                <div style={{ marginTop: 16 }}>
                  <h3 className="panel-title" style={{ fontSize: 16 }}>Evidence photo</h3>
                  <img
                    src={`${API_URL}${report.image_url}`}
                    alt="Report evidence"
                    style={{ maxWidth: '100%', maxHeight: 420, borderRadius: 12, border: '1px solid var(--border)', marginTop: 8 }}
                  />
                </div>
              )}
              <ul style={{ marginTop: 12, paddingLeft: 18, lineHeight: 1.7 }}>
                <li>
                  <strong>Category:</strong> {report.category}
                </li>
                <li>
                  <strong>Address:</strong> {report.location || '—'}
                </li>
                <li>
                  <strong>Reporter:</strong> {report.reporter_name || 'Citizen'}
                </li>
                {report.assignee_name && (
                  <li>
                    <strong>Assigned:</strong> {report.assignee_name}
                  </li>
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
                  <button type="button" className="btn-secondary" onClick={() => updateStatus('pending')}>
                    Pending
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => updateStatus('assigned')}>
                    Assigned
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => updateStatus('in_progress')}>
                    In progress
                  </button>
                  <button type="button" className="btn-primary" style={{ width: 'auto' }} onClick={() => updateStatus('resolved')}>
                    Resolved
                  </button>
                </div>
              )}
            </>
          )}
        </div>

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
      </main>
    </div>
  );
}
