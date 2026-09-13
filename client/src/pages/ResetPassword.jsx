import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { IconBuilding, IconSpinner } from '../components/Icons';
import { API_URL } from '../config';


export default function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const initial = useMemo(
    () => ({
      email: params.get('email') || '',
      token: params.get('token') || '',
      code: '',
      password: '',
      confirm: '',
    }),
    [params]
  );
  const [form, setForm] = useState(initial);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (form.password !== form.confirm) {
      toast.error('Passwords do not match');
      return;
    }
    if (form.password.length < 8) {
      toast.error('Password must be at least 8 characters');
      return;
    }
    if (!form.token && !form.code) {
      toast.error('Enter the email code or open the reset link');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: form.email,
          token: form.token || undefined,
          code: form.code || undefined,
          password: form.password,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Reset failed');
      toast.success(data.message || 'Password updated');
      navigate('/login', { replace: true });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="brand">
          <div className="brand-icon" aria-hidden="true">
            <IconBuilding size={22} />
          </div>
          <h1>New password</h1>
          <p>Use the code from your email or reset using the link</p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Email</label>
            <input
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              autoComplete="email"
            />
          </div>
          {!form.token && (
            <div className="form-group">
              <label>6-digit code</label>
              <input
                inputMode="numeric"
                pattern="[0-9]{6}"
                placeholder="123456"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
              />
            </div>
          )}
          {form.token && (
            <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>
              Secure link token detected — enter a new password below.
            </p>
          )}
          <div className="form-group">
            <label>New password</label>
            <input
              type="password"
              required
              minLength={8}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              autoComplete="new-password"
            />
          </div>
          <div className="form-group">
            <label>Confirm password</label>
            <input
              type="password"
              required
              minLength={8}
              value={form.confirm}
              onChange={(e) => setForm({ ...form, confirm: e.target.value })}
              autoComplete="new-password"
            />
          </div>
          <button className="btn-primary btn-with-icon" type="submit" disabled={loading}>
            {loading ? (
              <>
                <IconSpinner size={16} /> Saving…
              </>
            ) : (
              'Update password'
            )}
          </button>
        </form>

        <p className="auth-switch">
          <Link to="/forgot-password">Request a new code</Link>
          {' · '}
          <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
