import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Save, KeyRound, LogOut } from 'lucide-react';
import api from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Input';
import toast from 'react-hot-toast';

export default function SettingsPage() {
  const { user, partner, isAdmin, refreshMe, logout } = useAuth();
  const navigate = useNavigate();
  const base = isAdmin ? '/admin' : '/partner';

  const [form, setForm] = useState({ fullName: '', phone: '', state: '', lga: '' });
  useEffect(() => {
    if (user) setForm({ fullName: user.fullName || '', phone: user.phone || '', state: user.state || '', lga: user.lga || '' });
  }, [user]);

  const update = useMutation({
    mutationFn: (body) => api.patch(`${base}/profile`, body),
    onSuccess: () => { toast.success('Profile updated'); refreshMe(); },
  });

  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const changePw = useMutation({
    mutationFn: () => {
      if (pw.newPassword !== pw.confirm) throw new Error('Passwords do not match');
      return api.post('/auth/change-password', {
        currentPassword: pw.currentPassword,
        newPassword: pw.newPassword,
      });
    },
    onSuccess: () => { toast.success('Password updated'); setPw({ currentPassword: '', newPassword: '', confirm: '' }); },
  });

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  return (
    <>
      <PageHeader
        eyebrow="Account"
        title="Settings"
        description="Manage your profile and password."
      />

      {/* Profile */}
      <Card padded className="mb-6">
        <h3 className="font-display text-xl font-semibold mb-4">Profile</h3>
        <form
          onSubmit={(e) => { e.preventDefault(); update.mutate(form); }}
          className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl"
        >
          <Field label="Full name" required>
            <Input value={form.fullName} onChange={(e) => setForm((f) => ({ ...f, fullName: e.target.value }))} required />
          </Field>
          <Field label="Phone">
            <Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="+234…" />
          </Field>
          <Field label="State">
            <Input value={form.state} onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))} />
          </Field>
          <Field label="LGA">
            <Input value={form.lga} onChange={(e) => setForm((f) => ({ ...f, lga: e.target.value }))} />
          </Field>
          <Field label="Email">
            <Input value={user?.email || ''} disabled className="bg-bone" />
          </Field>
          <Field label="Role">
            <Input value={user?.role?.replace('_', ' ') || ''} disabled className="bg-bone capitalize" />
          </Field>
          <div className="md:col-span-2 flex justify-end">
            <Button type="submit" loading={update.isPending}><Save className="size-4" /> Save changes</Button>
          </div>
        </form>
      </Card>

      {partner && (
        <Card padded className="mb-6">
          <h3 className="font-display text-xl font-semibold mb-1">Organisation</h3>
          <p className="text-sm text-smoke mb-4">Managed by Heabron CoopScore. Contact support to update these fields.</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl">
            <Field label="Organisation"><Input value={partner.organization_name || ''} disabled className="bg-bone" /></Field>
            <Field label="Organisation email"><Input value={partner.organization_email || ''} disabled className="bg-bone" /></Field>
          </div>
        </Card>
      )}

      {/* Password */}
      <Card padded className="mb-6">
        <h3 className="font-display text-xl font-semibold mb-4">Password</h3>
        <form
          onSubmit={(e) => { e.preventDefault(); changePw.mutate(); }}
          className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-3xl"
        >
          <Field label="Current password" required>
            <Input type="password" value={pw.currentPassword} onChange={(e) => setPw((p) => ({ ...p, currentPassword: e.target.value }))} required />
          </Field>
          <Field label="New password" required hint="Minimum 6 characters">
            <Input type="password" value={pw.newPassword} onChange={(e) => setPw((p) => ({ ...p, newPassword: e.target.value }))} required minLength={6} />
          </Field>
          <Field label="Confirm new" required>
            <Input type="password" value={pw.confirm} onChange={(e) => setPw((p) => ({ ...p, confirm: e.target.value }))} required minLength={6} />
          </Field>
          <div className="md:col-span-3 flex justify-end">
            <Button type="submit" loading={changePw.isPending}><KeyRound className="size-4" /> Change password</Button>
          </div>
        </form>
      </Card>

      {/* Danger */}
      <Card padded className="border-red-200">
        <h3 className="font-display text-xl font-semibold mb-1">Sign out</h3>
        <p className="text-sm text-smoke mb-4">End your current session on this device.</p>
        <Button variant="danger" onClick={handleLogout}><LogOut className="size-4" /> Sign out</Button>
      </Card>
    </>
  );
}
