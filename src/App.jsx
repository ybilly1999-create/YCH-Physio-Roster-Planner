import { Router, Route, Switch, Link, useLocation } from 'wouter';
import { useHashLocation } from 'wouter/use-hash-location';
import { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './lib/auth';
import {
  LayoutDashboard, CalendarDays, ClipboardCheck, Wand2, Users,
  RefreshCw, ArrowLeftRight, CalendarPlus, HelpCircle, LogOut, Moon, Sun, Menu
} from 'lucide-react';

import Dashboard from './pages/Dashboard';
import CalendarPage from './pages/CalendarPage';
import Rollcall from './pages/Rollcall';
import Generate from './pages/Generate';
import StaffMaster from './pages/StaffMaster';
import Makeup from './pages/Makeup';
import Swaps from './pages/Swaps';
import Holidays from './pages/Holidays';
import Help from './pages/Help';
import Login from './pages/Login';

const NAV = [
  { href: '/', label: '總覽 Dashboard', icon: LayoutDashboard, role: 'all' },
  { href: '/calendar', label: '排更表 Calendar', icon: CalendarDays, role: 'all' },
  { href: '/rollcall', label: '點名 Roll-call', icon: ClipboardCheck, role: 'all' },
  { href: '/makeup', label: '補更名單 Make-up', icon: RefreshCw, role: 'all' },
  { href: '/swaps', label: '換更 Swaps', icon: ArrowLeftRight, role: 'all' },
  { href: '/generate', label: '生成 Generate', icon: Wand2, role: 'admin' },
  { href: '/staff', label: '員工資料 Staff', icon: Users, role: 'admin' },
  { href: '/holidays', label: '公眾假期 Holidays', icon: CalendarPlus, role: 'admin' },
  { href: '/help', label: '說明 Help', icon: HelpCircle, role: 'all' },
];

function Shell() {
  const { role, isAdmin, logout } = useAuth();
  const [loc] = useLocation();
  const [dark, setDark] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const d = window.matchMedia('(prefers-color-scheme: dark)').matches;
    setDark(d);
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  if (!role) return <Login />;

  const items = NAV.filter(n => n.role === 'all' || isAdmin);
  return (
    <div className="min-h-screen flex">
      {/* Sidebar */}
      <aside className={`${open ? 'block' : 'hidden'} md:block w-64 shrink-0 border-r bg-surface fixed md:static h-full z-20`}>
        <div className="p-4 border-b">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-white font-bold text-sm">物</div>
            <div>
              <div className="font-bold text-navy leading-tight">YCH Physio</div>
              <div className="text-xs text-muted">Roster Platform</div>
            </div>
          </div>
        </div>
        <nav className="p-2 space-y-1">
          {items.map(n => {
            const Icon = n.icon;
            const active = loc === n.href;
            return (
              <Link key={n.href} href={n.href} onClick={() => setOpen(false)}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition
                ${active ? 'bg-primary text-white' : 'text-text hover:bg-bg'}`}
                data-testid={`nav-${n.href.replace('/', '') || 'home'}`}>
                <Icon size={18} /> {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="p-2 mt-auto absolute bottom-0 w-full border-t">
          <div className="px-3 py-2 text-xs text-muted">身分：{isAdmin ? 'Admin 管理員' : 'Staff 員工'}</div>
          <button onClick={() => setDark(d => !d)} className="btn btn-ghost w-full mb-1" data-testid="button-theme">
            {dark ? <Sun size={16} /> : <Moon size={16} />} {dark ? '淺色' : '深色'}
          </button>
          <button onClick={logout} className="btn btn-ghost w-full" data-testid="button-logout">
            <LogOut size={16} /> 登出 Logout
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 min-w-0">
        <header className="md:hidden flex items-center gap-3 p-3 border-b bg-surface sticky top-0 z-10">
          <button onClick={() => setOpen(o => !o)} className="btn btn-ghost" data-testid="button-menu"><Menu size={18} /></button>
          <span className="font-bold text-navy">YCH Physio Roster</span>
        </header>
        <main className="p-4 md:p-6 max-w-7xl mx-auto pb-24">
          <Switch>
            <Route path="/" component={Dashboard} />
            <Route path="/calendar" component={CalendarPage} />
            <Route path="/rollcall" component={Rollcall} />
            <Route path="/makeup" component={Makeup} />
            <Route path="/swaps" component={Swaps} />
            <Route path="/generate" component={isAdmin ? Generate : Dashboard} />
            <Route path="/staff" component={isAdmin ? StaffMaster : Dashboard} />
            <Route path="/holidays" component={isAdmin ? Holidays : Dashboard} />
            <Route path="/help" component={Help} />
            <Route>404 — 找不到頁面</Route>
          </Switch>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Router hook={useHashLocation}>
        <Shell />
      </Router>
    </AuthProvider>
  );
}
