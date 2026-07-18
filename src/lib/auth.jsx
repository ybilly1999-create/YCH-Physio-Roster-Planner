import { createContext, useContext, useState } from 'react';
const AuthCtx = createContext(null);
export function AuthProvider({ children }) {
  // NO localStorage (blocked in iframe) — token lives in React state only.
  const [token, setToken] = useState('');
  const [role, setRole] = useState(null); // 'admin' | 'staff' | null
  const login = (t) => {
    if (t === 'ychphysioadmin') { setToken(t); setRole('admin'); return 'admin'; }
    if (t === 'ychphysio')      { setToken(t); setRole('staff'); return 'staff'; }
    return null;
  };
  const logout = () => { setToken(''); setRole(null); };
  return <AuthCtx.Provider value={{ token, role, login, logout, isAdmin: role === 'admin' }}>{children}</AuthCtx.Provider>;
}
export const useAuth = () => useContext(AuthCtx);
