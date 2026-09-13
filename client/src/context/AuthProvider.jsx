// client/src/context/AuthProvider.jsx
import { AuthContext } from './AuthContext';
import { useProvideAuth } from '../hooks/useAuth';

export const AuthProvider = ({ children }) => {
  const auth = useProvideAuth(); // Hook handles all state and effects

  return (
    <AuthContext.Provider value={auth}>
      {children}
    </AuthContext.Provider>
  );
};