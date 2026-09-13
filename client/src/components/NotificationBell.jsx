// client/src/components/NotificationBell.jsx
import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useNotifications } from '../hooks/useNotifications';
import { IconBell, notifIcon } from './Icons';

function timeAgo(iso) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// Extract report UUID from notification id: "report-<uuid>-<timestamp>"
function extractReportId(notifId = '') {
  const parts = notifId.split('-');
  // UUID is 5 parts joined by '-', sits between the leading "report" and trailing timestamp
  if (parts.length >= 7 && parts[0] === 'report') {
    return parts.slice(1, 6).join('-');
  }
  return null;
}

export default function NotificationBell() {
  const { notifications, unread, markAllRead, clearAll } = useNotifications();
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    const handler = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const toggle = () => {
    setOpen((o) => !o);
    if (!open) markAllRead();
  };

  const handleNotifClick = (n) => {
    // Try reportId field first, then extract from id
    const reportId = n.reportId || extractReportId(n.id);
    if (reportId) {
      setOpen(false);
      navigate(`/reports/${reportId}`);
    }
  };

  return (
    <div className="notif-bell" ref={panelRef}>
      <button className="notif-bell-btn" onClick={toggle} aria-label="Notifications">
        <IconBell size={18} />
        {unread > 0 && <span className="notif-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>

      {open && (
        <div className="notif-panel">
          <div className="notif-panel-header">
            <strong>Notifications</strong>
            {notifications.length > 0 && (
              <button className="notif-clear" onClick={clearAll}>
                Clear all
              </button>
            )}
          </div>

          <div className="notif-list">
            {notifications.length === 0 ? (
              <p className="notif-empty">No notifications yet</p>
            ) : (
              notifications.map((n) => {
                const reportId = n.reportId || extractReportId(n.id);
                const clickable = Boolean(reportId);
                return (
                  <div
                    key={n.id}
                    className={`notif-item${clickable ? ' notif-item--clickable' : ''}`}
                    onClick={() => clickable && handleNotifClick(n)}
                    role={clickable ? 'button' : undefined}
                    tabIndex={clickable ? 0 : undefined}
                    onKeyDown={(e) => e.key === 'Enter' && clickable && handleNotifClick(n)}
                  >
                    <span className="notif-icon">{notifIcon(n.type, 16)}</span>
                    <div className="notif-body">
                      <div className="notif-title">{n.title}</div>
                      <div className="notif-msg">{n.message}</div>
                      <div className="notif-time">{timeAgo(n.timestamp)}</div>
                    </div>
                    {clickable && (
                      <span className="notif-arrow">›</span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}