import { useEffect, useState } from 'react';
import { getStaff, apiPost } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Loader2, AlertTriangle, Save, Plus, CheckCircle2, ToggleLeft, ToggleRight, Trash2 } from 'lucide-react';

function blankStaff() {
  return {
    Name: '', Abbrev: '', ORT: '-', NEURO: '-', MS: '-', Tier: '2', Mentor: '',
    Team: '', Sub: '1',
    PHOrder: '', SHSOrder: '',
    SK_Active: 'Y', SK_Round: '0', SK_Order: '',
    TY_Active: 'Y', TY_Round: '0', TY_Order: '',
    EW_Active: 'Y', EW_Round: '0', EW_Order: '',
    Active: 'Y', LeaveStart: '', LeaveEnd: '',
    _isNew: true,
  };
}

const v = (x, d = '') => (x === null || x === undefined ? d : x);
function normalizeRow(r) {
  // Backend getStaff returns nested ty/ew/sk objects: {active, round, order}
  const sk = r.sk || {}, ty = r.ty || {}, ew = r.ew || {};
  return {
    Name: v(r.name ?? r.Name),
    Abbrev: v(r.abbr ?? r.Abbrev),
    ORT: v(r.ort ?? r.ORT, '-'),
    NEURO: v(r.neuro ?? r.NEURO, '-'),
    MS: v(r.ms ?? r.MS ?? r['M&S'], '-'),
    Tier: String(v(r.tier ?? r.Tier, '2')),
    Mentor: v(r.mentor ?? r.Mentor),
    Team: v(r.team ?? r.Team),
    Sub: v(r.sub ?? r.Sub, '1'),
    PHOrder: v(r.ph_order ?? r.PHOrder),
    SHSOrder: v(r.shs_order ?? r.SHSOrder),
    SK_Active: v(sk.active ?? r.SK_Active, 'Y'),
    SK_Round: v(sk.round ?? r.SK_Round, '0'),
    SK_Order: v(sk.order ?? r.SK_Order),
    TY_Active: v(ty.active ?? r.TY_Active, 'Y'),
    TY_Round: v(ty.round ?? r.TY_Round, '0'),
    TY_Order: v(ty.order ?? r.TY_Order),
    EW_Active: v(ew.active ?? r.EW_Active, 'Y'),
    EW_Round: v(ew.round ?? r.EW_Round, '0'),
    EW_Order: v(ew.order ?? r.EW_Order),
    Active: v(r.active ?? r.Active, 'Y'),
    LeaveStart: v(r.leave_start ?? r.LeaveStart),
    LeaveEnd: v(r.leave_end ?? r.LeaveEnd),
    _isNew: false,
  };
}

