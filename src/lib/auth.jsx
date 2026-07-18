import { createContext, useContext, useState } from 'react';
import { API_URL } from './config';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  // NO localStorage (blocked in iframe) — token + role live in React state only.
  const [token, setToken] = useState('');
  const [role, setRole] = useState(null); // 'admin' | 'staff' | null

  // Validate the token SERVER-SIDE so the real tokens never appear in the
  // (public) frontend source. The Apps Script checks it against Script Properties.
  const login = async (t) => {
    try {
      const res = await fetch(`${API_URL}?action=login&token=${encodeURIComponent(t)}`);
      const data = await res.json();
      if (data && data.ok && data.role) {
        setToken(t);
        setRole(data.role);
        return data.role;
      }
    } catch (e) {
      return { error: '無法連線後端 Cannot reach server' };
    }
    return null;
  };

  const logout = () => { setToken(''); setRole(null); };

  return (
    <AuthCtx.Provider value={{ token, role, login, logout, isAdmin: role === 'admin' }}>
      {children}
    </AuthCtx.Provider>
  );
}
export const useAuth = () => useContext(AuthCtx);
