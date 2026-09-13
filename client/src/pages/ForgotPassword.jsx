import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { IconBuilding, IconSpinner } from '../components/Icons';
import { API_URL } from '../config';


export default function ForgotPassword() {
  const [params] = useSearchParams();
  const [email, setEmail] = useState(params.get('email') || '');
  const [loading, setLoading] = useState(false);
  const [debug, setDebug] = useState(null);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setDebug(null);
    try {
      const res = await fetch(`${API_URL}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request failed');
      setSent(true);
      toast.success(data.message || 'Check your email');
      if (data.debug) setDebug(data.debug);
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
          <h1>Reset password</h1>
          <p>We’ll email a code and a secure link</p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Account email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
              autoComplete="email"
              placeholder="you@example.com"
            />
          </div>
          <button className="btn-primary btn-with-icon" type="submit" disabled={loading}>
            {loading ? (
              <>
                <IconSpinner size={16} /> Sending…
              </>
            ) : (
              'Send reset email'
            )}
          </button>
        </form>

        {sent && (
          <p className="auth-switch" style={{ marginTop: 16 }}>
            Check your inbox. Then{' '}
            <Link to={`/reset-password?email=${encodeURIComponent(email)}`}>
              enter the code
            </Link>
            .
          </p>
        )}

        {debug && (
          <div
            style={{
              marginTop: 16,
              padding: 12,
              borderRadius: 10,
              border: '1px solid var(--border)',
              background: 'var(--surface2)',
              fontSize: 13,
            }}
          >
            <strong>Dev debug (not shown in production)</strong>
            <p style={{ margin: '8px 0 4px' }}>{debug.hint}</p>
            {debug.code && (
              <p>
                Code: <code>{debug.code}</code>
              </p>
            )}
            {debug.resetLink && (
              <p style={{ wordBreak: 'break-all' }}>
                Link:{' '}
                <a href={debug.resetLink} style={{ color: 'var(--accent)' }}>
                  {debug.resetLink}
                </a>
              </p>
            )}
            {debug.previewUrl && (
              <p style={{ wordBreak: 'break-all' }}>
                Email preview:{' '}
                <a href={debug.previewUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>
                  {debug.previewUrl}
                </a>
              </p>
            )}
            {debug.mailError && (
              <p className="field-error">Mail error: {debug.mailError}</p>
            )}
          </div>
        )}

        <p className="auth-switch">
          <Link to="/login">Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}
