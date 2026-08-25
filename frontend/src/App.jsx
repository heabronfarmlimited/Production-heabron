import { useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth, ADMIN_ROLES, PARTNER_ROLES } from '@/lib/auth';
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
          Your account doesn't have an admin or partner role
          {role ? <> (current role: <span className="font-mono text-ink">{String(role)}</span>)</> : ' (no role assigned)'}.
          Ask a platform administrator to assign your role, then sign in again.
        </p>
        <button
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
        <Route path="financing" element={<FinancingPage />} />
        <Route path="financing/:requestId" element={<FinancingDetailPage />} />
        <Route path="partners" element={<PartnersPage />} />
        <Route path="partners/:partnerId" element={<PartnerDetailPage />} />
        <Route path="benchmarks" element={<BenchmarksPage />} />
        <Route path="wallets" element={<WalletsPage />} />
        <Route path="activity" element={<ActivityPage />} />
        <Route path="notifications" element={<NotificationsPage audience="admin" />} />
        <Route path="settings" element={<SettingsPage />} />
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
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
