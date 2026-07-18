import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { getMakeup, apiPost } from '../lib/api';
import { Loader2, AlertTriangle, Star, RotateCcw } from 'lucide-react';

const TABS = [
  { key: 'sick', tc: '病假', en: 'Sick' },
  { key: 'typhoon', tc: '颱風', en: 'Typhoon' },
  { key: 'exwx', tc: '惡劣天氣', en: 'Extreme Wx' },
];

function pad(n) { return String(n).padStart(2, '0'); }
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function Makeup() {
  const { isAdmin, token } = useAuth();
  const [tab, setTab] = useState('sick');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [rows, setRows] = useState([]);
  const [dialog, setDialog] = useState(null); // {abbr, name}
  const [backDate, setBackDate] = useState(todayStr());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => { load(tab); }, [tab]);

  async function load(type) {
    setLoading(true);
    setError(null);
    setMsg(null);
    try {
      const res = await getMakeup(type);
      if (!res?.ok) { setError('無法載入名單 Failed to load makeup list'); setRows([]); }
      else setRows(res.rows || []);
    } catch (e) {
      setError(e.message || '網絡錯誤 Network error');
    } finally {
      setLoading(false);
    }
  }

  function openDialog(row) {
    setDialog({ abbr: row.Abbrev || row.abbr, name: row.Name || row.name });
    setBackDate(todayStr());
  }

  async function confirmRecordBack() {
    if (!dialog) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await apiPost('recordBack', { type: tab, abbr: dialog.abbr, date: backDate }, token);
      if (res?.ok) {
        setMsg({ type: 'ok', text: `${dialog.name} 已記錄補返，輪次已更新。Recorded — round updated.` });
        setDialog(null);
        load(tab);
      } else {
        setMsg({ type: 'error', text: res?.reason || res?.error || '操作失敗 Failed.' });
      }
    } catch (e) {
      setMsg({ type: 'error', text: e.message || '網絡錯誤 Network error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4" data-testid="page-makeup">
      <div>
        <h1 className="text-xl font-bold text-navy">補更名單 Make-up Lists</h1>
        <p className="text-sm text-muted">依輪次及次序排列的補更名單 Round-based make-up duty lists</p>
      </div>

      <div className="card p-3 text-sm text-text">
        <strong>輪次模型 Round model：</strong> 名單依「輪次 Round」升序，再依「次序 Order」升序排列；「Next-10」為本輪尚未補更、排序最前的十位。當有人補返（Record back）時，其輪次會 +1，並移到名單後方。
        <br className="hidden md:block" />
        The list is sorted by Round ascending, then Order ascending. "Next-10" are the first ten not-yet-backed staff in the current round. Recording a back-duty increments that staff's Round, moving them later in the list.
      </div>

      <div className="flex gap-2" data-testid="tabs-makeup">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`btn ${tab === t.key ? 'btn-primary' : 'btn-ghost'}`}
            data-testid={`tab-${t.key}`}
          >
            {t.tc} {t.en}
          </button>
        ))}
      </div>

      {loading && (
        <div className="card p-10 flex items-center justify-center gap-2 text-muted" data-testid="makeup-loading">
          <Loader2 className="animate-spin" size={18} /> 載入中... Loading...
        </div>
      )}

      {!loading && error && (
        <div className="card p-6 text-center text-pink-700" data-testid="makeup-error">
          <AlertTriangle className="mx-auto mb-2" /> {error}
        </div>
      )}

      {!loading && !error && rows.length === 0 && (
        <div className="card p-10 text-center text-muted" data-testid="makeup-empty">
          此名單暫無資料 No data for this list.
        </div>
      )}

      {!loading && !error && rows.length > 0 && (
        <div className="card p-2 overflow-x-auto">
          <table className="w-full text-sm min-w-[480px]" data-testid="table-makeup">
            <thead>
              <tr className="text-left text-xs text-muted border-b border-border">
                <th className="p-2">#</th>
                <th className="p-2">簡稱 Abbrev</th>
                <th className="p-2">姓名 Name</th>
                <th className="p-2">輪次 Round</th>
                <th className="p-2">次序 Order</th>
                <th className="p-2">操作 Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => {
                const isNext10 = idx < 10;
                return (
                  <tr key={idx} className={`border-b border-border last:border-0 ${isNext10 ? 'bg-primary/5' : ''}`} data-testid={`row-makeup-${row.Abbrev || row.abbr || idx}`}>
                    <td className="p-2 text-muted">{idx + 1}</td>
                    <td className="p-2 font-medium text-text">
                      {isNext10 && <Star size={12} className="inline mr-1 text-primary" fill="currentColor" />}
                      {row.Abbrev || row.abbr}
                    </td>
                    <td className="p-2 text-text">{row.Name || row.name}</td>
                    <td className="p-2">{row.Round ?? row.round ?? row[`${tab.toUpperCase()}_Round`] ?? '—'}</td>
                    <td className="p-2">{row.Order ?? row.order ?? row[`${tab.toUpperCase()}_Order`] ?? '—'}</td>
                    <td className="p-2">
                      <button className="btn btn-ghost !px-2 !py-1 text-xs" onClick={() => openDialog(row)} data-testid={`button-record-back-${row.Abbrev || row.abbr || idx}`}>
                        <RotateCcw size={12} /> 補返 Record back
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length > 10 && (
            <p className="text-xs text-muted p-2">★ 標示前 10 位為 Next-10 建議。Stars mark the Next-10 suggested staff.</p>
          )}
        </div>
      )}

      {msg && !dialog && (
        <div className={`card p-3 text-sm ${msg.type === 'ok' ? 'text-green-700' : 'text-pink-700'}`} data-testid="text-makeup-msg">{msg.text}</div>
      )}

      {dialog && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={() => setDialog(null)}>
          <div className="card p-5 w-full max-w-sm" onClick={e => e.stopPropagation()} data-testid="dialog-record-back">
            <h3 className="text-sm font-bold text-navy mb-2">記錄補返 Record Back — {dialog.name}</h3>
            <label className="block text-xs text-muted mb-1">補返日期 Back date</label>
            <input type="date" className="input mb-4" value={backDate} onChange={e => setBackDate(e.target.value)} data-testid="input-back-date" />
            {msg && msg.type === 'error' && <p className="text-xs text-pink-700 mb-2">{msg.text}</p>}
            <div className="flex gap-2">
              <button className="btn btn-ghost flex-1 justify-center" onClick={() => setDialog(null)} data-testid="button-cancel-record-back">取消 Cancel</button>
              <button className="btn btn-primary flex-1 justify-center" onClick={confirmRecordBack} disabled={busy} data-testid="button-confirm-record-back">
                {busy ? <Loader2 className="animate-spin" size={14} /> : '確認 Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
