// client/src/pages/Login.jsx
import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import toast from 'react-hot-toast';
import { IconBuilding, IconLogin, IconSpinner } from '../components/Icons';

function Login() {
  const [form, setForm] = useState({ email: '', password: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(form.email, form.password);
      toast.success('Login successful!');
      navigate('/dashboard', { replace: true });
    } catch (err) {
      const message = err.message || 'Login failed';
      setError(message);
      toast.error(message);
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
          <h1>Townhall</h1>
          <p>Welcome back</p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Email</label>
            <input
              type="email"
              placeholder="youremail@example.com"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
              disabled={loading}
              autoComplete="email"
            />
          </div>

          <div className="form-group">
            <label>Password</label>
            <input
              type="password"
              placeholder="••••••••"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required
              disabled={loading}
              autoComplete="current-password"
            />
          </div>

          {error && <p className="field-error">{error}</p>}

          <button className="btn-primary btn-with-icon" type="submit" disabled={loading}>
            {loading ? (
              <>
                <IconSpinner size={16} /> Signing in...
              </>
            ) : (
              <>
                <IconLogin size={16} /> Sign in
              </>
            )}
          </button>
        </form>

        <p className="auth-switch">
          <Link to="/forgot-password">Forgot password?</Link>
        </p>
        <p className="auth-switch">
          Not Registered Yet? <Link to="/register">Register</Link>
        </p>
      </div>
    </div>
  );
}

export default Login;
