import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../lib/auth';
import { getCalendar, getStaff, getMakeup, getRollcall, apiPost } from '../lib/api';
import { Loader2, AlertTriangle, CheckCircle2, Save } from 'lucide-react';

function pad(n) { return String(n).padStart(2, '0'); }
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function asList(v) {
  if (Array.isArray(v)) return v.filter(Boolean);
  if (typeof v === 'string') return v.split(',').map(s => s.trim()).filter(Boolean);
  return v ? [v] : [];
}
function getIpdList(row) {
  return asList(row?.IPD ?? row?.ipd);
}
function getOpdList(row) {
  return asList(row?.OPD ?? row?.opd);
}
// SHS(1) and SHS(2) kept separate — never merged.
function getShsList(row) {
  const out = [];
  const s1 = row?.shs1 ?? row?.SHS1;
  const s2 = row?.shs2 ?? row?.SHS2;
  if (s1) out.push({ abbr: s1, slot: 'SHS(1)' });
  if (s2) out.push({ abbr: s2, slot: 'SHS(2)' });
  if (!out.length) asList(row?.shs ?? row?.SHS).forEach((a, i) => out.push({ abbr: a, slot: `SHS(${i + 1})` }));
  return out;
}

export default function Rollcall() {
  const { token } = useAuth();
  const [date, setDate] = useState(todayStr());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [staff, setStaff] = useState([]);
  const [attendance, setAttendance] = useState([]); // [{abbr,name,post,status,substitute}]
  const [sickNext10, setSickNext10] = useState([]);
  const [workload, setWorkload] = useState({ icuhdu: '', ortho: '', neuro: '', ms: '', newcase: '' });
  const [confirmedBy, setConfirmedBy] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSaveResult(null);
    (async () => {
      try {
        const year = new Date(date).getFullYear();
        const [calRes, staffRes, makeupRes, savedRes] = await Promise.all([
          getCalendar(year, date, date),
          getStaff(),
          getMakeup('sick'),
          getRollcall(date),
        ]);
        if (cancelled) return;
        if (!calRes?.ok || !staffRes?.ok) {
          setError('無法載入點名資料 Failed to load roll-call data');
          setLoading(false);
          return;
        }
        const staffRows = staffRes.rows || [];
        setStaff(staffRows);
        setSickNext10(makeupRes?.ok ? (makeupRes.rows || []).slice(0, 10) : []);
        const nameOf = (abbr) => {
          const m = staffRows.find(s => (s.Abbrev || s.abbr) === abbr);
          return m?.Name || m?.name || abbr;
        };

        const row = (calRes.rows || [])[0];
        // Build the FULL on-duty list for attendance: IPD + OPD + SHS(1)/SHS(2).
        const rowFor = (nameOrAbbr) => staffRows.find(s => (s.Abbrev || s.abbr) === nameOrAbbr || (s.Name || s.name) === nameOrAbbr);
        const mkEntry = (nameOrAbbr, post) => {
          const match = rowFor(nameOrAbbr);
          return {
            abbr: match?.Abbrev || match?.abbr || nameOrAbbr,
            name: match?.Name || match?.name || nameOrAbbr,
            post, status: 'present', substitute: '', type: '',
          };
        };
        const rosterList = [
          ...getIpdList(row).map(a => mkEntry(a, 'IPD')),
          ...getOpdList(row).map(a => mkEntry(a, 'OPD')),
          ...getShsList(row).map(x => mkEntry(x.abbr, x.slot)),
        ];

        // Workload: reload from saved record (backend returns it from CAL_<year>).
        const savedWl = savedRes?.workload || null;
        const wlState = savedWl ? {
          icuhdu: savedWl.icuhdu ?? '', ortho: savedWl.ortho ?? '', neuro: savedWl.neuro ?? '',
          ms: savedWl.ms ?? '', newcase: savedWl.newcase ?? '',
        } : { icuhdu: '', ortho: '', neuro: '', ms: '', newcase: '' };
        setWorkload(wlState);

        const saved = savedRes?.ok ? (savedRes.rows || []) : [];
        if (saved.length > 0) {
          // RELOAD previously saved attendance (incl. who is helping the sick duty),
          // merged with the on-duty roster so OPD/SHS still appear even if not yet saved.
          const savedByAbbr = {};
          saved.forEach(r => { savedByAbbr[r.original] = r; });
          const merged = rosterList.map(e => {
            const r = savedByAbbr[e.abbr];
            if (!r) return e;
            delete savedByAbbr[e.abbr];
            return { ...e, post: r.post || e.post, status: r.status || 'present', substitute: r.substitute || '', type: r.type || '' };
          });
          // any saved rows not in the roster list (e.g. manual adds)
          Object.values(savedByAbbr).forEach(r => merged.push({
            abbr: r.original, name: nameOf(r.original), post: r.post || 'IPD',
            status: r.status || 'present', substitute: r.substitute || '', type: r.type || '',
          }));
          setAttendance(merged);
          setConfirmedBy('');
        } else {
          setAttendance(rosterList);
          setConfirmedBy(rosterList.map(e => e.abbr).join(', '));
        }
      } catch (e) {
        if (!cancelled) setError(e.message || '網絡錯誤 Network error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [date]);

  const activeStaff = useMemo(() => staff.filter(s => {
    const v = s.Active ?? s.active ?? s['Dept Active'];
    return v === true || v === 'Y' || v === 'y' || v === 1;
  }), [staff]);

  const total = useMemo(() => {
    const n = (v) => Number(v) || 0;
    return n(workload.icuhdu) + n(workload.ortho) + n(workload.neuro) + n(workload.ms);
  }, [workload]);

  function updateAttendance(idx, patch) {
    setAttendance(prev => prev.map((a, i) => i === idx ? { ...a, ...patch } : a));
  }

  async function handleSave() {
    setSaving(true);
    setSaveResult(null);
    try {
      const res = await apiPost('saveRollcall', {
        date,
        attendance: attendance.map(a => ({ original: a.abbr, post: a.post, status: a.status, substitute: a.substitute || undefined, type: a.type || undefined })),
        workload: {
          icuhdu: Number(workload.icuhdu) || 0,
          ortho: Number(workload.ortho) || 0,
          neuro: Number(workload.neuro) || 0,
          ms: Number(workload.ms) || 0,
          newcase: Number(workload.newcase) || 0,
          by: confirmedBy,
        },
      }, token);
      if (res?.ok) {
        setSaveResult({ type: 'ok', text: '已確認 Saved — 顏色現已生效 Colours now apply.' });
      } else {
        setSaveResult({ type: 'error', text: res?.reason || res?.error || '儲存失敗 Save failed.' });
      }
    } catch (e) {
      setSaveResult({ type: 'error', text: e.message || '網絡錯誤 Network error' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4" data-testid="page-rollcall">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-navy">點名 Roll-call</h1>
          <p className="text-sm text-muted">確認今日出勤及工作量 Confirm daily attendance and workload</p>
        </div>
        <input type="date" className="input w-auto" value={date} onChange={e => setDate(e.target.value)} data-testid="input-rollcall-date" />
      </div>

      {loading && (
        <div className="card p-10 flex items-center justify-center gap-2 text-muted" data-testid="rollcall-loading">
          <Loader2 className="animate-spin" size={18} /> 載入中... Loading...
        </div>
      )}

      {!loading && error && (
        <div className="card p-6 text-center text-pink-700" data-testid="rollcall-error">
          <AlertTriangle className="mx-auto mb-2" /> {error}
        </div>
      )}

      {!loading && !error && attendance.length === 0 && (
        <div className="card p-10 text-center text-muted" data-testid="rollcall-empty">
          此日期沒有排更人員 No roster staff scheduled for this date.
        </div>
      )}

      {!loading && !error && attendance.length > 0 && (
        <>
          <div className="card p-4 overflow-x-auto">
            <h2 className="text-sm font-bold text-navy mb-3">出勤名單 Attendance</h2>
            <table className="w-full text-sm min-w-[560px]" data-testid="table-attendance">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-border">
                  <th className="py-2 pr-2">姓名 Name</th>
                  <th className="py-2 pr-2">崗位 Post</th>
                  <th className="py-2 pr-2">狀態 Status</th>
                  <th className="py-2 pr-2">替更 Substitute</th>
                </tr>
              </thead>
              <tbody>
                {attendance.map((a, idx) => (
                  <tr key={a.abbr + idx} className="border-b border-border last:border-0" data-testid={`row-attendance-${a.abbr}`}>
                    <td className="py-2 pr-2 font-medium text-text">{a.name}</td>
                    <td className="py-2 pr-2">
                      <input className="input" value={a.post} onChange={e => updateAttendance(idx, { post: e.target.value })} data-testid={`input-post-${a.abbr}`} />
                    </td>
                    <td className="py-2 pr-2">
                      <div className="flex gap-3">
                        <label className="flex items-center gap-1 text-xs">
                          <input type="radio" name={`status-${idx}`} checked={a.status === 'present'} onChange={() => updateAttendance(idx, { status: 'present', substitute: '' })} data-testid={`radio-present-${a.abbr}`} />
                          出席 Present
                        </label>
                        <label className="flex items-center gap-1 text-xs">
                          <input type="radio" name={`status-${idx}`} checked={a.status === 'sick'} onChange={() => updateAttendance(idx, { status: 'sick' })} data-testid={`radio-sick-${a.abbr}`} />
                          病假 Sick
                        </label>
                      </div>
                    </td>
                    <td className="py-2 pr-2">
                      {a.status === 'sick' ? (
                        <div className="space-y-1">
                        <select className="input" value={a.substitute} onChange={e => updateAttendance(idx, { substitute: e.target.value })} data-testid={`select-substitute-${a.abbr}`}>
                          <option value="">請選擇接替 Select helper...</option>
                          {sickNext10.length > 0 && (
                            <optgroup label="Next-10 建議">
                              {sickNext10.map((s, i) => {
                                const abbr = s.Abbrev || s.abbr;
                                const name = s.Name || s.name;
                                return <option key={`n10-${abbr}-${i}`} value={abbr}>{name} ({abbr})</option>;
                              })}
                            </optgroup>
                          )}
                          <optgroup label="全部在職員工 All active staff">
                            {activeStaff.map((s, i) => {
                              const abbr = s.Abbrev || s.abbr;
                              const name = s.Name || s.name;
                              return <option key={`all-${abbr}-${i}`} value={abbr}>{name} ({abbr})</option>;
                            })}
                          </optgroup>
                        </select>
                        <p className="text-xs text-muted" data-testid={`text-sub-remark-${a.abbr}`}>原值班 Original: <b>{a.abbr}</b>{a.substitute ? <> → 接替 Helping: <b className="text-primary">{a.substitute}</b></> : ' — 待排接替 pending helper'}</p>
                        </div>
                      ) : <span className="text-muted text-xs">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="card p-4">
            <h2 className="text-sm font-bold text-navy mb-3">工作量 Workload</h2>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <div>
                <label className="block text-xs text-muted mb-1">ICU/HDU</label>
                <input type="number" min="0" className="input" value={workload.icuhdu} onChange={e => setWorkload(w => ({ ...w, icuhdu: e.target.value }))} data-testid="input-workload-icuhdu" />
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">Ortho 骨科</label>
                <input type="number" min="0" className="input" value={workload.ortho} onChange={e => setWorkload(w => ({ ...w, ortho: e.target.value }))} data-testid="input-workload-ortho" />
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">Neuro 神經</label>
                <input type="number" min="0" className="input" value={workload.neuro} onChange={e => setWorkload(w => ({ ...w, neuro: e.target.value }))} data-testid="input-workload-neuro" />
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">M&S 內外科</label>
                <input type="number" min="0" className="input" value={workload.ms} onChange={e => setWorkload(w => ({ ...w, ms: e.target.value }))} data-testid="input-workload-ms" />
              </div>
              <div>
                <label className="block text-xs text-muted mb-1">New 新症</label>
                <input type="number" min="0" className="input" value={workload.newcase} onChange={e => setWorkload(w => ({ ...w, newcase: e.target.value }))} data-testid="input-workload-newcase" />
              </div>
            </div>
            <div className="mt-3 text-sm text-text" data-testid="text-workload-total">
              總數 Total (ICU/HDU+Ortho+Neuro+M&S)：<span className="font-bold">{total}</span>
              <span className="text-muted ml-3">新症 New (另計)：{Number(workload.newcase) || 0}</span>
            </div>
          </div>

          <div className="card p-4">
            <label className="block text-xs text-muted mb-1">確認人 Confirmed by</label>
            <input className="input" value={confirmedBy} onChange={e => setConfirmedBy(e.target.value)} placeholder="姓名 Name" data-testid="input-confirmed-by" />
          </div>

          <button className="btn btn-primary w-full justify-center py-3" onClick={handleSave} disabled={saving} data-testid="button-save-rollcall">
            {saving ? <Loader2 className="animate-spin" size={18} /> : <Save size={18} />}
            {saving ? '儲存中...' : '確認儲存 Save & Confirm'}
          </button>

          {saveResult && (
            <div className={`card p-3 flex items-center gap-2 text-sm ${saveResult.type === 'ok' ? 'text-green-700' : 'text-pink-700'}`} data-testid="text-save-result">
              {saveResult.type === 'ok' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
              {saveResult.text}
            </div>
          )}
        </>
      )}
    </div>
  );
}
