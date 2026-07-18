import { Router, Route, Switch, Link, useLocation } from 'wouter';
import { useHashLocation } from 'wouter/use-hash-location';
import { useState } from 'react';
import { AuthProvider, useAuth } from './lib/auth';
import {
  LayoutDashboard, CalendarDays, ClipboardCheck, Wand2, Users,
  RefreshCw, ArrowLeftRight, CalendarPlus, HelpCircle, LogOut, Menu
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
  { href: '/', label: 'Dashboard', icon: LayoutDashboard, role: 'all' },
  { href: '/calendar', label: 'Calendar', icon: CalendarDays, role: 'all' },
  { href: '/rollcall', label: 'Roll-call', icon: ClipboardCheck, role: 'all' },
  { href: '/makeup', label: 'Make-up List', icon: RefreshCw, role: 'all' },
  { href: '/swaps', label: 'Swaps', icon: ArrowLeftRight, role: 'all' },
  { href: '/generate', label: 'Generate', icon: Wand2, role: 'admin' },
  { href: '/staff', label: 'Staff Master', icon: Users, role: 'admin' },
  { href: '/holidays', label: 'Holidays', icon: CalendarPlus, role: 'admin' },
  { href: '/help', label: 'Help', icon: HelpCircle, role: 'all' },
];

function Shell() {
  const { role, isAdmin, logout } = useAuth();
  const [loc] = useLocation();
  const [open, setOpen] = useState(false);

  if (!role) return <Login />;

  const items = NAV.filter(n => n.role === 'all' || isAdmin);
  return (
    <div className="min-h-screen flex bg-bg">
      {/* Sidebar */}
      <aside className={`${open ? 'block' : 'hidden'} md:block w-64 shrink-0 border-r bg-surface fixed md:static h-full z-20`}>
        <div className="p-4 border-b">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-white font-bold text-sm">Y</div>
            <div>
              <div className="font-bold text-navy leading-tight text-sm">YCH Physio Dept</div>
              <div className="text-xs text-muted">Roster Management System</div>
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
        <div className="p-2 absolute bottom-0 w-full border-t">
          <div className="px-3 py-2 text-xs text-muted">{isAdmin ? 'Admin' : 'Staff'}</div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 min-w-0">
        <header className="flex items-center gap-3 p-3 border-b bg-surface sticky top-0 z-10">
          <button onClick={() => setOpen(o => !o)} className="btn btn-ghost md:hidden" data-testid="button-menu"><Menu size={18} /></button>
          <span className="font-bold text-navy text-sm md:text-base">YCH Physio Dept Roster Management System</span>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-xs text-muted hidden sm:inline">{isAdmin ? 'Admin' : 'Staff'}</span>
            <button onClick={logout} className="btn btn-ghost" data-testid="button-logout">
              <LogOut size={16} /> Logout
            </button>
          </div>
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
            <Route>404 — Page not found</Route>
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
