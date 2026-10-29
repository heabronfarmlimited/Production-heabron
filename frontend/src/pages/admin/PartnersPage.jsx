import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Building2, KeyRound, Pause, Play, Mail, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, EmptyState, StatusPill } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { DataTable, Pagination } from '@/components/ui/DataTable';
import { initials, formatDate } from '@/lib/utils';

const PAGE_SIZE = 20;

export default function PartnersPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [createOpen, setCreateOpen] = useState(false);
  const [resetTarget, setResetTarget] = useState(null);
  const qc = useQueryClient();

  // FIXED — api.raw bypass replaced with the list helper (keeps `meta`).
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['admin-partners', { search, page }],
    queryFn: () => api.list('/admin/partners', { params: { search, page, pageSize: PAGE_SIZE } }),
  });

  const suspend = useMutation({
    mutationFn: (id) => api.post(`/admin/partners/${id}/suspend`),
    onSuccess: () => { toast.success('Suspended'); qc.invalidateQueries({ queryKey: ['admin-partners'] }); },
  });
  const reactivate = useMutation({
    mutationFn: (id) => api.post(`/admin/partners/${id}/reactivate`),
    onSuccess: () => { toast.success('Reactivated'); qc.invalidateQueries({ queryKey: ['admin-partners'] }); },
  });
  const resetPass = useMutation({
    mutationFn: (id) => api.post(`/admin/partners/${id}/reset-password`),
    onSuccess: () => { toast.success('New password emailed to partner'); setResetTarget(null); },
  });

  const columns = [
    {
      key: 'partner',
      label: 'Partner',
      render: (r) => (
        <div className="flex items-center gap-3">
          {r.logo_url ? (
            <img src={r.logo_url} alt={r.organization_name} className="size-10 rounded-lg object-contain bg-bone p-1" />
          ) : (
            <div className="size-10 rounded-lg bg-forest-100 text-forest-700 text-xs font-bold flex items-center justify-center">
              {initials(r.organization_name)}
            </div>
          )}
          <div className="min-w-0">
            <p className="font-medium text-ink truncate">{r.organization_name}</p>
            <p className="text-xs text-smoke truncate">{r.organization_email}</p>
          </div>
        </div>
      ),
    },
    { key: 'phone', label: 'Phone', render: (r) => <span className="tabular">{r.contact_phone || '—'}</span> },
    { key: 'state', label: 'State', render: (r) => r.state || '—' },
    { key: 'status', label: 'Status', render: (r) => <StatusPill status={r.status} /> },
    { key: 'created', label: 'Created', render: (r) => <span className="text-xs text-smoke">{formatDate(r.created_at)}</span> },
    {
      key: 'actions',
      label: '',
      align: 'right',
      // FIXED — these were icon-only buttons with no accessible name at all
      // (a screen reader announced three unlabelled buttons per row), and a
      // row click now opens the detail page, so each stops propagation.
      render: (r) => (
        <div className="flex items-center justify-end gap-1.5">
          <Button
            variant="ghost"
            aria-label={`Reset password for ${r.organization_name}`}
            title="Reset password"
            onClick={(e) => { e.stopPropagation(); setResetTarget(r); }}
          >
            <KeyRound className="size-4" />
          </Button>
          {r.status === 'active' ? (
            <Button
              variant="ghost"
              aria-label={`Suspend ${r.organization_name}`}
              title="Suspend"
              disabled={suspend.isPending}
              onClick={(e) => { e.stopPropagation(); suspend.mutate(r.id); }}
            >
              <Pause className="size-4" />
            </Button>
          ) : (
            <Button
              variant="ghost"
              aria-label={`Reactivate ${r.organization_name}`}
              title="Reactivate"
              disabled={reactivate.isPending}
              onClick={(e) => { e.stopPropagation(); reactivate.mutate(r.id); }}
            >
              <Play className="size-4" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Capital partners"
        title="Lenders & Investors"
        description="Partner organizations with access to the credit-bureau portal."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" /> Add partner
          </Button>
        }
      />

      <Card padded={false} className="mb-4">
        <div className="flex items-center gap-3 p-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-smoke" />
            <Input
              placeholder="Search partner name…"
              aria-label="Search partners by organization name"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="pl-10"
            />
          </div>
        </div>
      </Card>

      {isError && (
        <Card padded className="mb-4 border-red-200 bg-red-50/60">
          <p className="text-sm text-red-700">Could not load partners{error?.message ? `: ${error.message}` : ''}.</p>
        </Card>
      )}

      {/* FIXED — /admin/partners/:partnerId (PartnerDetailPage) was never
          linked from anywhere, so the route and its stats were unreachable. */}
      <DataTable
        loading={isLoading}
        columns={columns}
        rows={data?.data}
        onRowClick={(r) => navigate(`/admin/partners/${r.id}`)}
        empty={<EmptyState
          icon={Building2}
          title="No partners yet"
          description="Create a partner organization to grant it access to the credit-bureau portal."
          action={<Button onClick={() => setCreateOpen(true)}><Plus className="size-4" /> Add your first partner</Button>}
        />}
      />
      <Pagination page={page} pageSize={data?.meta?.pageSize || PAGE_SIZE} total={data?.meta?.total || 0} onPageChange={setPage} />

      {createOpen && (
        <CreatePartnerModal onClose={() => setCreateOpen(false)} onCreated={() => qc.invalidateQueries({ queryKey: ['admin-partners'] })} />
      )}

      {resetTarget && (
        <Modal
          open
          onClose={() => setResetTarget(null)}
          title={`Reset password for ${resetTarget.organization_name}?`}
          description="A new strong password will be generated and emailed to the partner."
          footer={
            <>
              <Button variant="ghost" onClick={() => setResetTarget(null)}>Cancel</Button>
              <Button variant="primary" loading={resetPass.isPending} onClick={() => resetPass.mutate(resetTarget.id)}>
                <Mail className="size-4" /> Send new password
              </Button>
            </>
          }
        >
          <p className="text-sm text-smoke">
            The partner will be forced to set a new password when they next sign in.
          </p>
        </Modal>
      )}
    </>
  );
}

function CreatePartnerModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    organizationName: '',
    organizationEmail: '',
    contactName: '',
    contactPhone: '',
    state: '',
    address: '',
    logoUrl: '',
  });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); }

  const [uploading, setUploading] = useState(false);
  async function uploadLogo(file) {
    // FIXED — went through api.raw with no error handling and no busy state:
    // a failed upload silently set logoUrl to undefined and still toasted
    // "Logo uploaded".
    setUploading(true);
    try {
      const result = await api.post('/admin/uploads/partner_logo', fd_of(file), { silentError: true });
      if (!result?.url) throw new Error('Upload returned no URL');
      set('logoUrl', result.url);
      toast.success('Logo uploaded');
    } catch (e) {
      toast.error(e?.response?.data?.error?.message || e?.message || 'Logo upload failed');
    } finally {
      setUploading(false);
    }
  }

  // Only organizationName + organizationEmail are required by the validator;
  // the rest are optional and must be omitted rather than sent as ''.
  const canSubmit = form.organizationName.trim().length >= 2 && /\S+@\S+\.\S+/.test(form.organizationEmail);

  async function submit(e) {
    e?.preventDefault?.();
    if (!canSubmit) {
      toast.error('An organization name and a valid email are required');
      return;
    }
    setBusy(true);
    try {
      const payload = Object.fromEntries(
        Object.entries(form)
          .map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v])
          .filter(([, v]) => v !== '' && v != null)
      );
      const data = await api.post('/admin/partners', payload);
      setResult(data);
      onCreated?.();
      toast.success('Partner created — credentials emailed');
    } catch {
      /* toasted by the api interceptor / envelope handler */
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <Modal
        open
        onClose={onClose}
        title="Partner created"
        description="A welcome email with sign-in credentials has been sent."
        footer={<Button onClick={onClose}>Done</Button>}
      >
        <Card className="bg-forest-50 border-forest-200">
          <p className="font-display text-base font-semibold text-forest-900">{result.partner?.organization_name}</p>
          <p className="text-sm text-forest-700">{result.partner?.organization_email}</p>
          <p className="text-xs text-smoke mt-3">
            The partner has been emailed their temporary password. They&apos;ll be required to change it on first sign-in.
          </p>
        </Card>
      </Modal>
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Add partner organization"
      description="Create a credit-bureau portal account for a lender or investor."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} loading={busy} disabled={!canSubmit}>
            <Plus className="size-4" /> Create partner
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Organization name" required>
          <Input value={form.organizationName} onChange={(e) => set('organizationName', e.target.value)} placeholder="Acme Microfinance Bank" required />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Organization email" required hint="The auto-generated password is emailed here.">
            <Input type="email" value={form.organizationEmail} onChange={(e) => set('organizationEmail', e.target.value)} placeholder="ops@acme.com" required />
          </Field>
          <Field label="Contact name">
            <Input value={form.contactName} onChange={(e) => set('contactName', e.target.value)} placeholder="Adaeze Nwosu" />
          </Field>
          <Field label="Contact phone">
            <Input value={form.contactPhone} onChange={(e) => set('contactPhone', e.target.value)} placeholder="+234…" />
          </Field>
          <Field label="State">
            <Input value={form.state} onChange={(e) => set('state', e.target.value)} placeholder="Lagos" />
          </Field>
        </div>
        <Field label="Address">
          <Input value={form.address} onChange={(e) => set('address', e.target.value)} />
        </Field>
        <Field label="Logo">
          <div className="flex items-center gap-3">
            {form.logoUrl && (
              <img src={form.logoUrl} alt="" className="size-14 rounded-lg object-contain bg-bone p-1 border border-whisper" />
            )}
            <label className="btn-secondary cursor-pointer">
              {uploading ? 'Uploading…' : form.logoUrl ? 'Change logo' : 'Upload logo'}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                disabled={uploading}
                aria-label="Upload partner logo"
                onChange={(e) => e.target.files?.[0] && uploadLogo(e.target.files[0])}
              />
            </label>
          </div>
        </Field>
      </form>
    </Modal>
  );
}

function fd_of(file) {
  const fd = new FormData();
  fd.append('file', file);
  return fd;
}