export default function StaffMaster() {
  const { token } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [rows, setRows] = useState([]);
  const [savingIdx, setSavingIdx] = useState(null);
  const [rowMsg, setRowMsg] = useState({}); // idx -> {type,text}

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await getStaff();
      if (!res?.ok) { setError('無法載入員工資料 Failed to load staff data'); setRows([]); }
      else setRows((res.rows || []).map(normalizeRow));
    } catch (e) {
      setError(e.message || '網絡錯誤 Network error');
    } finally {
      setLoading(false);
    }
  }

  function update(idx, patch) {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, ...patch } : r));
  }

  function addRow() {
    setRows(prev => [...prev, blankStaff()]);
  }

  function validate(row) {
    const issues = [];
    if (row.Tier === '3' && !row.Mentor) issues.push('Tier 3 需要指定 Mentor / Tier 3 requires a Mentor');
    const dup = rows.filter(r => r.PHOrder && r.PHOrder === row.PHOrder);
    if (row.PHOrder && dup.length > 1) issues.push('PH Order 必須唯一 / PH Order must be unique');
    return issues;
  }

  // Map the UI row (capitalised keys) to the backend's expected snake_case payload.
  function toPayload(row) {
    return {
      abbr: (row.Abbrev || '').trim(),
      name: row.Name,
      ort: row.ORT, neuro: row.NEURO, ms: row.MS,
      tier: row.Tier, mentor: row.Mentor,
      team: (row.Team || '').trim().toUpperCase() || undefined,
      sub: row.Sub || undefined,
      ph_order: row.PHOrder === '' ? undefined : Number(row.PHOrder),
      shs_order: row.SHSOrder === '' ? undefined : Number(row.SHSOrder),
      active: row.Active,
      leave_start: row.LeaveStart, leave_end: row.LeaveEnd,
      sk: { active: row.SK_Active, round: row.SK_Round, order: row.SK_Order },
      ty: { active: row.TY_Active, round: row.TY_Round, order: row.TY_Order },
      ew: { active: row.EW_Active, round: row.EW_Round, order: row.EW_Order },
    };
  }

  async function saveRow(idx) {
    const row = rows[idx];
    if (!(row.Abbrev || '').trim()) {
      setRowMsg(m => ({ ...m, [idx]: { type: 'error', text: '請輸入簡稱 Abbreviation / Abbreviation is required' } }));
      return;
    }
    const issues = validate(row);
    if (issues.length) {
      setRowMsg(m => ({ ...m, [idx]: { type: 'error', text: issues.join('; ') } }));
      return;
    }
    setSavingIdx(idx);
    setRowMsg(m => ({ ...m, [idx]: null }));
    try {
      const res = await apiPost('upsertStaff', { staff: toPayload(row) }, token);
      if (res?.ok) {
        setRowMsg(m => ({ ...m, [idx]: { type: 'ok', text: '已儲存 Saved' } }));
        update(idx, { _isNew: false });
      } else {
        setRowMsg(m => ({ ...m, [idx]: { type: 'error', text: res?.reason || res?.error || '儲存失敗 Save failed' } }));
      }
    } catch (e) {
      setRowMsg(m => ({ ...m, [idx]: { type: 'error', text: e.message || '網絡錯誤 Network error' } }));
    } finally {
      setSavingIdx(null);
    }
  }

  async function deleteRow(idx) {
    const row = rows[idx];
    if (row._isNew) { setRows(prev => prev.filter((_, i) => i !== idx)); return; }
    if (!window.confirm(`確定刪除 ${row.Name || row.Abbrev}？Delete this staff?`)) return;
    setSavingIdx(idx);
    try {
      const res = await apiPost('deleteStaff', { abbr: row.Abbrev }, token);
      if (res?.ok) { setRows(prev => prev.filter((_, i) => i !== idx)); }
      else setRowMsg(m => ({ ...m, [idx]: { type: 'error', text: res?.error || '刪除失敗 Delete failed' } }));
    } catch (e) {
      setRowMsg(m => ({ ...m, [idx]: { type: 'error', text: e.message || '網絡錯誤 Network error' } }));
    } finally { setSavingIdx(null); }
  }

  async function toggleActive(idx) {
    const row = rows[idx];
    const next = row.Active === 'Y' ? 'N' : 'Y';
    update(idx, { Active: next });
    try {
      await apiPost('setActive', { abbr: row.Abbrev, active: next === 'Y' }, token);
    } catch { /* keep optimistic UI; row.Active already updated */ }
  }

  const inputCls = 'input !w-24 text-xs';
  const selectCls = 'input !w-16 text-xs';

  return (
    <div className="space-y-4" data-testid="page-staff-master">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-navy">員工資料 Staff Master</h1>
          <p className="text-sm text-muted">管理員工資料、名單設置及輪值次序 Manage staff records, list settings and duty order</p>
        </div>
        <button className="btn btn-primary" onClick={addRow} data-testid="button-add-staff">
          <Plus size={16} /> 新增 Add
        </button>
      </div>

      {loading && (
        <div className="card p-10 flex items-center justify-center gap-2 text-muted" data-testid="staff-loading">
          <Loader2 className="animate-spin" size={18} /> 載入中... Loading...
        </div>
      )}

      {!loading && error && (
        <div className="card p-6 text-center text-pink-700" data-testid="staff-error">
          <AlertTriangle className="mx-auto mb-2" /> {error}
        </div>
      )}

      {!loading && !error && rows.length === 0 && (
        <div className="card p-10 text-center text-muted" data-testid="staff-empty">
          尚無員工資料 No staff records yet. 按「新增」建立第一筆記錄。Click "Add" to create the first record.
        </div>
      )}

      {!loading && !error && rows.length > 0 && (
        <div className="card p-2 overflow-x-auto">
          <table className="text-xs min-w-[1400px] w-full" data-testid="table-staff">
            <thead>
              <tr className="text-left text-muted border-b border-border">
                <th className="p-2">姓名 Name</th>
                <th className="p-2">簡稱 Abbrev</th>
                <th className="p-2">ORT</th>
                <th className="p-2">NEURO</th>
                <th className="p-2">M&S</th>
                <th className="p-2">Tier</th>
                <th className="p-2">Mentor</th>
                <th className="p-2">隊 Team</th>
                <th className="p-2">小組 Sub</th>
                <th className="p-2">PH Order</th>
                <th className="p-2">SHS Order</th>
                <th className="p-2" colSpan={3}>SK (病假)</th>
                <th className="p-2" colSpan={3}>TY (颱風)</th>
                <th className="p-2" colSpan={3}>EW (惡劣天氣)</th>
                <th className="p-2">在職 Active</th>
                <th className="p-2">休假起 Leave Start</th>
                <th className="p-2">休假止 Leave End</th>
                <th className="p-2">操作 Actions</th>
              </tr>
              <tr className="text-left text-muted border-b border-border">
                <th colSpan={11} />
                <th className="p-1">Active</th><th className="p-1">Round</th><th className="p-1">Order</th>
                <th className="p-1">Active</th><th className="p-1">Round</th><th className="p-1">Order</th>
                <th className="p-1">Active</th><th className="p-1">Round</th><th className="p-1">Order</th>
                <th colSpan={4} />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={idx} className="border-b border-border align-top" data-testid={`row-staff-${row.Abbrev || idx}`}>
                  <td className="p-1"><input className="input !w-32 text-xs" value={row.Name} onChange={e => update(idx, { Name: e.target.value })} data-testid={`input-name-${idx}`} /></td>
                  <td className="p-1"><input className={inputCls} value={row.Abbrev} onChange={e => update(idx, { Abbrev: e.target.value })} data-testid={`input-abbrev-${idx}`} /></td>
                  <td className="p-1">
                    <select className={selectCls} value={row.ORT} onChange={e => update(idx, { ORT: e.target.value })} data-testid={`select-ort-${idx}`}>
                      <option value="Y">Y</option><option value="-">-</option>
                    </select>
                  </td>
                  <td className="p-1">
                    <select className={selectCls} value={row.NEURO} onChange={e => update(idx, { NEURO: e.target.value })} data-testid={`select-neuro-${idx}`}>
                      <option value="Y">Y</option><option value="-">-</option>
                    </select>
                  </td>
                  <td className="p-1">
                    <select className={selectCls} value={row.MS} onChange={e => update(idx, { MS: e.target.value })} data-testid={`select-ms-${idx}`}>
                      <option value="Y">Y</option><option value="-">-</option>
                    </select>
                  </td>
                  <td className="p-1">
                    <select className={selectCls} value={row.Tier} onChange={e => update(idx, { Tier: e.target.value })} data-testid={`select-tier-${idx}`}>
                      <option value="1">1</option><option value="2">2</option><option value="3">3</option>
                    </select>
                  </td>
                  <td className="p-1"><input className={inputCls} value={row.Mentor} onChange={e => update(idx, { Mentor: e.target.value })} placeholder={row.Tier === '3' ? '必填 Required' : ''} data-testid={`input-mentor-${idx}`} /></td>
                  <td className="p-1">
                    <select className={selectCls} value={row.Team} onChange={e => update(idx, { Team: e.target.value })} data-testid={`select-team-${idx}`}>
                      <option value="">-</option>
                      <option value="A">A</option><option value="B">B</option><option value="C">C</option><option value="D">D</option>
                    </select>
                  </td>
                  <td className="p-1">
                    <select className={selectCls} value={row.Sub} onChange={e => update(idx, { Sub: e.target.value })} data-testid={`select-sub-${idx}`}>
                      <option value="1">1</option>
                      <option value="2">2</option>
                      <option value="Sat only">Sat only</option>
                      <option value="Sun only">Sun only</option>
                      <option value="OPD">OPD</option>
                    </select>
                  </td>
                  <td className="p-1"><input className={selectCls} value={row.PHOrder} onChange={e => update(idx, { PHOrder: e.target.value })} data-testid={`input-phorder-${idx}`} /></td>
                  <td className="p-1"><input className={selectCls} value={row.SHSOrder} onChange={e => update(idx, { SHSOrder: e.target.value })} data-testid={`input-shsorder-${idx}`} /></td>

                  <td className="p-1">
                    <select className={selectCls} value={row.SK_Active} onChange={e => update(idx, { SK_Active: e.target.value })} data-testid={`select-sk-active-${idx}`}>
                      <option value="Y">Y</option><option value="N">N</option>
                    </select>
                  </td>
                  <td className="p-1"><input className={selectCls} value={row.SK_Round} onChange={e => update(idx, { SK_Round: e.target.value })} data-testid={`input-sk-round-${idx}`} /></td>
                  <td className="p-1"><input className={selectCls} value={row.SK_Order} onChange={e => update(idx, { SK_Order: e.target.value })} data-testid={`input-sk-order-${idx}`} /></td>

                  <td className="p-1">
                    <select className={selectCls} value={row.TY_Active} onChange={e => update(idx, { TY_Active: e.target.value })} data-testid={`select-ty-active-${idx}`}>
                      <option value="Y">Y</option><option value="N">N</option>
                    </select>
                  </td>
                  <td className="p-1"><input className={selectCls} value={row.TY_Round} onChange={e => update(idx, { TY_Round: e.target.value })} data-testid={`input-ty-round-${idx}`} /></td>
                  <td className="p-1"><input className={selectCls} value={row.TY_Order} onChange={e => update(idx, { TY_Order: e.target.value })} data-testid={`input-ty-order-${idx}`} /></td>

                  <td className="p-1">
                    <select className={selectCls} value={row.EW_Active} onChange={e => update(idx, { EW_Active: e.target.value })} data-testid={`select-ew-active-${idx}`}>
                      <option value="Y">Y</option><option value="N">N</option>
                    </select>
                  </td>
                  <td className="p-1"><input className={selectCls} value={row.EW_Round} onChange={e => update(idx, { EW_Round: e.target.value })} data-testid={`input-ew-round-${idx}`} /></td>
                  <td className="p-1"><input className={selectCls} value={row.EW_Order} onChange={e => update(idx, { EW_Order: e.target.value })} data-testid={`input-ew-order-${idx}`} /></td>

                  <td className="p-1">
                    <button className="btn btn-ghost !px-2 !py-1" onClick={() => toggleActive(idx)} data-testid={`button-toggle-active-${idx}`}>
                      {row.Active === 'Y' ? <ToggleRight size={18} className="text-primary" /> : <ToggleLeft size={18} className="text-muted" />}
                    </button>
                  </td>
                  <td className="p-1"><input type="date" className="input !w-32 text-xs" value={row.LeaveStart} onChange={e => update(idx, { LeaveStart: e.target.value })} data-testid={`input-leave-start-${idx}`} /></td>
                  <td className="p-1"><input type="date" className="input !w-32 text-xs" value={row.LeaveEnd} onChange={e => update(idx, { LeaveEnd: e.target.value })} data-testid={`input-leave-end-${idx}`} /></td>
                  <td className="p-1">
                    <div className="flex gap-1">
                      <button className="btn btn-primary !px-2 !py-1" onClick={() => saveRow(idx)} disabled={savingIdx === idx} data-testid={`button-save-staff-${idx}`}>
                        {savingIdx === idx ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
                      </button>
                      <button className="btn btn-ghost !px-2 !py-1 text-pink-700" onClick={() => deleteRow(idx)} disabled={savingIdx === idx} data-testid={`button-delete-staff-${idx}`} title="刪除 Delete">
                        <Trash2 size={14} />
                      </button>
                    </div>
                    {rowMsg[idx] && (
                      <div className={`mt-1 text-[10px] ${rowMsg[idx].type === 'ok' ? 'text-green-700' : 'text-pink-700'}`} data-testid={`text-staff-msg-${idx}`}>
                        {rowMsg[idx].type === 'ok' ? <CheckCircle2 size={10} className="inline mr-0.5" /> : <AlertTriangle size={10} className="inline mr-0.5" />}
                        {rowMsg[idx].text}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-muted">
        提示 Hints: PH Order 必須唯一 (must be unique) — Tier 3 新人必須指定 Mentor (Tier 3 requires a Mentor)。
      </p>
    </div>
  );
}
