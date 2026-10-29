import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Save, KeyRound, Upload, LogOut, AlertTriangle, X } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
// FIXED — BRAND was imported but never used.
import { initials } from '@/lib/utils';

export default function PartnerProfilePage() {
  const { refreshMe, logout } = useAuth();
  const navigate = useNavigate();

  const { data: org, refetch, isLoading: orgLoading, isError: orgError, error: orgErr } = useQuery({
    queryKey: ['partner-organization'],
    queryFn: () => api.get('/partner/organization'),
  });

  const [form, setForm] = useState({
    organizationName: '', taxId: '', contactPhone: '', website: '', address: '', logoUrl: '',
  });
  useEffect(() => {
    if (org) {
      setForm({
        organizationName: org.organization_name || '',
        taxId: org.tax_id || '',
        contactPhone: org.contact_phone || '',
        website: org.website || '',
        address: org.address || '',
        logoUrl: org.logo_url || '',
      });
    }
  }, [org]);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  const save = useMutation({
    // updatePartnerSelf accepts organizationName, contactName, contactPhone,
    // address, state, website, taxId and logoUrl — email is NOT editable here.
    // Blank optional fields must be omitted: `website` and `logoUrl` are
    // validated as URIs and '' would 422 without the server-side empty-string
    // strip, and sending '' for everything would wipe the record.
    mutationFn: (body) =>
      api.patch(
        '/partner/organization',
        Object.fromEntries(
          Object.entries(body)
            .map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v])
            .filter(([, v]) => v !== '' && v != null)
        )
      ),
    onSuccess: () => { toast.success('Profile updated'); refetch(); refreshMe(); },
  });

  const [uploading, setUploading] = useState(false);
  async function uploadLogo(file) {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      // FIXED — went through api.raw and hand-unwrapped two levels, so a
      // `success:false` body produced `url === undefined`, which was then
      // PATCHed onto the organization and still toasted "Logo updated".
      const result = await api.post('/partner/uploads/partner_logo', fd, { silentError: true });
      const url = result?.url;
      if (!url) throw new Error('Upload returned no file URL');
      set('logoUrl', url);
      await api.patch('/partner/organization', { logoUrl: url });
      toast.success('Logo updated');
      refetch(); refreshMe();
    } catch (e) {
      toast.error(e?.response?.data?.error?.message || e?.message || 'Logo upload failed');
    } finally {
      setUploading(false);
    }
  }

  // password
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const changePw = useMutation({
    mutationFn: () => {
      if (pw.newPassword !== pw.confirm) throw new Error('Passwords do not match');
      return api.post('/auth/change-password', { currentPassword: pw.currentPassword, newPassword: pw.newPassword });
    },
    onSuccess: () => { toast.success('Password updated'); setPw({ currentPassword: '', newPassword: '', confirm: '' }); },
    // Prefer the backend message (e.g. "Current password is incorrect") over
    // the generic axios one.
    onError: (e) => toast.error(e?.response?.data?.error?.message || e?.message || 'Could not change password'),
  });

  const [logoutOpen, setLogoutOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  return (
    <div className="max-w-5xl mx-auto">
      {/* FIXED — the banner pulled a hot-linked Unsplash stock photo at render
          time: a third-party request on every page load, no licence record, and
          a blank band whenever the CDN is blocked or offline. Replaced with the
          brand gradient. */}
      <div className="relative rounded-2xl overflow-hidden mb-16">
        <div
          className="h-44"
          style={{
            backgroundImage:
              'linear-gradient(120deg, #1B4029 0%, #2C6B47 55%, #E0A82E 140%)',
          }}
        />
        <div className="absolute -bottom-12 left-8">
          <div className="size-24 rounded-full ring-4 ring-white bg-white overflow-hidden shadow-card">
            {form.logoUrl ? (
              <img src={form.logoUrl} alt={form.organizationName} className="size-full object-cover" />
            ) : (
              <div className="size-full bg-forest-100 text-forest-700 text-2xl font-bold flex items-center justify-center">
                {initials(form.organizationName || 'P')}
              </div>
            )}
          </div>
          <label className="absolute -right-2 bottom-1 size-8 rounded-full bg-forest-500 text-white flex items-center justify-center cursor-pointer shadow-card hover:bg-forest-600 transition">
            <Upload className="size-4" aria-hidden="true" />
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={uploading}
              aria-label="Upload organization logo"
              onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0])}
            />
          </label>
        </div>
      </div>

      {/* FIXED — no loading or error state: the form rendered blank inputs
          while the organization loaded and stayed blank if it failed, which
          looked like an empty profile the partner might then save over. */}
      {orgError && (
        <Card padded className="mb-6 border-red-200 bg-red-50/60">
          <p className="text-sm text-red-700">
            Could not load your organization{orgErr?.message ? `: ${orgErr.message}` : ''}. Don&apos;t save until it loads, or you may overwrite your details.
          </p>
        </Card>
      )}

      {/* Organization Information */}
      <Card padded className="mb-6">
        <h2 className="font-display text-2xl font-semibold text-ink mb-5">Organization Information</h2>
        <form
          onSubmit={(e) => { e.preventDefault(); save.mutate(form); }}
          className="grid grid-cols-1 md:grid-cols-2 gap-4"
        >
          <Field label="Organization name" required>
            <Input value={form.organizationName} onChange={(e) => set('organizationName', e.target.value)} required />
          </Field>
          <Field label="Tax ID">
            <Input value={form.taxId} onChange={(e) => set('taxId', e.target.value)} placeholder="TIN-…" />
          </Field>
          <Field label="Email" hint="Managed by admin — contact support to change">
            <Input value={org?.organization_email || ''} disabled className="bg-bone" />
          </Field>
          <Field label="Phone number">
            <Input value={form.contactPhone} onChange={(e) => set('contactPhone', e.target.value)} placeholder="+234…" />
          </Field>
          <Field label="Website">
            <Input value={form.website} onChange={(e) => set('website', e.target.value)} placeholder="https://…" />
          </Field>
          <Field label="Partner ID" hint="Your unique identifier">
            <Input value={org?.id || ''} disabled className="bg-bone font-mono text-xs" />
          </Field>
          <div className="md:col-span-2">
            <Field label="Address">
              <Input value={form.address} onChange={(e) => set('address', e.target.value)} placeholder="Street, city, state" />
            </Field>
          </div>
          <div className="md:col-span-2 flex justify-end">
            <Button
              type="submit"
              loading={save.isPending}
              disabled={orgLoading || orgError || form.organizationName.trim().length < 2}
            >
              <Save className="size-4" /> Save changes
            </Button>
          </div>
        </form>
      </Card>

      {/* Password */}
      <Card padded className="mb-6">
        <h3 className="font-display text-xl font-semibold mb-1">Password</h3>
        <p className="text-sm text-smoke mb-4">We recommend changing the temporary password you were emailed.</p>
        <form
          onSubmit={(e) => { e.preventDefault(); changePw.mutate(); }}
          className="grid grid-cols-1 md:grid-cols-3 gap-4"
        >
          <Field label="Current password" required>
            <Input type="password" value={pw.currentPassword} onChange={(e) => setPw((p) => ({ ...p, currentPassword: e.target.value }))} required />
          </Field>
          <Field label="New password" required hint="At least 8 characters">
            <Input type="password" value={pw.newPassword} minLength={8} onChange={(e) => setPw((p) => ({ ...p, newPassword: e.target.value }))} required />
          </Field>
          <Field label="Confirm new" required>
            <Input type="password" value={pw.confirm} minLength={8} onChange={(e) => setPw((p) => ({ ...p, confirm: e.target.value }))} required />
          </Field>
          <div className="md:col-span-3 flex justify-end">
            <Button type="submit" variant="secondary" loading={changePw.isPending}><KeyRound className="size-4" /> Change password</Button>
          </div>
        </form>
      </Card>

      {/* Session */}
      <Card padded className="mb-6">
        <h3 className="font-display text-xl font-semibold mb-1">Session</h3>
        <p className="text-sm text-smoke mb-4">Sign out of your CoopScore partner account on this device.</p>
        <Button variant="secondary" onClick={() => setLogoutOpen(true)}><LogOut className="size-4" /> Logout</Button>
      </Card>

      {/* Danger zone */}
      <Card padded className="border-red-200 bg-red-50/40">
        <h3 className="font-display text-xl font-semibold text-red-600 mb-1">Danger Zone</h3>
        <p className="text-sm text-smoke mb-4 max-w-2xl">
          Deleting your account will permanently remove your profile access, organization settings,
          and associated partner data. This action is irreversible. To continue, you&apos;ll be redirected
          to a secure confirmation process before any account deletion takes place.
        </p>
        <button type="button" onClick={() => setDeleteOpen(true)} className="text-red-600 font-semibold text-sm underline underline-offset-2 hover:text-red-700">
          Delete My Account
        </button>
      </Card>

      {/* Logout modal */}
      {logoutOpen && (
        <Modal
          open
          onClose={() => setLogoutOpen(false)}
          title="Logout of your account"
          description="You're about to log out of your CoopScore partner account. You can sign back in anytime to continue monitoring cooperatives, investments, and financing activities."
          footer={
            <>
              <Button variant="ghost" onClick={() => setLogoutOpen(false)}>Cancel</Button>
              <Button variant="primary" onClick={handleLogout}><LogOut className="size-4" /> Logout</Button>
            </>
          }
        />
      )}

      {/* Delete modal */}
      {deleteOpen && <DeleteAccountModal partnerId={org?.id} onClose={() => setDeleteOpen(false)} onDeleted={handleLogout} />}
    </div>
  );
}

