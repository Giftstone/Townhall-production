import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { useAuth } from '../hooks/useAuth';
import { useReports } from '../hooks/useReports';
import AdminAnalytics from '../components/AdminAnalytics';
import NotificationBell from '../components/NotificationBell';
import './Dashboard.css';
import { API_URL } from '../config';


export default function Admin() {
  const { user } = useAuth();
  const { reports } = useReports();
  const navigate = useNavigate();
  const [analytics, setAnalytics] = useState({ byStatus: [], byCategory: [], priorities: [], recent: [] });
  const [users, setUsers] = useState([]);

  const headers = () => ({
    Authorization: `Bearer ${localStorage.getItem('accessToken')}`,
    'Content-Type': 'application/json',
  });

  useEffect(() => {
    Promise.all([
      fetch(`${API_URL}/api/admin/stats`, { headers: headers() }).then((r) => r.json()),
      fetch(`${API_URL}/api/admin/users`, { headers: headers() }).then((r) => r.json()),
    ])
      .then(([a, u]) => {
        if (a.error) throw new Error(a.error);
        setAnalytics(a);
        setUsers(Array.isArray(u) ? u : []);
      })
      .catch((err) => toast.error(err.message));
  }, []);

  const openMatching = (predicate) => {
    const matches = reports.filter(predicate);
    const withCoords = matches.filter((r) => r.latitude != null);
    const target = withCoords[0] || matches[0];
    if (target) navigate(`/reports/${target.id}`);
    else toast('No matching incidents');
  };

  const changeRole = async (id, role) => {
    try {
      const res = await fetch(`${API_URL}/api/admin/users/${id}/role`, {
        method: 'PATCH',
        headers: headers(),
        body: JSON.stringify({ role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setUsers((prev) => prev.map((x) => (x.id === id ? { ...x, role: data.role } : x)));
      toast.success('Role updated');
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="dash">
      <header className="dash-header">
        <div>
          <h1>Admin</h1>
          <p>{user?.name} · administrator only</p>
        </div>
        <nav>
          <NotificationBell />
          <Link to="/dashboard">Dashboard</Link>
        </nav>
      </header>

      <AdminAnalytics
        byStatus={analytics.byStatus}
        byCategory={analytics.byCategory}
        priorities={analytics.priorities}
        onStatusClick={(status) => openMatching((r) => r.status === status)}
        onCategoryClick={(category) =>
          openMatching((r) => (r.category || '').toLowerCase() === String(category).toLowerCase())
        }
        onPriorityClick={(row) =>
          openMatching((r) => (r.category || '').toLowerCase() === String(row?.category || '').toLowerCase())
        }
      />

      <section className="panel">
        <h2>Users</h2>
        <table className="admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Ward</th>
              <th>Role</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td>{u.email}</td>
                <td>{u.ward_name || '—'}</td>
                <td>
                  <select value={u.role} onChange={(e) => changeRole(u.id, e.target.value)}>
                    <option value="citizen">citizen</option>
                    <option value="responder">responder</option>
                    <option value="administrator">administrator</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
