import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { getCalendar, getStaff, apiPost } from '../lib/api';
import { Loader2, AlertTriangle, CheckCircle2, ArrowLeftRight, ShieldAlert } from 'lucide-react';

function pad(n) { return String(n).padStart(2, '0'); }
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function isWeekend(dateStr) {
  const d = new Date(dateStr);
  return d.getDay() === 0 || d.getDay() === 6;
}
function getIpdList(row) {
  const ipd = row?.IPD ?? row?.ipd ?? [];
  if (Array.isArray(ipd)) return ipd;
  if (typeof ipd === 'string') return ipd.split(',').map(s => s.trim()).filter(Boolean);
  return [];
}

export default function Swaps() {
  const { isAdmin, token } = useAuth();
  const [date, setDate] = useState(todayStr());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [dayRoster, setDayRoster] = useState([]);
  const [staff, setStaff] = useState([]);
  const [fromAbbr, setFromAbbr] = useState('');
  const [toAbbr, setToAbbr] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideBusy, setOverrideBusy] = useState(false);

  const weekendOnly = !isAdmin;
  const validDate = weekendOnly ? isWeekend(date) : true;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setResult(null);
    (async () => {
      try {
        const year = new Date(date).getFullYear();
        const [calRes, staffRes] = await Promise.all([getCalendar(year, date, date), getStaff()]);
        if (cancelled) return;
        if (!calRes?.ok || !staffRes?.ok) {
          setError('無法載入資料 Failed to load data');
          setLoading(false);
          return;
        }
        const row = (calRes.rows || [])[0];
        setDayRoster(getIpdList(row));
        setStaff(staffRes.rows || []);
        setFromAbbr('');
        setToAbbr('');
      } catch (e) {
        if (!cancelled) setError(e.message || '網絡錯誤 Network error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [date]);

  const activeStaff = staff.filter(s => {
    const v = s.Active ?? s.active ?? s['Dept Active'];
    return v === true || v === 'Y' || v === 'y' || v === 1;
  });

  async function submitSwap() {
    if (!fromAbbr || !toAbbr) return;
    setBusy(true);
    setResult(null);
    try {
      const year = new Date(date).getFullYear();
      const res = await apiPost('requestSwap', { year, date, fromAbbr, toAbbr }, token);
      if (res?.ok) {
        setResult({ type: 'ok', text: '換更成功，已即時生效。Swap approved and applied immediately.' });
      } else {
        setResult({ type: 'error', text: res?.reason ? `未符合規則：${res.reason}` : (res?.error || '換更失敗 Swap failed'), canOverride: isAdmin });
      }
    } catch (e) {
      setResult({ type: 'error', text: e.message || '網絡錯誤 Network error' });
    } finally {
      setBusy(false);
    }
  }

  async function forceOverride() {
    setOverrideBusy(true);
    try {
      const year = new Date(date).getFullYear();
      const res = await apiPost('forceOverride', { year, date, fromAbbr, toAbbr, action: 'swap' }, token);
      if (res?.ok) {
        setResult({ type: 'ok', text: '已強制覆核並套用換更。Force override applied.' });
        setOverrideOpen(false);
      } else {
        setResult({ type: 'error', text: res?.reason || res?.error || '覆核失敗 Override failed.' });
      }
    } catch (e) {
      setResult({ type: 'error', text: e.message || '網絡錯誤 Network error' });
    } finally {
      setOverrideBusy(false);
    }
  }

  return (
    <div className="space-y-4" data-testid="page-swaps">
      <div>
        <h1 className="text-xl font-bold text-navy">換更 Swaps</h1>
        <p className="text-sm text-muted">
          {weekendOnly ? '員工只可於週六/週日申請換更。Staff may only swap Sat/Sun shifts.' : '管理員可為任何日子申請或強制換更。Admin may request or force swaps on any day.'}
        </p>
      </div>

      <div className="card p-4 space-y-3">
        <div>
          <label className="block text-xs text-muted mb-1">日期 Date</label>
          <input type="date" className="input w-auto" value={date} onChange={e => setDate(e.target.value)} data-testid="input-swap-date" />
          {weekendOnly && !validDate && (
            <p className="text-xs text-pink-700 mt-1" data-testid="text-weekend-warning">員工只可選擇週六或週日。Staff may only select Saturday or Sunday.</p>
          )}
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-muted text-sm" data-testid="swaps-loading"><Loader2 className="animate-spin" size={16} /> 載入中... Loading...</div>
        )}

        {!loading && error && (
          <div className="flex items-center gap-2 text-pink-700 text-sm" data-testid="swaps-error"><AlertTriangle size={16} /> {error}</div>
        )}

        {!loading && !error && (
          <>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-muted mb-1">離開者 Leaving (from that day's roster)</label>
                <select className="input" value={fromAbbr} onChange={e => setFromAbbr(e.target.value)} disabled={!validDate} data-testid="select-from-abbr">
                  <option value="">請選擇 Select...</option>
                  {dayRoster.map((abbr, i) => <option key={i} value={abbr}>{abbr}</option>)}
                </select>
                {dayRoster.length === 0 && <p className="text-xs text-muted mt-1" data-testid="text-no-roster">此日期尚無排更人員。No roster staff on this date.</p>}
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">接替者 Taking over (active staff)</label>
                <select className="input" value={toAbbr} onChange={e => setToAbbr(e.target.value)} disabled={!validDate} data-testid="select-to-abbr">
                  <option value="">請選擇 Select...</option>
                  {activeStaff.map((s, i) => {
                    const abbr = s.Abbrev || s.abbr;
                    const name = s.Name || s.name;
                    return <option key={i} value={abbr}>{name} ({abbr})</option>;
                  })}
                </select>
              </div>
            </div>

            <button
              className="btn btn-primary w-full justify-center"
              onClick={submitSwap}
              disabled={busy || !validDate || !fromAbbr || !toAbbr}
              data-testid="button-submit-swap"
            >
              {busy ? <Loader2 className="animate-spin" size={16} /> : <ArrowLeftRight size={16} />} 申請並提交 Request &amp; Submit
            </button>
          </>
        )}

        {result && (
          <div className={`p-3 rounded-lg text-sm ${result.type === 'ok' ? 'text-green-700 bg-green-50' : 'text-pink-700 bg-pink-50'}`} data-testid="text-swap-result">
            <div className="flex items-center gap-2">
              {result.type === 'ok' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
              <span>{result.text}</span>
            </div>
            {result.canOverride && (
              <button className="btn btn-ghost mt-2 text-xs" onClick={() => setOverrideOpen(true)} data-testid="button-open-override">
                <ShieldAlert size={14} /> 管理員強制覆核 Admin Force Override
              </button>
            )}
          </div>
        )}
      </div>

      <p className="text-xs text-muted" data-testid="text-swap-log-note">
        所有換更申請及變更均會被記錄於變更日誌，供日後查核。All swap requests and changes are recorded in the change log for future audit.
      </p>

      {overrideOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={() => setOverrideOpen(false)}>
          <div className="card p-5 w-full max-w-sm" onClick={e => e.stopPropagation()} data-testid="dialog-force-override">
            <h3 className="text-sm font-bold text-red-600 flex items-center gap-2 mb-2"><ShieldAlert size={16} /> 強制覆核警告 Force Override Warning</h3>
            <p className="text-sm text-muted mb-4">此換更未符合排更規則。強制覆核將忽略驗證並直接套用，且會被記錄。請謹慎操作。This swap fails validation rules. Force override bypasses validation and applies immediately. This action is logged.</p>
            <div className="flex gap-2">
              <button className="btn btn-ghost flex-1 justify-center" onClick={() => setOverrideOpen(false)} data-testid="button-cancel-override">取消 Cancel</button>
              <button className="btn btn-primary flex-1 justify-center bg-red-600 hover:!bg-red-700" onClick={forceOverride} disabled={overrideBusy} data-testid="button-confirm-override">
                {overrideBusy ? <Loader2 className="animate-spin" size={14} /> : '強制覆核 Override'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
