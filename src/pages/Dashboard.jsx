import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { getMeta, getStaff, getCalendar } from '../lib/api';
import { COLORS } from '../lib/config';
import { Users, CalendarDays, AlertTriangle, CalendarClock, ClipboardCheck, ArrowRight } from 'lucide-react';

function fmtDate(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

const LEGEND_ITEMS = [
  { key: 'confirmed', tc: '已確認', en: 'Confirmed' },
  { key: 'sick', tc: '請病假', en: 'Sick' },
  { key: 'substitute', tc: '替更', en: 'Substitute' },
  { key: 'shs', tc: '特別更', en: 'SHS' },
  { key: 'opd', tc: '門診', en: 'OPD' },
  { key: 'unconfirmed', tc: '未確認', en: 'Unconfirmed' },
];

export default function Dashboard() {
  const [state, setState] = useState({ loading: true, error: null, meta: null, staff: [], calendar: [] });

  useEffect(() => {
    let cancelled = false;
    const today = new Date();
    const from = fmtDate(today);
    const upTo = new Date(today);
    upTo.setDate(upTo.getDate() + 14);
    const to = fmtDate(upTo);
    const year = today.getFullYear();

    (async () => {
      try {
        const [metaRes, staffRes, calRes] = await Promise.all([
          getMeta(),
          getStaff(),
          getCalendar(year, from, to),
        ]);
        if (cancelled) return;
        if (!metaRes?.ok || !staffRes?.ok || !calRes?.ok) {
          setState({ loading: false, error: '無法載入資料 Failed to load dashboard data', meta: null, staff: [], calendar: [] });
          return;
        }
        setState({
          loading: false,
          error: null,
          meta: metaRes,
          staff: staffRes.rows || [],
          calendar: calRes.rows || [],
        });
      } catch (e) {
        if (!cancelled) setState({ loading: false, error: e.message || '網絡錯誤 Network error', meta: null, staff: [], calendar: [] });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const { loading, error, meta, staff, calendar } = state;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted" data-testid="dashboard-loading">
        總覽載入中... Loading dashboard...
      </div>
    );
  }

  if (error) {
    return (
      <div className="card p-6 text-center text-pink-700" data-testid="dashboard-error">
        <AlertTriangle className="mx-auto mb-2" />
        {error}
      </div>
    );
  }

  const today = new Date();
  const todayStr = fmtDate(today);
  const activeStaffCount = staff.filter(s => {
    const v = s.Active ?? s.active ?? s['Dept Active'];
    return v === true || v === 'Y' || v === 'y' || v === 1;
  }).length;

  const todayRows = calendar.filter(r => (r.Date || r.date) && String(r.Date || r.date).slice(0, 10) === todayStr);
  const todayCount = todayRows.reduce((acc, r) => {
    const ipd = r.IPD || r.ipd || [];
    const list = Array.isArray(ipd) ? ipd : (typeof ipd === 'string' ? ipd.split(',').filter(Boolean) : []);
    return acc + list.length;
  }, 0);

  const needsAdminCount = calendar.filter(r => {
    const status = (r.Status || r.status || r.Note || r.note || '').toString().toUpperCase();
    return status.includes('NEEDS ADMIN');
  }).length;

  const currentYear = meta?.years?.[0] ?? meta?.currentYear ?? today.getFullYear();

  const weekEnd = new Date(today);
  weekEnd.setDate(weekEnd.getDate() + 7);
  const weekRows = calendar
    .filter(r => {
      const d = new Date(r.Date || r.date);
      return d >= today && d <= weekEnd;
    })
    .sort((a, b) => new Date(a.Date || a.date) - new Date(b.Date || b.date));

  return (
    <div className="space-y-6" data-testid="page-dashboard">
      <div>
        <h1 className="text-xl font-bold text-navy">總覽 Dashboard</h1>
        <p className="text-sm text-muted">YCH Physio Dept 排更系統一覽 — Roster system overview</p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="card p-4" data-testid="kpi-active-staff">
          <div className="flex items-center gap-2 text-muted text-xs mb-1"><Users size={14} /> 在職員工 Active Staff</div>
          <div className="text-xl font-bold text-text">{activeStaffCount}</div>
        </div>
        <div className="card p-4" data-testid="kpi-today-roster">
          <div className="flex items-center gap-2 text-muted text-xs mb-1"><CalendarDays size={14} /> 今日更表 Today's Roster</div>
          <div className="text-xl font-bold text-text">{todayCount}</div>
        </div>
        <div className="card p-4" data-testid="kpi-needs-admin">
          <div className="flex items-center gap-2 text-muted text-xs mb-1"><AlertTriangle size={14} /> 待管理員處理 Needs Admin</div>
          <div className="text-xl font-bold text-text">{needsAdminCount}</div>
        </div>
        <div className="card p-4" data-testid="kpi-current-year">
          <div className="flex items-center gap-2 text-muted text-xs mb-1"><CalendarClock size={14} /> 當前年度 Current Year</div>
          <div className="text-xl font-bold text-text">{currentYear}</div>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {/* This week mini list */}
        <div className="card p-4" data-testid="card-this-week">
          <h2 className="text-sm font-bold text-navy mb-3">本週更表 This Week</h2>
          {weekRows.length === 0 ? (
            <p className="text-sm text-muted" data-testid="text-week-empty">本週暫無排更資料 No roster data for this week.</p>
          ) : (
            <ul className="space-y-2 max-h-64 overflow-y-auto">
              {weekRows.map((r, i) => {
                const dateStr = String(r.Date || r.date).slice(0, 10);
                const ipd = r.IPD || r.ipd || [];
                const list = Array.isArray(ipd) ? ipd : (typeof ipd === 'string' ? ipd.split(',').filter(Boolean) : []);
                return (
                  <li key={i} className="flex items-center justify-between text-sm border-b border-border pb-1 last:border-0" data-testid={`week-row-${dateStr}`}>
                    <span className="text-text font-medium">{dateStr}</span>
                    <span className="text-muted truncate ml-2">{list.join(', ') || '—'}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Colour legend */}
        <div className="card p-4" data-testid="card-legend">
          <h2 className="text-sm font-bold text-navy mb-3">顏色圖例 Colour Legend</h2>
          <ul className="space-y-2">
            {LEGEND_ITEMS.map(item => (
              <li key={item.key} className="flex items-center gap-2 text-sm" data-testid={`legend-${item.key}`}>
                <span
                  className="w-5 h-5 rounded border border-border shrink-0"
                  style={{ background: COLORS[item.key].bg }}
                />
                <span className="text-text">{item.tc} {item.en}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Quick links */}
      <div className="grid sm:grid-cols-2 gap-3">
        <Link href="/calendar" className="card p-4 flex items-center justify-between hover:bg-bg transition" data-testid="link-quick-calendar">
          <span className="flex items-center gap-2 text-text font-medium"><CalendarDays size={16} /> 排更表 Calendar</span>
          <ArrowRight size={16} className="text-muted" />
        </Link>
        <Link href="/rollcall" className="card p-4 flex items-center justify-between hover:bg-bg transition" data-testid="link-quick-rollcall">
          <span className="flex items-center gap-2 text-text font-medium"><ClipboardCheck size={16} /> 點名 Roll-call</span>
          <ArrowRight size={16} className="text-muted" />
        </Link>
      </div>
    </div>
  );
}
