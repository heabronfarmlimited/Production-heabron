import { useState } from 'react';
import { NavLink, useNavigate, Outlet } from 'react-router-dom';
import * as Icons from 'lucide-react';
import { Menu, X, LogOut, ChevronDown, Bell } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { BRAND } from '@/lib/brand';
import { cn, initials } from '@/lib/utils';
import { NotificationBell } from '@/components/shared/NotificationBell';

export function AppShell({ nav, audience }) {
  const navigate = useNavigate();
  const { user, partner, logout } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <div className="min-h-screen flex bg-bone">
      {/* Sidebar */}
      <aside
        className={cn(
          'fixed md:sticky top-0 inset-y-0 left-0 z-30 w-72 bg-white border-r border-whisper/70 transform transition-transform duration-300 md:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
          'flex flex-col h-screen'
        )}
      >
        {/* Brand */}
        <div className="px-6 py-6 flex items-center gap-3 border-b border-whisper/70">
          {audience === 'partner' && partner?.logoUrl ? (
            <img src={partner.logoUrl} alt={partner.organizationName} className="size-11 object-contain rounded-xl bg-forest-50 p-1" />
          ) : (
            <img src={BRAND.logoUrl} alt={BRAND.name} className="size-11 object-contain" />
          )}
          <div className="min-w-0">
            <p className="font-display text-base font-semibold text-ink leading-tight truncate">
              {audience === 'partner' && partner?.organizationName ? partner.organizationName : BRAND.shortName}
            </p>
            <p className="text-[11px] uppercase tracking-widest text-smoke">
              {audience === 'admin' ? 'Admin Portal' : 'Partner Portal'}
            </p>
          </div>
          <button
            className="ml-auto md:hidden text-smoke"
            onClick={() => setMobileOpen(false)}
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
          {nav.map((item) => {
            const Icon = Icons[item.icon] || Icons.Circle;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={() => setMobileOpen(false)}
                className={({ isActive }) => isActive ? 'nav-link-active' : 'nav-link'}
              >
                <Icon className="size-4 shrink-0" />
                <span className="flex-1">{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="px-3 py-4 border-t border-whisper/70 text-[11px] text-smoke">
          <p className="px-3.5">© {new Date().getFullYear()} Heabron Farm</p>
          <p className="px-3.5 mt-0.5">v1.0.0</p>
        </div>
      </aside>

      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-20 bg-ink/40" onClick={() => setMobileOpen(false)} />
      )}

      {/* Main */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-10 bg-bone/90 backdrop-blur-md border-b border-whisper/60">
          <div className="flex items-center gap-3 px-4 md:px-8 h-16">
            <button
              className="md:hidden text-smoke"
              onClick={() => setMobileOpen(true)}
            >
              <Menu className="size-5" />
            </button>
            <div className="flex-1" />
            <NotificationBell audience={audience} />
            {/* User menu */}
            <div className="relative">
              <button
                onClick={() => setUserMenuOpen((v) => !v)}
                className="flex items-center gap-2.5 pl-2 pr-3 py-1.5 rounded-xl hover:bg-white transition"
              >
                <div className="size-9 rounded-lg bg-forest-500 text-white font-semibold flex items-center justify-center text-xs">
                  {initials(user?.fullName || user?.email)}
                </div>
                <div className="hidden sm:block text-left">
                  <p className="text-sm font-semibold text-ink leading-tight max-w-[10rem] truncate">{user?.fullName || user?.email}</p>
                  <p className="text-[11px] text-smoke capitalize">{user?.role?.replace('_', ' ')}</p>
                </div>
                <ChevronDown className="size-4 text-smoke" />
              </button>
              {userMenuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setUserMenuOpen(false)} />
                  <div className="absolute right-0 top-full mt-2 w-56 bg-white rounded-xl shadow-elev border border-whisper/60 py-1.5 z-20 animate-fade-in">
                    <div className="px-4 py-3 border-b border-whisper/60">
                      <p className="text-sm font-semibold text-ink truncate">{user?.fullName}</p>
                      <p className="text-xs text-smoke truncate">{user?.email}</p>
                    </div>
                    <button
                      onClick={() => { setUserMenuOpen(false); navigate(audience === 'admin' ? '/admin/settings' : '/partner/settings'); }}
                      className="w-full text-left px-4 py-2 text-sm hover:bg-bone transition"
                    >
                      Settings
                    </button>
                    <button
                      onClick={handleLogout}
                      className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition"
                    >
                      <LogOut className="size-4" /> Sign out
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 px-4 md:px-8 py-6 md:py-10 max-w-[1600px] w-full mx-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
