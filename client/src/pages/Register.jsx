// client/src/pages/Register.jsx
import { useState } from 'react';
import toast from 'react-hot-toast';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { IconBuilding, IconUserPlus, IconSpinner } from '../components/Icons';

function Register() {
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const { register, loading } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    try {
      // All public signups are citizens — role is not user-selectable
      await register(form.name, form.email, form.password, 'citizen');
      navigate('/login');
      toast.success('Registration successful!');
    } catch (err) {
      toast.error(err.message || 'Registration Failed');
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
          <p>Create your citizen account</p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Name</label>
            <input
              type="text"
              placeholder="Alex Smith"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
            />
          </div>

          <div className="form-group">
            <label>Email</label>
            <input
              type="email"
              placeholder="you@example.com"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
            />
          </div>

          <div className="form-group">
            <label>Password</label>
            <input
              type="password"
              placeholder="Min. 8 characters"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              required
              minLength={8}
            />
          </div>

          {error && <p className="field-error">{error}</p>}

          <button className="btn-primary btn-with-icon" type="submit" disabled={loading}>
            {loading ? (
              <>
                <IconSpinner size={16} /> Creating account...
              </>
            ) : (
              <>
                <IconUserPlus size={16} /> Create account
              </>
            )}
          </button>
        </form>

        <p className="auth-switch">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}

export default Register;
