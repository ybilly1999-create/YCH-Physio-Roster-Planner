import { API_URL, SHEET_ID } from './config';

// ---------------- FAST READS via gviz JSON (direct from Sheet) ----------------
// gviz returns rows for a given sheet+range. We parse the wrapped JSON.
export async function gvizRead(sheetName, range) {
  const q = encodeURIComponent('select *');
  let url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?sheet=${encodeURIComponent(sheetName)}&tqx=out:json`;
  if (range) url += `&range=${encodeURIComponent(range)}`;
  const res = await fetch(url);
  const text = await res.text();
  // strip /*O_o*/\ngoogle.visualization.Query.setResponse( ... );
  const json = JSON.parse(text.substring(text.indexOf('{'), text.lastIndexOf('}') + 1));
  const cols = json.table.cols.map(c => (c.label || c.id || '').trim());
  const rows = json.table.rows.map(r => {
    const o = {};
    (r.c || []).forEach((cell, i) => { o[cols[i] || ('col' + i)] = cell ? cell.v : null; });
    return o;
  });
  return { cols, rows };
}

// ---------------- API WRITES via Apps Script Web App ----------------
export async function apiGet(action, params = {}) {
  const qs = new URLSearchParams({ action, ...params }).toString();
  const res = await fetch(`${API_URL}?${qs}`);
  return res.json();
}
export async function apiPost(action, body = {}, token) {
  const res = await fetch(API_URL, {
    method: 'POST',
    // text/plain avoids CORS preflight with Apps Script
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, token, ...body }),
  });
  return res.json();
}

// Convenience read wrappers (prefer apiGet for reliability; gviz for speed)
export const getStaff     = () => apiGet('getStaff');
export const getHolidays  = () => apiGet('getHolidays');
export const getCalendar  = (year, from, to) => apiGet('getCalendar', { year, ...(from && { from }), ...(to && { to }) });
export const getMakeup    = (type) => apiGet('getMakeup', { type });
export const getRollcall  = (date) => apiGet('getRollcall', { date });
export const getMeta      = () => apiGet('getMeta');
