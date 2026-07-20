import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../lib/auth';
import { getMeta, getCalendar, getRollcall, getStaff, apiPost } from '../lib/api';
import { COLORS } from '../lib/config';
import { ChevronLeft, ChevronRight, X, ShieldAlert, ArrowLeftRight, AlertTriangle, Loader2, Info, CheckCircle2, Repeat, Building2, Stethoscope } from 'lucide-react';

const MONTHS_TC = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
const WEEKDAYS_TC = ['日', '一', '二', '三', '四', '五', '六'];

function pad(n) { return String(n).padStart(2, '0'); }
function fmt(y, m, d) { return `${y}-${pad(m + 1)}-${pad(d)}`; }

function dayTypeBadge(row) {
  const t = (row?.Type || row?.type || row?.DayType || '').toString().toUpperCase();
  if (t.includes('PH')) return { label: 'PH', cls: 'bg-pink-100 text-pink-700' };
  if (t.includes('SH')) return { label: 'SH', cls: 'bg-orange-100 text-orange-700' };
  if (t.includes('RD')) return { label: 'RD', cls: 'bg-blue-100 text-blue-700' };
  if (t.includes('SUN')) return { label: 'Sun', cls: 'bg-slate-200 text-slate-700' };
  if (t.includes('SAT')) return { label: 'Sat', cls: 'bg-slate-200 text-slate-700' };
  return { label: '', cls: '' };
}

function getIpdList(row) {
  const ipd = row?.IPD ?? row?.ipd ?? [];
  if (Array.isArray(ipd)) return ipd;
  if (typeof ipd === 'string') return ipd.split(',').map(s => s.trim()).filter(Boolean);
  return [];
}
function getOpdList(row) {
  const opd = row?.OPD ?? row?.opd ?? [];
  if (Array.isArray(opd)) return opd;
  if (typeof opd === 'string') return opd.split(',').map(s => s.trim()).filter(Boolean);
  return [];
}
// SHS(1) and SHS(2) are two SEPARATE slots — never merged into one cell.
function getShsSlots(row) {
  const s1 = row?.shs1 ?? row?.SHS1 ?? '';
  const s2 = row?.shs2 ?? row?.SHS2 ?? '';
  if (s1 || s2) return [{ slot: 'SHS(1)', abbr: s1 }, { slot: 'SHS(2)', abbr: s2 }];
  // fallback: split legacy combined value
  let arr = row?.SHS ?? row?.shs ?? [];
  if (typeof arr === 'string') arr = arr.split(',').map(s => s.trim()).filter(Boolean);
  if (!Array.isArray(arr)) arr = arr ? [arr] : [];
  return [{ slot: 'SHS(1)', abbr: arr[0] || '' }, { slot: 'SHS(2)', abbr: arr[1] || '' }];
}
function getShsList(row) {
  return getShsSlots(row).map(x => x.abbr).filter(Boolean);
}

// Normalized accessors that work on both month rows and full-year rows.
function rowDate(row) { return String(row?.Date || row?.date || '').slice(0, 10); }
function rowType(row) { return String(row?.Type || row?.type || '').trim(); }
function rowShs1(row) { return String(row?.shs1 ?? row?.SHS1 ?? '').trim(); }
function rowShs2(row) { return String(row?.shs2 ?? row?.SHS2 ?? '').trim(); }
function rowOpd1(row) { const l = getOpdList(row); return l[0] || ''; }

// Rule mapping: a clicked staff's role on a date determines the swap/replace mode.
//   ipd + Sat/Sun  -> swapWeekend  (cross-date swap; both must be Sat/Sun)
//   opd + Sat      -> swapOpd      (Sat only; cross-date OPD exchange)
//   shs            -> replaceShs   (replace SHS(1)/SHS(2) on a date that has SHS)
//   prs (PH/SH/RD) -> replaceDuty  (direct override on that date)
function swapModeFor(role, dayType) {
  const t = String(dayType || '').toUpperCase();
  if (role === 'opd') return 'opd';
  if (role === 'shs') return 'shs';
  if (role === 'ipd' && (t === 'SAT' || t === 'SUN')) return 'weekend';
  if (t === 'PH' || t === 'SH' || t === 'RD') return 'prs';
  return null; // IPD on a weekday PH/SH/RD is handled as prs above; otherwise not swappable here
}

