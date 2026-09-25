/*
 * The super admin shell — sidebar, top bar, outlet. A trimmed mirror of
 * app/AppShell.jsx: same "guard once here, not per-page" reasoning, far
 * fewer nav items since there's no business context to switch between.
 */
import { NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAdminAuth } from './AdminAuthContext.jsx';
import { Button, Logo } from '../components/ui.jsx';

const NAV = [
  { to: '/superadmin', label: 'Overview', end: true },
  { to: '/superadmin/businesses', label: 'Businesses' },
  { to: '/superadmin/plans', label: 'Plans' }
];

const AdminShell = () => {
  const { admin, loading, signOut } = useAdminAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="flex min-h-full items-center justify-center">
        <p className="text-sm text-ink-400">Loading…</p>
      </div>
    );
  }

  if (!admin) {
    return <Navigate to="/superadmin/login" replace state={{ from: location.pathname }} />;
  }

  const linkClass = ({ isActive }) =>
    `block rounded-lg px-3 py-2 text-sm transition-colors ${
      isActive ? 'bg-brand-50 font-semibold text-brand-600' : 'text-ink-700 hover:bg-surface-2'
    }`;

  return (
    <div className="flex min-h-full">
      <aside className="hidden w-60 shrink-0 border-r border-line bg-surface/60 backdrop-blur-xl lg:block">
        <div className="flex h-14 items-center px-5"><Logo /></div>
        <p className="px-5 pb-2 text-xs font-semibold uppercase tracking-[0.16em] text-ink-400">
          Platform admin
        </p>
        <nav className="space-y-0.5 px-3 pb-6">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={linkClass}>
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between gap-3 border-b border-line bg-surface/70 px-5 backdrop-blur-xl">
          <p className="text-sm font-semibold text-ink-900 lg:hidden">FlowXP Admin</p>
          <div className="flex items-center gap-2 lg:ml-auto">
            <span className="hidden text-sm text-ink-500 sm:inline">{admin.email}</span>
            <Button onClick={signOut} variant="ghost" size="sm">Sign out</Button>
          </div>
        </header>

        <main className="flex-1 bg-surface-2 p-5 sm:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default AdminShell;
