import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Input';
import { BRAND } from '@/lib/brand';

export default function ChangePasswordPage() {
  const navigate = useNavigate();
  const { user, refreshMe } = useAuth();
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    if (newPassword !== confirm) return toast.error('Passwords do not match');
    if (newPassword.length < 8) return toast.error('Use at least 8 characters');
    setSubmitting(true);
    try {
      await api.post('/auth/change-password', { currentPassword, newPassword });
      toast.success('Password changed');
      await refreshMe();
      navigate(user?.role?.startsWith('partner') ? '/partner' : '/admin');
    } finally {
      setSubmitting(false);
    }
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
              <Input type="password" required value={currentPassword} onChange={(e) => setCurrent(e.target.value)} />
            </Field>
            <Field label="New password" hint="At least 8 characters" required>
              <Input type="password" required minLength={8} value={newPassword} onChange={(e) => setNew(e.target.value)} />
            </Field>
            <Field label="Confirm new password" required>
              <Input type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </Field>
            <Button type="submit" loading={submitting} className="w-full">Set new password</Button>
          </form>
        </div>
      </div>
    </div>
  );
}