export default function CalendarPage() {
  const { isAdmin, token } = useAuth();
  const now = new Date();
  const [years, setYears] = useState([now.getFullYear()]);
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth()); // 0-11
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [rows, setRows] = useState([]);
  const [selectedDate, setSelectedDate] = useState(null);
  const [rollcall, setRollcall] = useState(null);
  const [rollcallLoading, setRollcallLoading] = useState(false);
  const [overrideBusy, setOverrideBusy] = useState(false);
  const [overrideMsg, setOverrideMsg] = useState(null);
  // Inline calendar swap: which staff on the selected date was clicked to start a swap.
  // { abbr, role: 'ipd'|'opd'|'shs'|'prs', slot: 1|2 (shs only), dayType }
  const [swapFrom, setSwapFrom] = useState(null);
  // Full-year calendar (all months) so we can filter a counterpart staff's own roster dates.
  const [yearRows, setYearRows] = useState([]);
  const [staff, setStaff] = useState([]);

  useEffect(() => {
    (async () => {
      try {
        const meta = await getMeta();
        if (meta?.ok && Array.isArray(meta.years) && meta.years.length) {
          setYears(meta.years);
        }
      } catch { /* ignore, fall back to current year */ }
    })();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const from = fmt(year, month, 1);
    const lastDay = new Date(year, month + 1, 0).getDate();
    const to = fmt(year, month, lastDay);
    (async () => {
      try {
        const res = await getCalendar(year, from, to);
        if (cancelled) return;
        if (!res?.ok) {
          setError('無法載入排更表 Failed to load calendar');
          setRows([]);
        } else {
          setRows(res.rows || []);
        }
      } catch (e) {
        if (!cancelled) { setError(e.message || '網絡錯誤 Network error'); setRows([]); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [year, month]);

  // Load the FULL year (all 12 months) + staff list once per year — used by the swap flow
  // to filter a counterpart staff's own roster dates.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [cal, st] = await Promise.all([
          getCalendar(year, `${year}-01-01`, `${year}-12-31`),
          getStaff(),
        ]);
        if (cancelled) return;
        setYearRows(cal?.ok ? (cal.rows || []) : []);
        setStaff(st?.ok ? (st.staff || st.rows || []) : []);
      } catch { if (!cancelled) { setYearRows([]); setStaff([]); } }
    })();
    return () => { cancelled = true; };
  }, [year]);

  // abbr -> full name lookup
  const staffName = useMemo(() => {
    const m = {};
    (staff || []).forEach(s => {
      const a = s.Abbrev || s.abbr; const n = s.Name || s.name;
      if (a) m[a] = n || a;
    });
    return (abbr) => m[abbr] || abbr || '';
  }, [staff]);

  const activeStaff = useMemo(
    () => (staff || []).filter(s => {
      const a = s.Active ?? s.active;
      if (a === undefined || a === null || a === '') return true;
      const str = String(a).trim().toUpperCase();
      return str !== 'N' && str !== 'FALSE' && str !== '0';
    }),
    [staff]
  );

  const rowsByDate = useMemo(() => {
    const m = {};
    rows.forEach(r => {
      const d = String(r.Date || r.date || '').slice(0, 10);
      if (d) m[d] = r;
    });
    return m;
  }, [rows]);

  useEffect(() => {
    if (!selectedDate) { setRollcall(null); return; }
    let cancelled = false;
    setRollcallLoading(true);
    setOverrideMsg(null);
    (async () => {
      try {
        const res = await getRollcall(selectedDate);
        if (!cancelled) setRollcall(res?.ok ? res : null);
      } catch {
        if (!cancelled) setRollcall(null);
      } finally {
        if (!cancelled) setRollcallLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedDate]);

  const selectedRow = selectedDate ? rowsByDate[selectedDate] : null;
  const selectedFails = selectedRow && String(selectedRow.Status || selectedRow.status || '').toUpperCase().includes('NEEDS ADMIN');

  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  // Roll-call rows for the selected day: [{original, status, substitute, post, ...}]
  function rcRows() {
    return (rollcall && Array.isArray(rollcall.rows)) ? rollcall.rows : [];
  }
  function rcFind(abbrOrName) {
    return rcRows().find(a =>
      (a.original || a.abbr || a.Abbr) === abbrOrName ||
      (a.name || a.Name) === abbrOrName);
  }

  function staffState(abbrOrName, row) {
    // Prefer live roll-call detail when this day is the selected one.
    if (selectedRow && row === selectedRow) {
      const att = rcFind(abbrOrName);
      if (att) {
        const status = (att.status || att.Status || '').toLowerCase();
        if (status === 'sick') return 'sick';
        if (status === 'substitute' || att.substitute) return 'substitute';
        if (status === 'confirmed' || status === 'present') return 'confirmed';
      }
    }
    // Otherwise colour straight from the calendar row's Duty_Record summary
    // (confirmed / sick / substitute) so the month grid is coloured too.
    if (row) {
      const sick = row.sick || [];
      const subs = row.substitute || [];
      if (sick.indexOf(abbrOrName) >= 0) return 'sick';
      if (subs.indexOf(abbrOrName) >= 0) return 'substitute';
      if (row.confirmed) return 'confirmed';
    }
    return 'unconfirmed';
  }

  // Who is helping (substitute) a given sick staff member on the selected day.
  function helperFor(abbrOrName, row) {
    if (selectedRow && row === selectedRow) {
      const att = rcFind(abbrOrName);
      if (att && att.substitute) return att.substitute;
    }
    return '';
  }

  async function handleForceOverride() {
    if (!selectedDate) return;
    setOverrideBusy(true);
    setOverrideMsg(null);
    try {
      const res = await apiPost('forceOverride', { year, date: selectedDate }, token);
      if (res?.ok) {
        setOverrideMsg({ type: 'ok', text: '已強制覆核 Override applied.' });
        const from = fmt(year, month, 1);
        const lastDay = new Date(year, month + 1, 0).getDate();
        const to = fmt(year, month, lastDay);
        const refreshed = await getCalendar(year, from, to);
        if (refreshed?.ok) setRows(refreshed.rows || []);
      } else {
        setOverrideMsg({ type: 'error', text: res?.reason || res?.error || '操作失敗 Override failed.' });
      }
    } catch (e) {
      setOverrideMsg({ type: 'error', text: e.message || '網絡錯誤 Network error' });
    } finally {
      setOverrideBusy(false);
    }
  }

  return (
    <div className="space-y-4" data-testid="page-calendar">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-navy">排更表 Calendar</h1>
          <p className="text-sm text-muted">按月查看排更狀態 View monthly roster status</p>
        </div>
        <div className="flex items-center gap-2">
          <select className="input w-auto" value={year} onChange={e => setYear(Number(e.target.value))} data-testid="select-year">
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <button className="btn btn-ghost" onClick={() => setMonth(m => (m === 0 ? 11 : m - 1))} data-testid="button-prev-month"><ChevronLeft size={16} /></button>
          <select className="input w-auto" value={month} onChange={e => setMonth(Number(e.target.value))} data-testid="select-month">
            {MONTHS_TC.map((m, i) => <option key={i} value={i}>{m} {i + 1}月</option>)}
          </select>
          <button className="btn btn-ghost" onClick={() => setMonth(m => (m === 11 ? 0 : m + 1))} data-testid="button-next-month"><ChevronRight size={16} /></button>
        </div>
      </div>

      {/* Legend */}
      <div className="card p-3 flex flex-wrap gap-3" data-testid="calendar-legend">
        {Object.entries(COLORS).map(([key, c]) => (
          <div key={key} className="flex items-center gap-1.5 text-xs" data-testid={`legend-${key}`}>
            <span className="w-3.5 h-3.5 rounded border border-border shrink-0" style={{ background: c.bg }} />
            <span className="text-text">
              {key === 'confirmed' && '已確認 Confirmed'}
              {key === 'sick' && '病假 Sick'}
              {key === 'substitute' && '替更 Substitute'}
              {key === 'shs' && 'SHS'}
              {key === 'opd' && '門診 OPD'}
              {key === 'unconfirmed' && '未確認 Unconfirmed'}
            </span>
          </div>
        ))}
      </div>

      {loading && (
        <div className="card p-10 flex items-center justify-center gap-2 text-muted" data-testid="calendar-loading">
          <Loader2 className="animate-spin" size={18} /> 載入中... Loading calendar...
        </div>
      )}

      {!loading && error && (
        <div className="card p-6 text-center text-pink-700" data-testid="calendar-error">
          <AlertTriangle className="mx-auto mb-2" /> {error}
        </div>
      )}

      {!loading && !error && rows.length === 0 && (
        <div className="card p-10 text-center text-muted" data-testid="calendar-empty">
          本月尚無排更資料 No roster data for this month.
        </div>
      )}

      {!loading && !error && rows.length > 0 && (
        <div className="card p-2 md:p-4 overflow-x-auto">
          {/* Desktop grid */}
          <div className="hidden md:grid grid-cols-7 gap-1 min-w-[720px]">
            {WEEKDAYS_TC.map(w => (
              <div key={w} className="text-center text-xs font-bold text-muted py-1">{w}</div>
            ))}
            {cells.map((d, i) => {
              if (!d) return <div key={i} />;
              const dateStr = fmt(year, month, d);
              const row = rowsByDate[dateStr];
              const badge = dayTypeBadge(row);
              const fails = row && String(row.Status || row.status || '').toUpperCase().includes('NEEDS ADMIN');
              const ipdList = getIpdList(row);
              const opdList = getOpdList(row);
              const isSelected = selectedDate === dateStr;
              return (
                <button
                  key={dateStr}
                  onClick={() => setSelectedDate(dateStr)}
                  data-testid={`day-cell-${dateStr}`}
                  className={`text-left align-top p-1.5 rounded-lg border min-h-[92px] transition
                    ${isSelected ? 'border-primary ring-2 ring-primary' : 'border-border'}
                    ${fails ? 'border-red-400' : ''} hover:bg-bg`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-semibold text-text">{d}</span>
                    {badge.label && <span className={`text-[10px] px-1 rounded ${badge.cls}`}>{badge.label}</span>}
                  </div>
                  <div className="flex flex-wrap gap-0.5">
                    {ipdList.slice(0, 6).map((name, idx) => {
                      const st = staffState(name, row);
                      return (
                        <span key={idx} className="text-[10px] px-1 rounded" style={{ background: COLORS[st].bg, color: COLORS[st].fg }}>
                          {name}
                        </span>
                      );
                    })}
                    {opdList.map((name, idx) => (
                      <span key={`opd-${idx}`} className="text-[10px] px-1 rounded" style={{ background: COLORS.opd.bg, color: COLORS.opd.fg }}>
                        {name} OPD
                      </span>
                    ))}
                    {getShsList(row).map((name, idx) => (
                      <span key={`shs-${idx}`} className="text-[10px] px-1 rounded font-semibold" style={{ background: COLORS.shs.bg, color: COLORS.shs.fg }}>
                        {name} SHS
                      </span>
                    ))}
                  </div>
                  {fails && <div className="text-[10px] text-red-600 mt-1 font-semibold">⚠ NEEDS ADMIN</div>}
                </button>
              );
            })}
          </div>

          {/* Mobile dense day rows */}
          <div className="md:hidden space-y-1.5">
            {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(d => {
              const dateStr = fmt(year, month, d);
              const row = rowsByDate[dateStr];
              const badge = dayTypeBadge(row);
              const fails = row && String(row.Status || row.status || '').toUpperCase().includes('NEEDS ADMIN');
              const ipdList = getIpdList(row);
              const opdList = getOpdList(row);
              const weekday = WEEKDAYS_TC[new Date(dateStr).getDay()];
              const isSelected = selectedDate === dateStr;
              return (
                <button
                  key={dateStr}
                  onClick={() => setSelectedDate(dateStr)}
                  data-testid={`day-row-${dateStr}`}
                  className={`w-full text-left p-2 rounded-lg border flex items-center gap-2
                    ${isSelected ? 'border-primary ring-2 ring-primary' : 'border-border'}
                    ${fails ? 'border-red-400' : ''}`}
                >
                  <div className="w-10 shrink-0 text-center">
                    <div className="text-xs font-bold text-text">{d}</div>
                    <div className="text-[10px] text-muted">{weekday}</div>
                  </div>
                  {badge.label && <span className={`text-[10px] px-1 rounded ${badge.cls}`}>{badge.label}</span>}
                  <div className="flex flex-wrap gap-0.5 flex-1 min-w-0">
                    {ipdList.slice(0, 4).map((name, idx) => {
                      const st = staffState(name, row);
                      return (
                        <span key={idx} className="text-[10px] px-1 rounded" style={{ background: COLORS[st].bg, color: COLORS[st].fg }}>{name}</span>
                      );
                    })}
                    {opdList.map((name, idx) => (
                      <span key={`opd-${idx}`} className="text-[10px] px-1 rounded" style={{ background: COLORS.opd.bg, color: COLORS.opd.fg }}>{name}</span>
                    ))}
                    {getShsList(row).map((name, idx) => (
                      <span key={`shs-${idx}`} className="text-[10px] px-1 rounded font-semibold" style={{ background: COLORS.shs.bg, color: COLORS.shs.fg }}>{name} SHS</span>
                    ))}
                  </div>
                  {fails && <AlertTriangle size={14} className="text-red-600 shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Side panel */}
      {selectedDate && (
        <div className="fixed inset-0 z-30 flex justify-end bg-black/30" onClick={() => setSelectedDate(null)}>
          <div className="w-full max-w-sm bg-surface h-full overflow-y-auto p-5 shadow-xl" onClick={e => e.stopPropagation()} data-testid="panel-day-detail">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-navy">{selectedDate}</h2>
              <button className="btn btn-ghost" onClick={() => setSelectedDate(null)} data-testid="button-close-panel"><X size={16} /></button>
            </div>

            {!selectedRow && (
              <p className="text-sm text-muted" data-testid="panel-no-data">此日期尚無排更資料 No roster data for this date.</p>
            )}

            {selectedRow && (
              <div className="space-y-4">
                <div>
                  <div className="text-xs text-muted mb-1">日類型 Day Type</div>
                  <div className="text-sm text-text font-medium">{selectedRow.Type || selectedRow.type || '一般 Normal'}</div>
                </div>

                <div>
                  <div className="text-xs text-muted mb-1">狀態 STATUS</div>
                  <div className={`text-sm font-medium ${selectedFails ? 'text-red-600' : 'text-text'}`} data-testid="text-day-status">
                    {selectedRow.Status || selectedRow.status || '正常 OK'}
                  </div>
                </div>

                {(selectedRow['Fail Reason'] || selectedRow.failReason) && (
                  <div>
                    <div className="text-xs text-muted mb-1">失敗原因 Fail Reason</div>
                    <div className="text-sm text-red-600" data-testid="text-fail-reason">{selectedRow['Fail Reason'] || selectedRow.failReason}</div>
                  </div>
                )}

                {(() => { const dt = rowType(selectedRow); return (
                <div>
                  <div className="text-xs text-muted mb-1">IPD 病房{(dt === 'Sat' || dt === 'Sun') && <span className="text-[10px] text-teal-700"> · 點名字可換更 tap a name to swap</span>}</div>
                  <div className="flex flex-wrap gap-1">
                    {getIpdList(selectedRow).map((name, idx) => {
                      const state = staffState(name, selectedRow);
                      const helper = state === 'sick' ? helperFor(name, selectedRow) : '';
                      const canSwap = (dt === 'Sat' || dt === 'Sun');
                      return (
                        <button key={idx} type="button" disabled={!canSwap}
                          onClick={() => canSwap && setSwapFrom({ abbr: name, role: 'ipd', dayType: dt })}
                          className={`text-xs px-2 py-0.5 rounded ${canSwap ? 'ring-1 ring-transparent hover:ring-teal-500 cursor-pointer' : 'cursor-default'}`}
                          style={{ background: COLORS[state].bg, color: COLORS[state].fg }} data-testid={`chip-ipd-${idx}`}>
                          {name}{helper ? <> → <b>{helper}</b> 代 sub</> : (state === 'sick' ? ' (病假 SL)' : '')}
                        </button>
                      );
                    })}
                    {getIpdList(selectedRow).length === 0 && <span className="text-sm text-muted">—</span>}
                  </div>
                </div>
                ); })()}

                {getOpdList(selectedRow).length > 0 && (
                  <div>
                    <div className="text-xs text-muted mb-1">OPD 門診{rowType(selectedRow) === 'Sat' && <span className="text-[10px] text-teal-700"> · 點名字可換更 tap to swap</span>}</div>
                    <div className="flex flex-wrap gap-1">
                      {getOpdList(selectedRow).map((name, idx) => {
                        const canSwap = rowType(selectedRow) === 'Sat';
                        return (
                          <button key={idx} type="button" disabled={!canSwap}
                            onClick={() => canSwap && setSwapFrom({ abbr: name, role: 'opd', dayType: 'Sat' })}
                            className={`text-xs px-2 py-0.5 rounded ${canSwap ? 'ring-1 ring-transparent hover:ring-teal-500 cursor-pointer' : 'cursor-default'}`}
                            style={{ background: COLORS.opd.bg, color: COLORS.opd.fg }} data-testid={`chip-opd-${idx}`}>
                            {name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {getShsList(selectedRow).length > 0 && (
                  <div>
                    <div className="text-xs text-muted mb-1">SHS 特別半日更 <span className="text-[10px] text-teal-700">· 點名字可替更 tap to replace</span></div>
                    <div className="grid grid-cols-2 gap-2">
                      {getShsSlots(selectedRow).map((s, idx) => (
                        <div key={idx}>
                          <div className="text-[10px] text-muted mb-0.5">{s.slot}</div>
                          {s.abbr
                            ? <button type="button"
                                onClick={() => setSwapFrom({ abbr: s.abbr, role: 'shs', slot: idx + 1, dayType: rowType(selectedRow) })}
                                className="text-xs px-2 py-0.5 rounded font-semibold ring-1 ring-transparent hover:ring-teal-500 cursor-pointer" style={{ background: COLORS.shs.bg, color: COLORS.shs.fg }} data-testid={`chip-shs-${idx}`}>{s.abbr}</button>
                            : <span className="text-xs text-muted">—</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {(() => { const dt = rowType(selectedRow); const isPrs = (dt === 'PH' || dt === 'SH' || dt === 'RD'); if (!isPrs) return null; const list = getIpdList(selectedRow); return (
                  <div>
                    <div className="text-xs text-muted mb-1">{dt} 當值 <span className="text-[10px] text-teal-700">· 點名字可替更 tap to replace</span></div>
                    <div className="flex flex-wrap gap-1">
                      {list.map((name, idx) => (
                        <button key={idx} type="button"
                          onClick={() => setSwapFrom({ abbr: name, role: 'prs', dayType: dt })}
                          className="text-xs px-2 py-0.5 rounded ring-1 ring-transparent hover:ring-teal-500 cursor-pointer" style={{ background: COLORS.duty?.bg || '#eef', color: COLORS.duty?.fg || '#334' }} data-testid={`chip-prs-${idx}`}>
                          {name}
                        </button>
                      ))}
                      {list.length === 0 && <span className="text-sm text-muted">—</span>}
                    </div>
                  </div>
                ); })()}

                {rollcallLoading && <p className="text-xs text-muted">點名資料載入中... Loading roll-call...</p>}

                <div className="pt-2 border-t border-border space-y-2">
                  {isAdmin && selectedFails && (
                    <>
                      <button className="btn btn-primary w-full justify-center" onClick={handleForceOverride} disabled={overrideBusy} data-testid="button-force-override">
                        <ShieldAlert size={16} /> {overrideBusy ? '處理中...' : '強制覆核 Force Override'}
                      </button>
                      {overrideMsg && (
                        <p className={`text-xs ${overrideMsg.type === 'ok' ? 'text-green-700' : 'text-red-600'}`} data-testid="text-override-msg">{overrideMsg.text}</p>
                      )}
                    </>
                  )}
                  <p className="text-[11px] text-muted">需換更/替更？直接點上方名單內的同事。To swap/replace, tap a staff name above.</p>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {swapFrom && selectedRow && (
        <CalSwapPanel
          year={year}
          token={token}
          from={swapFrom}
          fromDate={selectedDate}
          fromRow={selectedRow}
          yearRows={yearRows}
          activeStaff={activeStaff}
          staffName={staffName}
          onClose={() => setSwapFrom(null)}
          onApplied={async () => {
            // refresh current month + full year after a committed change
            try {
              const from = fmt(year, month, 1);
              const lastDay = new Date(year, month + 1, 0).getDate();
              const to = fmt(year, month, lastDay);
              const [mRes, yRes] = await Promise.all([
                getCalendar(year, from, to),
                getCalendar(year, `${year}-01-01`, `${year}-12-31`),
              ]);
              if (mRes?.ok) setRows(mRes.rows || []);
              if (yRes?.ok) setYearRows(yRes.rows || []);
            } catch { /* ignore */ }
          }}
        />
      )}
    </div>
  );
}

// ============================================================================
// Inline calendar swap panel — staff-first, then filter target dates.
// Modes derived from the clicked staff's role via swapModeFor():
//   weekend -> swapWeekend | opd -> swapOpd | shs -> replaceShs | prs -> replaceDuty
// All NON-BLOCKING: preview (dryRun) + apply; status is advisory only. Data is
// written to the correct CAL cell by the corresponding backend action.
// ============================================================================
function CalStatusReminder({ res }) {
  if (!res) return null;
  const pass = res.wouldPass;
  const bg = res.type === 'error' ? '#fdf2f8' : (pass ? '#f0fdf4' : '#fffbeb');
  const bd = res.type === 'error' ? '#f9a8d4' : (pass ? '#86efac' : '#fcd34d');
  const fg = res.type === 'error' ? '#9d174d' : (pass ? '#166534' : '#92400e');
  const Icon = res.type === 'error' ? AlertTriangle : (pass ? CheckCircle2 : Info);
  return (
    <div className="rounded-lg p-3 text-xs" style={{ background: bg, border: `1px solid ${bd}`, color: fg }} data-testid="box-cal-swap-status">
      <div className="flex items-center gap-1.5 font-semibold"><Icon size={14} /> {res.text}</div>
      {res.detail && <pre className="mt-1 whitespace-pre-wrap font-sans">{res.detail}</pre>}
    </div>
  );
}

function CalSwapPanel({ year, token, from, fromDate, fromRow, yearRows, activeStaff, staffName, onClose, onApplied }) {
  const mode = swapModeFor(from.role, from.dayType); // 'weekend'|'opd'|'shs'|'prs'|null
  const [counterpart, setCounterpart] = useState(''); // abbr of the other staff (weekend/opd/shs/prs "to")
  const [date2, setDate2] = useState('');             // target date (weekend/opd)
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);

  // For weekend/opd: the dates where the chosen counterpart is on a compatible duty.
  const counterpartDates = useMemo(() => {
    if (!counterpart) return [];
    if (mode === 'weekend') {
      // counterpart must be an IPD staff on a Sat/Sun date (any weekend date except fromDate)
      return yearRows.filter(r => {
        const t = rowType(r); if (t !== 'Sat' && t !== 'Sun') return false;
        if (rowDate(r) === fromDate) return false;
        return getIpdList(r).includes(counterpart);
      }).map(r => ({ date: rowDate(r), type: rowType(r) }));
    }
    if (mode === 'opd') {
      // counterpart must be the OPD person on another Sat date
      return yearRows.filter(r => {
        if (rowType(r) !== 'Sat') return false;
        if (rowDate(r) === fromDate) return false;
        return rowOpd1(r) === counterpart;
      }).map(r => ({ date: rowDate(r), type: 'Sat' }));
    }
    return [];
  }, [counterpart, mode, yearRows, fromDate]);

  const needsCounterpartDate = (mode === 'weekend' || mode === 'opd');
  const canRun = mode === 'shs' ? !!counterpart
    : mode === 'prs' ? !!counterpart
    : (!!counterpart && !!date2);

  function labelForMode() {
    switch (mode) {
      case 'weekend': return { title: 'Sat/Sun 換更 Weekend Swap', icon: ArrowLeftRight, note: '選對方同事 → 再選對方週末當值日期互換。Pick a colleague, then pick their weekend duty date to exchange.' };
      case 'opd': return { title: 'OPD 換更（僅週六）OPD Swap', icon: Building2, note: '選對方 OPD 同事 → 再選其週六 OPD 日期互換。Pick the other OPD staff, then their Saturday to exchange.' };
      case 'shs': return { title: `SHS(${from.slot}) 替更 Replace`, icon: Stethoscope, note: '直接以新同事覆寫此日 SHS。Directly override this date\'s SHS with a new staff.' };
      case 'prs': return { title: `${from.dayType} 替更 Replace`, icon: Repeat, note: '直接以新同事覆寫此日當值。Directly override this date\'s duty.' };
      default: return { title: '換更', icon: ArrowLeftRight, note: '' };
    }
  }
  const L = labelForMode();

  async function run(dryRun) {
    setBusy(true);
    if (!dryRun) setResult(null);
    try {
      let action, body;
      if (mode === 'weekend') {
        action = 'swapWeekend';
        body = { year, date1: fromDate, abbr1: from.abbr, date2, abbr2: counterpart, dryRun };
      } else if (mode === 'opd') {
        action = 'swapOpd';
        body = { year, date1: fromDate, date2, dryRun };
      } else if (mode === 'shs') {
        action = 'replaceShs';
        body = { year, date: fromDate, slot: from.slot, toAbbr: counterpart, dryRun };
      } else if (mode === 'prs') {
        action = 'replaceDuty';
        body = { year, date: fromDate, fromAbbr: from.abbr, toAbbr: counterpart, dryRun };
      } else {
        setBusy(false); return;
      }
      const res = await apiPost(action, body, token);
      if (!res?.ok) {
        const box = { type: 'error', text: res?.error || '操作失敗 Failed', wouldPass: false };
        dryRun ? setPreview(box) : setResult(box);
        return;
      }
      // Build a human-readable detail + advisory pass flag per mode.
      let detail = '', pass = true;
      if (mode === 'weekend') {
        pass = res.bothWeekend !== false && String(res.status1 || '').toUpperCase().includes('OK') && String(res.status2 || '').toUpperCase().includes('OK');
        detail = [
          `${fromDate}: ${staffName(from.abbr)} (${from.abbr}) → ${staffName(counterpart)} (${counterpart})`,
          `${date2}: ${staffName(counterpart)} (${counterpart}) → ${staffName(from.abbr)} (${from.abbr})`,
          res.bothWeekend === false ? '⚠ 其中一天非週末 One date is not a weekend.' : '',
          res.status1 ? `狀態1 ${fromDate}: ${res.status1}` : '',
          res.status2 ? `狀態2 ${date2}: ${res.status2}` : '',
        ].filter(Boolean).join('\n');
      } else if (mode === 'opd') {
        pass = res.bothSat !== false;
        detail = [
          `${fromDate} OPD: ${staffName(from.abbr)} (${from.abbr}) ⇄ ${date2} OPD: ${staffName(counterpart)} (${counterpart})`,
          res.bothSat === false ? '⚠ 其中一天非週六 One date is not a Saturday.' : '',
        ].filter(Boolean).join('\n');
      } else if (mode === 'shs') {
        pass = true;
        detail = `${fromDate} SHS(${from.slot}): ${staffName(from.abbr)} (${from.abbr}) → ${staffName(counterpart)} (${counterpart})`;
      } else if (mode === 'prs') {
        pass = String(res.status || '').toUpperCase().includes('OK');
        detail = [
          `${fromDate} ${from.dayType}: ${staffName(from.abbr)} (${from.abbr}) → ${staffName(counterpart)} (${counterpart})`,
          res.status ? `狀態 Status: ${res.status}` : '',
          res.fail ? `失敗原因 Fail: ${res.fail}` : '',
        ].filter(Boolean).join('\n');
      }
      if (dryRun) {
        setPreview({ type: 'info', wouldPass: pass, text: '預覽 Preview（未套用 not yet applied）', detail });
      } else {
        setPreview(null);
        setResult({ type: 'info', wouldPass: pass, text: '已套用 Applied' + (pass ? '' : '（有提示 with reminder）'), detail });
        if (onApplied) await onApplied();
      }
    } catch (e) {
      const box = { type: 'error', text: e.message || '網絡錯誤 Network error', wouldPass: false };
      dryRun ? setPreview(box) : setResult(box);
    } finally {
      setBusy(false);
    }
  }

  const Icon = L.icon;
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="card p-5 w-full max-w-md space-y-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()} data-testid="dialog-cal-swap">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-navy flex items-center gap-1.5"><Icon size={16} /> {L.title}</h3>
          <button className="btn btn-ghost" onClick={onClose} data-testid="button-close-cal-swap"><X size={16} /></button>
        </div>

        <div className="rounded-lg bg-slate-50 border border-border p-3 text-xs">
          <div className="text-muted mb-0.5">來源 From</div>
          <div className="font-medium text-text">{fromDate}（{from.dayType}）· {staffName(from.abbr)} ({from.abbr}){from.role === 'shs' ? ` · SHS(${from.slot})` : from.role === 'opd' ? ' · OPD' : ''}</div>
        </div>

        <p className="text-xs text-muted">{L.note}</p>

        {!mode && <p className="text-sm text-amber-700">此崗位不支援換更 This role cannot be swapped here.</p>}

        {mode && (
          <>
            {/* Step 1: pick the counterpart / new staff FIRST */}
            <div>
              <label className="block text-xs text-muted mb-1">
                {mode === 'shs' || mode === 'prs' ? '① 新同事 New staff' : '① 對方同事 Counterpart staff'}
              </label>
              <select className="input" value={counterpart}
                onChange={e => { setCounterpart(e.target.value); setDate2(''); setPreview(null); }}
                data-testid="select-cal-counterpart">
                <option value="">請選擇 Select...</option>
                {activeStaff.map((s, i) => {
                  const abbr = s.Abbrev || s.abbr;
                  if (abbr === from.abbr) return null;
                  return <option key={i} value={abbr}>{s.Name || s.name} ({abbr})</option>;
                })}
              </select>
            </div>

            {/* Step 2 (weekend/opd only): filter dates by the counterpart's own roster */}
            {needsCounterpartDate && counterpart && (
              <div>
                <label className="block text-xs text-muted mb-1">② 對方的當值日期 Counterpart's duty date</label>
                {counterpartDates.length === 0 ? (
                  <p className="text-xs text-amber-700" data-testid="text-no-counterpart-dates">
                    {staffName(counterpart)} 在本年沒有可互換的{mode === 'opd' ? '週六 OPD' : '週末'}當值。
                    {staffName(counterpart)} has no compatible {mode === 'opd' ? 'Saturday OPD' : 'weekend'} duty this year.
                  </p>
                ) : (
                  <select className="input" value={date2}
                    onChange={e => { setDate2(e.target.value); setPreview(null); }}
                    data-testid="select-cal-date2">
                    <option value="">請選擇 Select...</option>
                    {counterpartDates.map(d => <option key={d.date} value={d.date}>{d.date}（{d.type}）</option>)}
                  </select>
                )}
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <button className="btn btn-ghost flex-1 justify-center" onClick={() => run(true)} disabled={busy || !canRun} data-testid="button-cal-preview">
                {busy ? <Loader2 className="animate-spin" size={16} /> : <Info size={16} />} 預覽 Preview
              </button>
              <button className="btn btn-primary flex-1 justify-center" onClick={() => run(false)} disabled={busy || !canRun} data-testid="button-cal-apply">
                {busy ? <Loader2 className="animate-spin" size={16} /> : <Icon size={16} />} 套用 Apply
              </button>
            </div>

            <CalStatusReminder res={preview} />
            <CalStatusReminder res={result} />
            <p className="text-[11px] text-muted">變更即時寫入排更表並記錄於日誌。Changes are written to the roster immediately and logged for audit.</p>
          </>
        )}
      </div>
    </div>
  );
}
