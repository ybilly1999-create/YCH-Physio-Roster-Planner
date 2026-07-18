import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { getHolidays, apiPost } from '../lib/api';
import { Loader2, AlertTriangle, Download, Plus, Trash2, Save, CheckCircle2, X } from 'lucide-react';

export default function Holidays() {
  const { token } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [rows, setRows] = useState([]);
  const [importYear, setImportYear] = useState(new Date().getFullYear());
  const [importBusy, setImportBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const [editIdx, setEditIdx] = useState(null);
  const [editDraft, setEditDraft] = useState({ date: '', name: '' });
  const [newDraft, setNewDraft] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [rowBusy, setRowBusy] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await getHolidays();
      if (!res?.ok) { setError('無法載入假期資料 Failed to load holidays'); setRows([]); }
      else {
        const list = (res.rows || []).map(r => ({ date: String(r.Date || r.date || '').slice(0, 10), name: r.Name || r.name || '' }));
        list.sort((a, b) => a.date.localeCompare(b.date));
        setRows(list);
      }
    } catch (e) {
      setError(e.message || '網絡錯誤 Network error');
    } finally {
      setLoading(false);
    }
  }

  async function handleImport() {
    setImportBusy(true);
    setMsg(null);
    try {
      const res = await apiPost('importHolidays', { year: Number(importYear) }, token);
      if (res?.ok) {
        setMsg({ type: 'ok', text: `已匯入 ${res.count ?? ''} 個香港公眾假期。Imported ${res.count ?? ''} HK holidays.` });
        load();
      } else {
        setMsg({ type: 'error', text: res?.reason || res?.error || '匯入失敗 Import failed.' });
      }
    } catch (e) {
      setMsg({ type: 'error', text: e.message || '網絡錯誤 Network error' });
    } finally {
      setImportBusy(false);
    }
  }

  function startEdit(idx) {
    setEditIdx(idx);
    setEditDraft({ ...rows[idx] });
  }

  async function saveEdit(originalDate) {
    setRowBusy(true);
    setMsg(null);
    try {
      const res = await apiPost('editHoliday', { date: originalDate, newDate: editDraft.date, name: editDraft.name }, token);
      if (res?.ok) {
        setMsg({ type: 'ok', text: '已更新 Updated.' });
        setEditIdx(null);
        load();
      } else {
        setMsg({ type: 'error', text: res?.reason || res?.error || '更新失敗 Update failed.' });
      }
    } catch (e) {
      setMsg({ type: 'error', text: e.message || '網絡錯誤 Network error' });
    } finally {
      setRowBusy(false);
    }
  }

  async function addHoliday() {
    if (!newDraft?.date || !newDraft?.name) return;
    setRowBusy(true);
    setMsg(null);
    try {
      const res = await apiPost('addHoliday', { date: newDraft.date, name: newDraft.name }, token);
      if (res?.ok) {
        setMsg({ type: 'ok', text: '已新增 Added.' });
        setNewDraft(null);
        load();
      } else {
        setMsg({ type: 'error', text: res?.reason || res?.error || '新增失敗 Add failed.' });
      }
    } catch (e) {
      setMsg({ type: 'error', text: e.message || '網絡錯誤 Network error' });
    } finally {
      setRowBusy(false);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setRowBusy(true);
    setMsg(null);
    try {
      const res = await apiPost('deleteHoliday', { date: deleteTarget.date }, token);
      if (res?.ok) {
        setMsg({ type: 'ok', text: '已刪除 Deleted.' });
        setDeleteTarget(null);
        load();
      } else {
        setMsg({ type: 'error', text: res?.reason || res?.error || '刪除失敗 Delete failed.' });
      }
    } catch (e) {
      setMsg({ type: 'error', text: e.message || '網絡錯誤 Network error' });
    } finally {
      setRowBusy(false);
    }
  }

  return (
    <div className="space-y-4" data-testid="page-holidays">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-navy">公眾假期 Holidays</h1>
          <p className="text-sm text-muted">管理公眾假期日期及名稱 Manage public holiday dates and names</p>
        </div>
        <button className="btn btn-primary" onClick={() => setNewDraft({ date: '', name: '' })} data-testid="button-add-holiday">
          <Plus size={16} /> 新增 Add
        </button>
      </div>

      <div className="card p-4 flex flex-wrap items-end gap-2">
        <div>
          <label className="block text-xs text-muted mb-1">匯入年度 Import Year</label>
          <input type="number" className="input w-32" value={importYear} onChange={e => setImportYear(e.target.value)} data-testid="input-import-year" />
        </div>
        <button className="btn btn-ghost" onClick={handleImport} disabled={importBusy} data-testid="button-import-holidays">
          {importBusy ? <Loader2 className="animate-spin" size={16} /> : <Download size={16} />} 匯入香港假期 Import HK Holidays
        </button>
      </div>

      {msg && (
        <div className={`card p-3 text-sm flex items-center gap-2 ${msg.type === 'ok' ? 'text-green-700' : 'text-pink-700'}`} data-testid="text-holidays-msg">
          {msg.type === 'ok' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />} {msg.text}
        </div>
      )}

      {loading && (
        <div className="card p-10 flex items-center justify-center gap-2 text-muted" data-testid="holidays-loading">
          <Loader2 className="animate-spin" size={18} /> 載入中... Loading...
        </div>
      )}

      {!loading && error && (
        <div className="card p-6 text-center text-pink-700" data-testid="holidays-error">
          <AlertTriangle className="mx-auto mb-2" /> {error}
        </div>
      )}

      {!loading && !error && rows.length === 0 && !newDraft && (
        <div className="card p-10 text-center text-muted" data-testid="holidays-empty">
          尚無假期資料 No holiday records yet. 按「新增」或「匯入香港假期」開始。Click "Add" or "Import HK Holidays" to start.
        </div>
      )}

      {!loading && !error && (rows.length > 0 || newDraft) && (
        <div className="card p-2 overflow-x-auto">
          <table className="w-full text-sm min-w-[400px]" data-testid="table-holidays">
            <thead>
              <tr className="text-left text-xs text-muted border-b border-border">
                <th className="p-2">日期 Date</th>
                <th className="p-2">名稱 Name</th>
                <th className="p-2">操作 Actions</th>
              </tr>
            </thead>
            <tbody>
              {newDraft && (
                <tr className="border-b border-border bg-primary/5" data-testid="row-new-holiday">
                  <td className="p-2"><input type="date" className="input" value={newDraft.date} onChange={e => setNewDraft(d => ({ ...d, date: e.target.value }))} data-testid="input-new-holiday-date" /></td>
                  <td className="p-2"><input className="input" placeholder="假期名稱 Holiday name" value={newDraft.name} onChange={e => setNewDraft(d => ({ ...d, name: e.target.value }))} data-testid="input-new-holiday-name" /></td>
                  <td className="p-2 flex gap-1">
                    <button className="btn btn-primary !px-2 !py-1" onClick={addHoliday} disabled={rowBusy} data-testid="button-confirm-add-holiday"><Save size={14} /></button>
                    <button className="btn btn-ghost !px-2 !py-1" onClick={() => setNewDraft(null)} data-testid="button-cancel-add-holiday"><X size={14} /></button>
                  </td>
                </tr>
              )}
              {rows.map((row, idx) => (
                <tr key={row.date} className="border-b border-border last:border-0" data-testid={`row-holiday-${row.date}`}>
                  {editIdx === idx ? (
                    <>
                      <td className="p-2"><input type="date" className="input" value={editDraft.date} onChange={e => setEditDraft(d => ({ ...d, date: e.target.value }))} data-testid={`input-edit-holiday-date-${idx}`} /></td>
                      <td className="p-2"><input className="input" value={editDraft.name} onChange={e => setEditDraft(d => ({ ...d, name: e.target.value }))} data-testid={`input-edit-holiday-name-${idx}`} /></td>
                      <td className="p-2 flex gap-1">
                        <button className="btn btn-primary !px-2 !py-1" onClick={() => saveEdit(row.date)} disabled={rowBusy} data-testid={`button-save-holiday-${idx}`}><Save size={14} /></button>
                        <button className="btn btn-ghost !px-2 !py-1" onClick={() => setEditIdx(null)} data-testid={`button-cancel-edit-holiday-${idx}`}><X size={14} /></button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="p-2 text-text font-medium">{row.date}</td>
                      <td className="p-2 text-text">{row.name}</td>
                      <td className="p-2 flex gap-1">
                        <button className="btn btn-ghost !px-2 !py-1 text-xs" onClick={() => startEdit(idx)} data-testid={`button-edit-holiday-${idx}`}>編輯 Edit</button>
                        <button className="btn btn-ghost !px-2 !py-1 text-xs text-pink-700" onClick={() => setDeleteTarget(row)} data-testid={`button-delete-holiday-${idx}`}><Trash2 size={14} /></button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={() => setDeleteTarget(null)}>
          <div className="card p-5 w-full max-w-sm" onClick={e => e.stopPropagation()} data-testid="dialog-delete-holiday">
            <h3 className="text-sm font-bold text-navy mb-2">確認刪除？ Confirm delete?</h3>
            <p className="text-sm text-muted mb-4">{deleteTarget.date} — {deleteTarget.name}</p>
            <div className="flex gap-2">
              <button className="btn btn-ghost flex-1 justify-center" onClick={() => setDeleteTarget(null)} data-testid="button-cancel-delete-holiday">取消 Cancel</button>
              <button className="btn btn-primary flex-1 justify-center" onClick={confirmDelete} disabled={rowBusy} data-testid="button-confirm-delete-holiday">
                {rowBusy ? <Loader2 className="animate-spin" size={14} /> : '刪除 Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
