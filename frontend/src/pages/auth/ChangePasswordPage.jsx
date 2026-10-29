import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Shield } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Input';
import { BRAND } from '@/lib/brand';

export default function ChangePasswordPage() {
  const navigate = useNavigate();
  const { user, loading, isPartner, isAdmin, refreshMe, logout } = useAuth();
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // FIXED — the route is outside the role guards, so hitting /change-password
  // while signed out rendered the whole form and then 401'd on submit.
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bone">
        <div className="size-10 rounded-full border-2 border-forest-200 border-t-forest-500 animate-spin" />
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;

  async function onSubmit(e) {
    e.preventDefault();
    if (newPassword !== confirm) return toast.error('Passwords do not match');
    if (newPassword.length < 8) return toast.error('Use at least 8 characters');
    if (newPassword === currentPassword) return toast.error('Choose a password different from the temporary one');
    setSubmitting(true);
    try {
      await api.post('/auth/change-password', { currentPassword, newPassword });
      toast.success('Password changed');
      await refreshMe();
      // FIXED — role was matched with startsWith('partner'), so anything that
      // wasn't a partner landed on /admin regardless of whether it had admin
      // rights. Send unknown roles to the root redirect, which decides.
      navigate(isPartner ? '/partner' : isAdmin ? '/admin' : '/', { replace: true });
    } catch {
      /* toasted by the api interceptor */
    } finally {
      setSubmitting(false);
    }
  }

  async function signOut() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-10 bg-bone">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 mb-8">
          <img src={BRAND.logoUrl} alt={BRAND.name} className="size-10" />
          <p className="font-display text-base font-semibold">{BRAND.shortName}</p>
        </div>
        <div className="card card-pad">
          <div className="size-12 rounded-xl bg-harvest-50 text-harvest-700 flex items-center justify-center mb-4">
            <Shield className="size-6" />
          </div>
          <h1 className="font-display text-3xl font-semibold">Choose a new password</h1>
          <p className="text-smoke mt-2 text-sm">
            For security, you need to replace the temporary password you were emailed.
          </p>
          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <Field label="Current (temporary) password" required>
              <Input type="password" required autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrent(e.target.value)} />
            </Field>
            <Field label="New password" hint="At least 8 characters" required>
              <Input type="password" required minLength={8} autoComplete="new-password" value={newPassword} onChange={(e) => setNew(e.target.value)} />
            </Field>
            <Field
              label="Confirm new password"
              required
              error={confirm && confirm !== newPassword ? 'Passwords do not match' : undefined}
            >
              <Input type="password" required autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </Field>
            <Button
              type="submit"
              loading={submitting}
              disabled={!currentPassword || newPassword.length < 8 || newPassword !== confirm}
              className="w-full"
            >
              Set new password
            </Button>
          </form>

          {/* FIXED — every guard redirects a must-change-password user here, so
              with no sign-out the only escape was clearing site data. */}
          <button
            type="button"
            onClick={signOut}
            className="mt-4 w-full text-center text-sm text-smoke hover:text-ink"
          >
            Sign out instead
          </button>
        </div>
      </div>
    </div>
  );
}