function DeleteAccountModal({ partnerId, onClose, onDeleted }) {
  const [confirmId, setConfirmId] = useState('');
  const [busy, setBusy] = useState(false);
  // FIXED — with no partnerId loaded, `''.trim() === ''` matched an empty box,
  // arming the delete button before the page had loaded.
  const expected = (partnerId || '').trim();
  const matches = expected.length > 0 && confirmId.trim() === expected;

  async function doDelete() {
    if (!matches) return toast.error('Partner ID does not match');
    setBusy(true);
    try {
      // DELETE /partner/profile soft-suspends the profile and removes the auth
      // user; the partner organization row itself is retained for audit.
      await api.delete('/partner/profile', { silentError: true });
      toast.success('Account deleted');
      onDeleted?.();
    } catch (e) {
      toast.error(
        e?.response?.data?.error?.message ||
        'Could not delete automatically — contact support to complete deletion.'
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 animate-fade-in">
      <div role="dialog" aria-modal="true" aria-labelledby="delete-account-title" className="w-full max-w-md bg-white rounded-2xl shadow-elev p-6 relative">
        <button type="button" onClick={onClose} aria-label="Close dialog" className="absolute right-4 top-4 text-smoke hover:text-ink"><X className="size-5" /></button>
        <div className="flex items-center gap-2 mb-1">
          <AlertTriangle className="size-5 text-red-600" />
          <h3 id="delete-account-title" className="font-display text-lg font-semibold text-ink">Delete your account</h3>
        </div>
        <p className="text-sm text-smoke mb-4">Enter your Partner ID to confirm.</p>
        <Input value={confirmId} onChange={(e) => setConfirmId(e.target.value)} placeholder="Partner ID"
          aria-label="Confirm your Partner ID to delete the account"
          className="border-red-200 focus:border-red-400 focus:ring-red-400/20 font-mono text-xs" />
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="danger" disabled={!matches} loading={busy} onClick={doDelete}>
            Yes, delete my account
          </Button>
        </div>
      </div>
    </div>
  );
}
