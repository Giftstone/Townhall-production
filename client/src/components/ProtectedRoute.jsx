import { useContext } from 'react';
import { Navigate } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';

const ProtectedRoute = ({ children, requiredRole }) => {
  const { user, token, loading } = useContext(AuthContext);

  // Still verifying session — show loading, do NOT bounce to login yet
  if (loading) {
    return (
      <div className="loading-screen" style={{ padding: '2rem', textAlign: 'center' }}>
        Loading…
      </div>
    );
  }

  // No token and no user → truly logged out
  if (!user && !token) {
    return <Navigate to="/login" replace />;
  }

  // Token exists but user not hydrated yet (rare race) — wait instead of logout
  if (!user && token) {
    return (
      <div className="loading-screen" style={{ padding: '2rem', textAlign: 'center' }}>
        Restoring session…
      </div>
    );
  }

  if (requiredRole && user.role !== requiredRole) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
};

export default ProtectedRoute;
