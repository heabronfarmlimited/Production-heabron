import { Component, useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
// Role flags come from the store (which derives them from the live /auth/me
// role), so the raw role lists are not needed here.
import { useAuth } from '@/lib/auth';
import { AppShell } from '@/components/layout/AppShell';
import { NAV_ADMIN, NAV_PARTNER } from '@/lib/brand';

import LoginPage from '@/pages/auth/LoginPage';
import ForgotPasswordPage from '@/pages/auth/ForgotPasswordPage';
import ChangePasswordPage from '@/pages/auth/ChangePasswordPage';

import AdminDashboardPage from '@/pages/admin/AdminDashboardPage';
import AgentsPage from '@/pages/admin/AgentsPage';
import ApplicationsPage from '@/pages/admin/ApplicationsPage';
import CooperativesPage from '@/pages/admin/CooperativesPage';
import FarmersPage from '@/pages/admin/FarmersPage';
import FarmerDetailPage from '@/pages/admin/FarmerDetailPage';
import CooperativeDetailPage from '@/pages/admin/CooperativeDetailPage';
import CreditPage from '@/pages/admin/CreditPage';
import FinancingPage from '@/pages/admin/FinancingPage';
import FinancingDetailPage from '@/pages/admin/FinancingDetailPage';
import PartnersPage from '@/pages/admin/PartnersPage';
import PartnerDetailPage from '@/pages/admin/PartnerDetailPage';
import BenchmarksPage from '@/pages/admin/BenchmarksPage';
import WalletsPage from '@/pages/admin/WalletsPage';
import ActivityPage from '@/pages/admin/ActivityPage';
import SettingsPage from '@/pages/shared/SettingsPage';
import NotificationsPage from '@/pages/shared/NotificationsPage';

import PartnerDashboardPage from '@/pages/partner/PartnerDashboardPage';
import PartnerCooperativesPage from '@/pages/partner/PartnerCooperativesPage';
import PartnerFarmersPage from '@/pages/partner/PartnerFarmersPage';
import PartnerSearchPage from '@/pages/partner/PartnerSearchPage';
import PartnerFinancingPage from '@/pages/partner/PartnerFinancingPage';
import PartnerFinancingDetailPage from '@/pages/partner/PartnerFinancingDetailPage';
import PartnerPortfolioPage from '@/pages/partner/PartnerPortfolioPage';
import PartnerWatchlistPage from '@/pages/partner/PartnerWatchlistPage';
import PartnerCreditReportPage from '@/pages/partner/PartnerCreditReportPage';
import PartnerProfilePage from '@/pages/partner/PartnerProfilePage';

/**
 * FIXED — there was no error boundary anywhere in the tree, so any render-time
 * exception (a row shape the page didn't expect, a null deref in a chart) blanked
 * the entire dashboard to a white screen with nothing in the UI to act on.
 */
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
     
    console.error('Unhandled UI error', error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="min-h-screen flex items-center justify-center bg-bone px-6">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-card p-8 text-center">
          <h1 className="font-display text-2xl font-semibold text-ink">Something went wrong</h1>
          <p className="text-smoke mt-3 text-sm">
            This screen hit an unexpected error. Reloading usually clears it — if it keeps
            happening, send the details below to support.
          </p>
          <pre className="mt-4 text-left text-[11px] bg-bone rounded-lg p-3 overflow-x-auto text-smoke">
            {String(this.state.error?.message || this.state.error)}
          </pre>
          <button type="button" onClick={() => window.location.reload()} className="btn-primary mt-6 inline-flex">
            Reload
          </button>
        </div>
      </div>
    );
  }
}

function Spinner() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-bone">
      <div className="size-10 rounded-full border-2 border-forest-200 border-t-forest-500 animate-spin" />
    </div>
  );
}

function NoAccess({ role }) {
  const { logout } = useAuth();
  return (
    <div className="min-h-screen flex items-center justify-center bg-bone px-6">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-card p-8 text-center">
        <h1 className="font-display text-2xl font-semibold text-ink">No portal access</h1>
        <p className="text-smoke mt-3 text-sm">
          Your account doesn&apos;t have an admin or partner role
          {role ? <> (current role: <span className="font-mono text-ink">{String(role)}</span>)</> : ' (no role assigned)'}.
          Ask a platform administrator to assign your role, then sign in again.
        </p>
        <button type="button"
          onClick={async () => { await logout(); window.location.href = '/login'; }}
          className="btn-primary mt-6 inline-flex"
        >
          Back to sign in
        </button>
      </div>
    </div>
  );
}

