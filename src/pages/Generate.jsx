import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { getMeta, apiPost, apiGet } from '../lib/api';
import { CalendarPlus, Wand2, Dices, RefreshCw, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';

const MONTHS = [
  ['1', '一月 Jan'], ['2', '二月 Feb'], ['3', '三月 Mar'], ['4', '四月 Apr'],
  ['5', '五月 May'], ['6', '六月 Jun'], ['7', '七月 Jul'], ['8', '八月 Aug'],
  ['9', '九月 Sep'], ['10', '十月 Oct'], ['11', '十一月 Nov'], ['12', '十二月 Dec'],
];

// Sat/Sun starting team+sub choices
const START_TEAMS = ['A1','A2','B1','B2','C1','C2','D1','D2'];

function ResultBox({ result }) {
  if (!result) return null;
  return (
    <div className={`mt-3 text-sm p-3 rounded-lg card ${result.type === 'ok' ? 'text-green-700' : 'text-pink-700'}`} data-testid="generate-result">
      <div className="flex items-center gap-2">
        {result.type === 'ok' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
        <span>{result.text}</span>
      </div>
    </div>
  );
}

export default function Generate() {
  const { token } = useAuth();
  const now = new Date();
  const [years, setYears] = useState([now.getFullYear(), now.getFullYear() + 1]);

  const [newYear, setNewYear] = useState(now.getFullYear() + 1);
  const [genCalBusy, setGenCalBusy] = useState(false);
  const [genCalResult, setGenCalResult] = useState(null);

  const [rosterYear, setRosterYear] = useState(now.getFullYear());
  const [fromMonth, setFromMonth] = useState('1');
  const [toMonth, setToMonth] = useState('12');
  const [startTeam, setStartTeam] = useState(''); // '' = auto (default A1)
  const [startPh, setStartPh] = useState('');     // '' = auto (by PH order)
  const [phStaff, setPhStaff] = useState([]);     // [{abbr,name}] with a PH order
  const [genRosterBusy, setGenRosterBusy] = useState(false);
  const [genRosterResult, setGenRosterResult] = useState(null);

  const [phBusy, setPhBusy] = useState(false);
  const [phConfirmOpen, setPhConfirmOpen] = useState(false);
  const [phResult, setPhResult] = useState(null);

  const [rebuildBusy, setRebuildBusy] = useState(false);
  const [rebuildResult, setRebuildResult] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const meta = await getMeta();
        if (meta?.ok && Array.isArray(meta.years) && meta.years.length) setYears(meta.years);
      } catch { /* ignore */ }
      try {
        const st = await apiGet('getStaff');
        const rows = (st?.rows || st?.staff || []);
        const ph = rows
          .filter(s => Number(s.ph_order) > 0 && (s.active === 'Y' || s.active === undefined))
          .sort((a, b) => (Number(a.ph_order) || 999) - (Number(b.ph_order) || 999))
          .map(s => ({ abbr: s.abbr, name: s.name, ord: Number(s.ph_order) }));
        setPhStaff(ph);
      } catch { /* ignore */ }
    })();
  }, []);

  async function handleGenerateCalendar() {
    setGenCalBusy(true);
    setGenCalResult(null);
    try {
      const res = await apiPost('generateCalendar', { year: Number(newYear) }, token);
      setGenCalResult(res?.ok
        ? { type: 'ok', text: `已生成 ${newYear} 年度日曆框架 Calendar shell generated.` }
        : { type: 'error', text: res?.reason || res?.error || '生成失敗 Generation failed.' });
    } catch (e) {
      setGenCalResult({ type: 'error', text: e.message || '網絡錯誤 Network error' });
    } finally {
      setGenCalBusy(false);
    }
  }

  async function handleGenerateRoster() {
    setGenRosterBusy(true);
    setGenRosterResult(null);
    try {
      const res = await apiPost('generateRoster', {
        year: Number(rosterYear), fromMonth: Number(fromMonth), toMonth: Number(toMonth),
        ...(startTeam ? { startTeam } : {}),
        ...(startPh ? { startPh } : {}),
      }, token);
      if (res?.ok) {
        const filled = res.filled ?? res.filledCount ?? '—';
        const needAdmin = res.needAdmin ?? res.needAdminCount ?? '—';
        setGenRosterResult({ type: 'ok', text: `已填滿 ${filled} 天，需人手處理 ${needAdmin} 天。Filled ${filled} days, needs admin: ${needAdmin} days.` });
      } else {
        setGenRosterResult({ type: 'error', text: res?.reason || res?.error || '生成失敗 Generation failed.' });
      }
    } catch (e) {
      setGenRosterResult({ type: 'error', text: e.message || '網絡錯誤 Network error' });
    } finally {
      setGenRosterBusy(false);
    }
  }

  async function handleRandomizePH() {
    setPhConfirmOpen(false);
    setPhBusy(true);
    setPhResult(null);
    try {
      const res = await apiPost('randomizePH', {}, token);
      setPhResult(res?.ok
        ? { type: 'ok', text: `已重新排序 ${res.count ?? ''} 位員工的 PH 次序。PH order randomized for ${res.count ?? ''} staff.` }
        : { type: 'error', text: res?.reason || res?.error || '操作失敗 Failed.' });
    } catch (e) {
      setPhResult({ type: 'error', text: e.message || '網絡錯誤 Network error' });
    } finally {
      setPhBusy(false);
    }
  }

  async function handleRebuildOrders() {
    setRebuildBusy(true);
    setRebuildResult(null);
    try {
      const res = await apiPost('rebuildOrders', {}, token);
      setRebuildResult(res?.ok
        ? { type: 'ok', text: '已重建所有名單次序 Orders rebuilt successfully.' }
        : { type: 'error', text: res?.reason || res?.error || '操作失敗 Failed.' });
    } catch (e) {
      setRebuildResult({ type: 'error', text: e.message || '網絡錯誤 Network error' });
    } finally {
      setRebuildBusy(false);
    }
  }

  return (
    <div className="space-y-4" data-testid="page-generate">
      <div>
        <h1 className="text-xl font-bold text-navy">生成 Generate</h1>
        <p className="text-sm text-muted">管理員工具：生成日曆及排更 Admin tools to generate calendar shells and roster fills</p>
      </div>

      {/* Generate Calendar */}
      <div className="card p-4" data-testid="card-generate-calendar">
        <h2 className="text-sm font-bold text-navy flex items-center gap-2 mb-1"><CalendarPlus size={16} /> 生成新年度日曆 Generate Calendar Shell</h2>
        <p className="text-xs text-muted mb-3">為新的一年建立空白日曆框架（未排更）。Creates a blank calendar shell for a new year (no roster yet).</p>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="block text-xs text-muted mb-1">年度 Year</label>
            <input type="number" className="input w-32" value={newYear} onChange={e => setNewYear(e.target.value)} data-testid="input-new-year" />
          </div>
          <button className="btn btn-primary" onClick={handleGenerateCalendar} disabled={genCalBusy} data-testid="button-generate-calendar">
            {genCalBusy ? <Loader2 className="animate-spin" size={16} /> : <CalendarPlus size={16} />} 生成 Generate
          </button>
        </div>
        <ResultBox result={genCalResult} />
      </div>

      {/* Generate Roster */}
      <div className="card p-4" data-testid="card-generate-roster">
        <h2 className="text-sm font-bold text-navy flex items-center gap-2 mb-1"><Wand2 size={16} /> 生成排更（輪次自動填充） Generate Roster (Round-based Auto-fill)</h2>
        <p className="text-xs text-muted mb-3">依輪次規則自動填滿指定月份範圍的排更。Auto-fills the roster for the selected month range using the round engine.</p>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="block text-xs text-muted mb-1">年度 Year</label>
            <select className="input w-28" value={rosterYear} onChange={e => setRosterYear(Number(e.target.value))} data-testid="select-roster-year">
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">起始月 From</label>
            <select className="input w-36" value={fromMonth} onChange={e => setFromMonth(e.target.value)} data-testid="select-from-month">
              {MONTHS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">結束月 To</label>
            <select className="input w-36" value={toMonth} onChange={e => setToMonth(e.target.value)} data-testid="select-to-month">
              {MONTHS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">首個週末由哪隊 First Sat/Sun team</label>
            <select className="input w-40" value={startTeam} onChange={e => setStartTeam(e.target.value)} data-testid="select-start-team">
              <option value="">自動 Auto (A1)</option>
              {START_TEAMS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">首個 PH/RD/SH 由誰 First PH/RD/SH staff</label>
            <select className="input w-48" value={startPh} onChange={e => setStartPh(e.target.value)} data-testid="select-start-ph">
              <option value="">自動 Auto (按 PH order)</option>
              {phStaff.map(s => <option key={s.abbr} value={s.abbr}>{s.abbr}{s.name ? ` – ${s.name}` : ''}</option>)}
            </select>
          </div>
          <button className="btn btn-primary" onClick={handleGenerateRoster} disabled={genRosterBusy} data-testid="button-generate-roster">
            {genRosterBusy ? <Loader2 className="animate-spin" size={16} /> : <Wand2 size={16} />} 生成 Generate
          </button>
        </div>
        <ResultBox result={genRosterResult} />
      </div>

      {/* Randomize PH */}
      <div className="card p-4" data-testid="card-randomize-ph">
        <h2 className="text-sm font-bold text-navy flex items-center gap-2 mb-1"><Dices size={16} /> 重新排序公假次序 🎲 Randomize PH Order</h2>
        <p className="text-xs text-muted mb-3">隨機重新排列公眾假期輪值次序，並記錄變更日誌。Reshuffles the Public Holiday duty order and logs the change.</p>
        <button className="btn btn-ghost" onClick={() => setPhConfirmOpen(true)} disabled={phBusy} data-testid="button-randomize-ph">
          {phBusy ? <Loader2 className="animate-spin" size={16} /> : <Dices size={16} />} 隨機排序 Randomize
        </button>
        <ResultBox result={phResult} />
      </div>

      {/* Rebuild orders */}
      <div className="card p-4" data-testid="card-rebuild-orders">
        <h2 className="text-sm font-bold text-navy flex items-center gap-2 mb-1"><RefreshCw size={16} /> 重建次序 Rebuild Orders</h2>
        <p className="text-xs text-muted mb-3">依現有輪次資料重新計算所有名單（PH/病假/颱風/惡劣天氣）的次序。Recalculates ordering for all lists (PH/Sick/Typhoon/ExtremeWx) from current round data.</p>
        <button className="btn btn-ghost" onClick={handleRebuildOrders} disabled={rebuildBusy} data-testid="button-rebuild-orders">
          {rebuildBusy ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />} 重建 Rebuild
        </button>
        <ResultBox result={rebuildResult} />
      </div>

      {phConfirmOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={() => setPhConfirmOpen(false)}>
          <div className="card p-5 w-full max-w-sm" onClick={e => e.stopPropagation()} data-testid="dialog-confirm-randomize-ph">
            <h3 className="text-sm font-bold text-navy mb-2">確認重新排序？ Confirm Randomize?</h3>
            <p className="text-sm text-muted mb-4">此操作將重新排列所有 PH 輪值次序，且會被記錄。This will reshuffle all PH duty order and be logged.</p>
            <div className="flex gap-2">
              <button className="btn btn-ghost flex-1 justify-center" onClick={() => setPhConfirmOpen(false)} data-testid="button-cancel-randomize-ph">取消 Cancel</button>
              <button className="btn btn-primary flex-1 justify-center" onClick={handleRandomizePH} data-testid="button-confirm-randomize-ph">確認 Confirm</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
