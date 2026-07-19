import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { getCalendar, getStaff, apiPost } from '../lib/api';
import { Loader2, AlertTriangle, CheckCircle2, ArrowLeftRight, Repeat, Info } from 'lucide-react';

function pad(n) { return String(n).padStart(2, '0'); }
function thisYear() { return new Date().getFullYear(); }

// Non-blocking status reminder box (advisory only — never stops the action).
function StatusReminder({ res }) {
  if (!res) return null;
  const pass = res.wouldPass;
  const cls = res.type === 'error'
    ? 'text-pink-700 bg-pink-50'
    : pass ? 'text-green-700 bg-green-50' : 'text-amber-700 bg-amber-50';
  const Icon = res.type === 'error' ? AlertTriangle : pass ? CheckCircle2 : Info;
  return (
    <div className={`p-3 rounded-lg text-sm ${cls}`} data-testid="text-swap-result">
      <div className="flex items-start gap-2">
        <Icon size={16} className="mt-0.5 shrink-0" />
        <div className="space-y-1">
          <div>{res.text}</div>
          {res.detail && <div className="text-xs opacity-80 whitespace-pre-line">{res.detail}</div>}
        </div>
      </div>
    </div>
  );
}

export default function Swaps() {
  const { token } = useAuth();
  const [year, setYear] = useState(thisYear());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [cal, setCal] = useState([]);        // full year rows
  const [staff, setStaff] = useState([]);
  const [mode, setMode] = useState('swap');  // 'swap' (Sat/Sun) | 'replace' (PH/SH/RD)

  // Load full-year calendar + staff
  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null);
    (async () => {
      try {
        const from = `${year}-01-01`, to = `${year}-12-31`;
        const [calRes, staffRes] = await Promise.all([getCalendar(year, from, to), getStaff()]);
        if (cancelled) return;
        const rows = calRes?.ok ? (calRes.rows || calRes.calendar || []) : (Array.isArray(calRes) ? calRes : []);
        setCal(rows);
        setStaff(staffRes?.rows || staffRes?.staff || []);
      } catch (e) {
        if (!cancelled) setError(e.message || '網絡錯誤 Network error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [year]);

  const activeStaff = staff.filter(s => {
    const v = s.Active ?? s.active ?? s['Dept Active'];
    return v === true || v === 'Y' || v === 'y' || v === 1 || v === undefined;
  });
  const staffName = (abbr) => {
    const s = staff.find(x => (x.Abbrev || x.abbr) === abbr);
    return s ? (s.Name || s.name || abbr) : abbr;
  };

  const weekendRows = cal.filter(r => r.type === 'Sat' || r.type === 'Sun');
  const prsRows = cal.filter(r => r.type === 'PH' || r.type === 'SH' || r.type === 'RD');

  return (
    <div className="space-y-4" data-testid="page-swaps">
      <div>
        <h1 className="text-xl font-bold text-navy">換更 / 替更 Swap &amp; Replace</h1>
        <p className="text-sm text-muted">
          變更會即時套用，不會被阻擋；下方只顯示規則提示供參考。Changes apply immediately and are never blocked — the box below is an advisory reminder only.
        </p>
      </div>

      {/* Mode tabs */}
      <div className="flex gap-2">
        <button
          className={`btn ${mode === 'swap' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setMode('swap')} data-testid="tab-mode-swap">
          <ArrowLeftRight size={16} /> 週六/日換更 Sat/Sun Swap
        </button>
        <button
          className={`btn ${mode === 'replace' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setMode('replace')} data-testid="tab-mode-replace">
          <Repeat size={16} /> PH/SH/RD 替更 Replace
        </button>
      </div>

      <div className="flex items-center gap-2">
        <label className="text-xs text-muted">年份 Year</label>
        <select className="input w-28" value={year} onChange={e => setYear(Number(e.target.value))} data-testid="select-swap-year">
          {[thisYear() - 1, thisYear(), thisYear() + 1, thisYear() + 2].map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-muted text-sm" data-testid="swaps-loading"><Loader2 className="animate-spin" size={16} /> 載入中... Loading...</div>
      )}
      {!loading && error && (
        <div className="flex items-center gap-2 text-pink-700 text-sm" data-testid="swaps-error"><AlertTriangle size={16} /> {error}</div>
      )}

      {!loading && !error && mode === 'swap' && (
        <SwapPanel year={year} token={token} rows={weekendRows} staffName={staffName} />
      )}
      {!loading && !error && mode === 'replace' && (
        <ReplacePanel year={year} token={token} rows={prsRows} activeStaff={activeStaff} staffName={staffName} />
      )}

      <p className="text-xs text-muted" data-testid="text-swap-log-note">
        所有變更均記錄於變更日誌供查核。All changes are recorded in the change log for audit.
      </p>
    </div>
  );
}

// ---------------- Rule 1: Sat/Sun cross-date SWAP ----------------
function SwapPanel({ year, token, rows, staffName }) {
  const [date1, setDate1] = useState('');
  const [abbr1, setAbbr1] = useState('');
  const [date2, setDate2] = useState('');
  const [abbr2, setAbbr2] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);

  const row1 = rows.find(r => r.date === date1);
  const row2 = rows.find(r => r.date === date2);
  const list1 = row1?.ipd || [];
  const list2 = row2?.ipd || [];

  const canRun = date1 && abbr1 && date2 && abbr2 && !(date1 === date2 && abbr1 === abbr2);

  async function run(dryRun) {
    setBusy(true);
    if (!dryRun) setResult(null);
    try {
      const res = await apiPost('swapWeekend', { year, date1, abbr1, date2, abbr2, dryRun }, token);
      if (!res?.ok) {
        const box = { type: 'error', text: res?.error || '操作失敗 Failed', wouldPass: false };
        dryRun ? setPreview(box) : setResult(box);
        return;
      }
      const detail = [
        `${date1}: ${res.status1 || '—'}${res.fail1 ? ` (${res.fail1})` : ''}`,
        `${date2}: ${res.status2 || '—'}${res.fail2 ? ` (${res.fail2})` : ''}`,
        res.bothWeekend ? '' : '⚠ 其中一天並非週六/日 One date is not Sat/Sun.',
      ].filter(Boolean).join('\n');
      if (dryRun) {
        setPreview({ type: 'info', wouldPass: res.wouldPass, text: '預覽 Preview（未套用 not yet applied）', detail });
      } else {
        setResult({
          type: 'info', wouldPass: res.wouldPass,
          text: `已套用換更：${staffName(abbr1)} ⇄ ${staffName(abbr2)}。Swap applied.`,
          detail,
        });
        setPreview(null);
      }
    } catch (e) {
      const box = { type: 'error', text: e.message || '網絡錯誤', wouldPass: false };
      dryRun ? setPreview(box) : setResult(box);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-4 space-y-4">
      <p className="text-xs text-muted">選兩個週六/日更，並各選一位當值同事互換。Pick two Sat/Sun duties and one staff on each to exchange.</p>
      <div className="grid sm:grid-cols-2 gap-4">
        {/* Date 1 */}
        <div className="space-y-2">
          <label className="block text-xs text-muted">第一更 Duty 1（週六/日）</label>
          <select className="input" value={date1} onChange={e => { setDate1(e.target.value); setAbbr1(''); setPreview(null); }} data-testid="select-swap-date1">
            <option value="">請選擇日期 Select date...</option>
            {rows.map(r => <option key={r.date} value={r.date}>{r.date} ({r.type})</option>)}
          </select>
          <select className="input" value={abbr1} onChange={e => { setAbbr1(e.target.value); setPreview(null); }} disabled={!date1} data-testid="select-swap-abbr1">
            <option value="">當值同事 Staff on duty...</option>
            {list1.map((a, i) => <option key={i} value={a}>{a} – {staffName(a)}</option>)}
          </select>
        </div>
        {/* Date 2 */}
        <div className="space-y-2">
          <label className="block text-xs text-muted">第二更 Duty 2（週六/日）</label>
          <select className="input" value={date2} onChange={e => { setDate2(e.target.value); setAbbr2(''); setPreview(null); }} data-testid="select-swap-date2">
            <option value="">請選擇日期 Select date...</option>
            {rows.map(r => <option key={r.date} value={r.date}>{r.date} ({r.type})</option>)}
          </select>
          <select className="input" value={abbr2} onChange={e => { setAbbr2(e.target.value); setPreview(null); }} disabled={!date2} data-testid="select-swap-abbr2">
            <option value="">當值同事 Staff on duty...</option>
            {list2.map((a, i) => <option key={i} value={a}>{a} – {staffName(a)}</option>)}
          </select>
        </div>
      </div>

      <div className="flex gap-2">
        <button className="btn btn-ghost flex-1 justify-center" onClick={() => run(true)} disabled={busy || !canRun} data-testid="button-preview-swap">
          {busy ? <Loader2 className="animate-spin" size={16} /> : <Info size={16} />} 預覽提示 Preview
        </button>
        <button className="btn btn-primary flex-1 justify-center" onClick={() => run(false)} disabled={busy || !canRun} data-testid="button-submit-swap">
          {busy ? <Loader2 className="animate-spin" size={16} /> : <ArrowLeftRight size={16} />} 套用換更 Apply Swap
        </button>
      </div>

      <StatusReminder res={preview} />
      <StatusReminder res={result} />
    </div>
  );
}

// ---------------- Rule 2: PH/SH/RD direct REPLACE (override) ----------------
function ReplacePanel({ year, token, rows, activeStaff, staffName }) {
  const [date, setDate] = useState('');
  const [fromAbbr, setFromAbbr] = useState('');
  const [toAbbr, setToAbbr] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);

  const row = rows.find(r => r.date === date);
  const list = row?.ipd || [];
  const canRun = date && fromAbbr && toAbbr && fromAbbr !== toAbbr;

  async function run(dryRun) {
    setBusy(true);
    if (!dryRun) setResult(null);
    try {
      const res = await apiPost('replaceDuty', { year, date, fromAbbr, toAbbr, dryRun }, token);
      if (!res?.ok) {
        const box = { type: 'error', text: res?.error || '操作失敗 Failed', wouldPass: false };
        dryRun ? setPreview(box) : setResult(box);
        return;
      }
      const detail = `${date} (${row?.type || ''}): ${res.status || '—'}${res.fail ? ` (${res.fail})` : ''}`;
      if (dryRun) {
        setPreview({ type: 'info', wouldPass: res.wouldPass, text: '預覽 Preview（未套用 not yet applied）', detail });
      } else {
        setResult({
          type: 'info', wouldPass: res.wouldPass,
          text: `已替更（直接覆寫）：${staffName(fromAbbr)} → ${staffName(toAbbr)}。Replaced.`,
          detail,
        });
        setPreview(null);
      }
    } catch (e) {
      const box = { type: 'error', text: e.message || '網絡錯誤', wouldPass: false };
      dryRun ? setPreview(box) : setResult(box);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-4 space-y-4">
      <p className="text-xs text-muted">PH/SH/RD 為「替更」— 直接覆寫該日名單上的同事，不需對調。PH/SH/RD is a direct replace — override a name on that day's roster.</p>
      <div>
        <label className="block text-xs text-muted mb-1">日期 Date（PH/SH/RD）</label>
        <select className="input w-full sm:w-auto" value={date} onChange={e => { setDate(e.target.value); setFromAbbr(''); setPreview(null); }} data-testid="select-replace-date">
          <option value="">請選擇日期 Select date...</option>
          {rows.map(r => <option key={r.date} value={r.date}>{r.date} ({r.type})</option>)}
        </select>
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-muted mb-1">被替者 Replace (on roster)</label>
          <select className="input" value={fromAbbr} onChange={e => { setFromAbbr(e.target.value); setPreview(null); }} disabled={!date} data-testid="select-replace-from">
            <option value="">請選擇 Select...</option>
            {list.map((a, i) => <option key={i} value={a}>{a} – {staffName(a)}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-muted mb-1">替更者 With (any active staff)</label>
          <select className="input" value={toAbbr} onChange={e => { setToAbbr(e.target.value); setPreview(null); }} disabled={!date} data-testid="select-replace-to">
            <option value="">請選擇 Select...</option>
            {activeStaff.map((s, i) => {
              const abbr = s.Abbrev || s.abbr;
              return <option key={i} value={abbr}>{s.Name || s.name} ({abbr})</option>;
            })}
          </select>
        </div>
      </div>

      <div className="flex gap-2">
        <button className="btn btn-ghost flex-1 justify-center" onClick={() => run(true)} disabled={busy || !canRun} data-testid="button-preview-replace">
          {busy ? <Loader2 className="animate-spin" size={16} /> : <Info size={16} />} 預覽提示 Preview
        </button>
        <button className="btn btn-primary flex-1 justify-center" onClick={() => run(false)} disabled={busy || !canRun} data-testid="button-submit-replace">
          {busy ? <Loader2 className="animate-spin" size={16} /> : <Repeat size={16} />} 套用替更 Apply Replace
        </button>
      </div>

      <StatusReminder res={preview} />
      <StatusReminder res={result} />
    </div>
  );
}