function RequireAdmin({ children }) {
  // The role is re-checked on every render (and re-derived from /auth/me on
  // each refreshMe), so a revoked admin loses the shell immediately — the nav
  // list in AppShell is gated on the same flags as a second line of defence.
  const { user, loading, isAdmin, isPartner, mustChangePassword } = useAuth();
  const location = useLocation();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  if (mustChangePassword && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }
  if (!isAdmin) {
    // Only send to the partner portal if they actually ARE a partner.
    // Otherwise (role missing/unknown) show an access screen — never bounce
    // back and forth, which white-screens the app.
    if (isPartner) return <Navigate to="/partner" replace />;
    return <NoAccess role={user.role} />;
  }
  return children;
}

function RequirePartner({ children }) {
  const { user, loading, isPartner, isAdmin, mustChangePassword } = useAuth();
  const location = useLocation();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  if (mustChangePassword && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }
  if (!isPartner) {
    if (isAdmin) return <Navigate to="/admin" replace />;
    return <NoAccess role={user.role} />;
  }
  return children;
}

function RootRedirect() {
  const { user, loading, isAdmin, isPartner, mustChangePassword } = useAuth();
  if (loading) return <Spinner />;
  if (!user) return <Navigate to="/login" replace />;
  if (mustChangePassword) return <Navigate to="/change-password" replace />;
  if (isAdmin) return <Navigate to="/admin" replace />;
  if (isPartner) return <Navigate to="/partner" replace />;
  return <Navigate to="/login" replace />;
}

export default function App() {
  const { hydrate } = useAuth();

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  return (
    <ErrorBoundary>
    <Routes>
      <Route path="/" element={<RootRedirect />} />

      <Route path="/login" element={<LoginPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/change-password" element={<ChangePasswordPage />} />

      {/* Admin shell */}
      <Route
        path="/admin"
        element={
          <RequireAdmin>
            <AppShell nav={NAV_ADMIN} audience="admin" />
          </RequireAdmin>
        }
      >
        <Route index element={<AdminDashboardPage />} />
        <Route path="agents" element={<AgentsPage />} />
        <Route path="applications" element={<ApplicationsPage />} />
        <Route path="cooperatives" element={<CooperativesPage />} />
        <Route path="farmers" element={<FarmersPage />} />
        <Route path="farmers/:farmerId" element={<FarmerDetailPage />} />
        <Route path="credit" element={<CreditPage />} />
        <Route path="credit/farmers/:farmerId" element={<FarmerDetailPage />} />
        <Route path="credit/cooperatives/:cooperativeId" element={<CooperativeDetailPage />} />
        {/* Cooperative pages link here directly; without this alias the row
            click on /admin/cooperatives fell through to the catch-all. */}
        <Route path="cooperatives/:cooperativeId" element={<CooperativeDetailPage />} />
        <Route path="financing" element={<FinancingPage />} />
        <Route path="financing/:requestId" element={<FinancingDetailPage />} />
        <Route path="partners" element={<PartnersPage />} />
        <Route path="partners/:partnerId" element={<PartnerDetailPage />} />
        <Route path="benchmarks" element={<BenchmarksPage />} />
        <Route path="wallets" element={<WalletsPage />} />
        <Route path="activity" element={<ActivityPage />} />
        <Route path="notifications" element={<NotificationsPage audience="admin" />} />
        <Route path="settings" element={<SettingsPage />} />
        {/* An unknown /admin/* path used to fall through to the global
            catch-all and bounce out of the portal entirely. */}
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Route>

      {/* Partner shell */}
      <Route
        path="/partner"
        element={
          <RequirePartner>
            <AppShell nav={NAV_PARTNER} audience="partner" />
          </RequirePartner>
        }
      >
        <Route index element={<PartnerDashboardPage />} />
        <Route path="cooperatives" element={<PartnerCooperativesPage />} />
        <Route path="farmers" element={<PartnerFarmersPage />} />
        <Route path="search" element={<PartnerSearchPage />} />
        <Route path="financing" element={<PartnerFinancingPage />} />
        <Route path="financing/:requestId" element={<PartnerFinancingDetailPage />} />
        <Route path="portfolio" element={<PartnerPortfolioPage />} />
        <Route path="watchlist" element={<PartnerWatchlistPage />} />
        <Route path="reports/farmer/:farmerId" element={<PartnerCreditReportPage type="farmer" />} />
        <Route path="reports/cooperative/:cooperativeId" element={<PartnerCreditReportPage type="cooperative" />} />
        <Route path="notifications" element={<NotificationsPage audience="partner" />} />
        <Route path="settings" element={<PartnerProfilePage />} />
        <Route path="*" element={<Navigate to="/partner" replace />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </ErrorBoundary>
  );
}
