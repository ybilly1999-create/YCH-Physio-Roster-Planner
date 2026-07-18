import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { LogIn, AlertCircle } from 'lucide-react';

export default function Login() {
  const { login } = useAuth();
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    const result = login(token.trim());
    setBusy(false);
    if (!result) {
      setError('Token 錯誤 — Invalid token. 請重新輸入 Please try again.');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-bg">
      <div className="card w-full max-w-sm p-6" data-testid="card-login">
        <div className="flex flex-col items-center mb-6">
          <div className="w-14 h-14 rounded-xl bg-primary flex items-center justify-center text-white font-bold text-2xl mb-3">物</div>
          <h1 className="text-xl font-bold text-navy text-center">YCH Physio Dept 排更系統</h1>
          <p className="text-sm text-muted text-center mt-1">Roster Management System</p>
        </div>

        <form onSubmit={submit} className="space-y-4" data-testid="form-login">
          <div>
            <label htmlFor="token" className="block text-sm font-medium text-text mb-1">
              登入密碼 Token
            </label>
            <input
              id="token"
              type="password"
              className="input"
              placeholder="請輸入 Token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              data-testid="input-token"
              autoFocus
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 text-sm text-pink-700 bg-pink-50 border border-pink-200 rounded-lg p-2" data-testid="text-login-error">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <button type="submit" className="btn btn-primary w-full justify-center" disabled={busy || !token} data-testid="button-login">
            <LogIn size={16} /> 登入 Login
          </button>
        </form>

        <p className="text-xs text-muted text-center mt-5">
          管理員及員工均使用各自的 Token 登入。<br />
          Admin and staff each use their own token to sign in.
        </p>
      </div>
    </div>
  );
}
