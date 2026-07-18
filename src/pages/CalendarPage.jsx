import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../lib/auth';
import { getMeta, getCalendar, getRollcall, apiPost } from '../lib/api';
import { COLORS } from '../lib/config';
import { ChevronLeft, ChevronRight, X, ShieldAlert, ArrowLeftRight, AlertTriangle, Loader2 } from 'lucide-react';

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
  const [swapOpen, setSwapOpen] = useState(false);

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
  const selectedIsWeekend = selectedDate ? [0, 6].includes(new Date(selectedDate).getDay()) : false;
  const selectedFails = selectedRow && String(selectedRow.Status || selectedRow.status || '').toUpperCase().includes('NEEDS ADMIN');

  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  function staffState(abbrOrName, row) {
    // Prefer live roll-call detail when this day is the selected one.
    if (selectedRow && row === selectedRow && rollcall?.attendance) {
      const att = rollcall.attendance.find(a => (a.abbr || a.Abbr) === abbrOrName || (a.name || a.Name) === abbrOrName);
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
    if (selectedRow && row === selectedRow && rollcall?.attendance) {
      const att = rollcall.attendance.find(a => (a.abbr || a.Abbr) === abbrOrName || (a.name || a.Name) === abbrOrName);
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

                <div>
                  <div className="text-xs text-muted mb-1">IPD 病房</div>
                  <div className="flex flex-wrap gap-1">
                    {getIpdList(selectedRow).map((name, idx) => {
                      const state = staffState(name, selectedRow);
                      const helper = state === 'sick' ? helperFor(name, selectedRow) : '';
                      return (
                        <span key={idx} className="text-xs px-2 py-0.5 rounded" style={{ background: COLORS[state].bg, color: COLORS[state].fg }} data-testid={`chip-ipd-${idx}`}>
                          {name}{helper ? <> → <b>{helper}</b> 代 sub</> : (state === 'sick' ? ' (病假 SL)' : '')}
                        </span>
                      );
                    })}
                    {getIpdList(selectedRow).length === 0 && <span className="text-sm text-muted">—</span>}
                  </div>
                </div>

                {getOpdList(selectedRow).length > 0 && (
                  <div>
                    <div className="text-xs text-muted mb-1">OPD 門診</div>
                    <div className="flex flex-wrap gap-1">
                      {getOpdList(selectedRow).map((name, idx) => (
                        <span key={idx} className="text-xs px-2 py-0.5 rounded" style={{ background: COLORS.opd.bg, color: COLORS.opd.fg }}>
                          {name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {getShsList(selectedRow).length > 0 && (
                  <div>
                    <div className="text-xs text-muted mb-1">SHS 特別半日更</div>
                    <div className="grid grid-cols-2 gap-2">
                      {getShsSlots(selectedRow).map((s, idx) => (
                        <div key={idx}>
                          <div className="text-[10px] text-muted mb-0.5">{s.slot}</div>
                          {s.abbr
                            ? <span className="text-xs px-2 py-0.5 rounded font-semibold" style={{ background: COLORS.shs.bg, color: COLORS.shs.fg }} data-testid={`chip-shs-${idx}`}>{s.abbr}</span>
                            : <span className="text-xs text-muted">—</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

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
                  {!isAdmin && selectedIsWeekend && (
                    <button className="btn btn-ghost w-full justify-center" onClick={() => setSwapOpen(true)} data-testid="button-open-swap">
                      <ArrowLeftRight size={16} /> 申請換更 Request Swap
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {swapOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={() => setSwapOpen(false)}>
          <div className="card p-5 w-full max-w-sm" onClick={e => e.stopPropagation()} data-testid="dialog-swap-hint">
            <h3 className="text-sm font-bold text-navy mb-2">申請換更 Request Swap</h3>
            <p className="text-sm text-muted mb-4">請前往「換更 Swaps」頁面完成換更申請。Please go to the Swaps page to complete your request.</p>
            <button className="btn btn-primary w-full justify-center" onClick={() => setSwapOpen(false)} data-testid="button-close-swap-hint">知道了 Got it</button>
          </div>
        </div>
      )}
    </div>
  );
}
