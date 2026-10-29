import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, KeyRound, Pause, Play, Mail, MapPin, Phone } from 'lucide-react';
import api from '@/lib/api';
import { Card, Skeleton, StatusPill, MetricCard } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { formatNaira, formatDate, formatNumber, initials } from '@/lib/utils';
import toast from 'react-hot-toast';

export default function PartnerDetailPage() {
  const { partnerId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: partner, isLoading, isError, error } = useQuery({
    queryKey: ['admin-partner', partnerId],
    queryFn: () => api.get(`/admin/partners/${partnerId}`),
  });

  const resetPassword = useMutation({
    mutationFn: () => api.post(`/admin/partners/${partnerId}/reset-password`),
    onSuccess: () => toast.success('A new password was generated and emailed'),
  });

  const toggleStatus = useMutation({
    // Only 'suspend' and 'reactivate' exist as sub-routes; anything else 404s.
    mutationFn: (action) => api.post(`/admin/partners/${partnerId}/${action}`),
    onSuccess: () => {
      toast.success('Partner status updated');
      qc.invalidateQueries({ queryKey: ['admin-partner'] });
      // FIXED — the list page kept showing the stale status after a change here.
      qc.invalidateQueries({ queryKey: ['admin-partners'] });
    },
  });

  if (isLoading) return <Skeleton className="h-64" />;
  // FIXED — a load failure was indistinguishable from "partner not found", and
  // neither state offered a way back.
  if (isError || !partner) {
    return (
      <Card padded>
        <p className="py-10 text-center text-smoke">
          {isError
            ? `Could not load this partner${error?.message ? `: ${error.message}` : ''}.`
            : 'This partner organization no longer exists.'}
        </p>
        <div className="flex justify-center">
          <Button variant="secondary" onClick={() => navigate('/admin/partners')}>Back to partners</Button>
        </div>
      </Card>
    );
  }

  return (
    <>
      <button type="button" onClick={() => navigate(-1)} className="mb-4 inline-flex items-center gap-2 text-sm text-smoke hover:text-ink">
        <ArrowLeft className="size-4" /> Back to partners
      </button>

      <PageHeader
        title={partner.organization_name}
        description={`Partner since ${formatDate(partner.created_at)}`}
        actions={
          <>
            <StatusPill status={partner.status} />
            <Button variant="secondary" onClick={() => resetPassword.mutate()} loading={resetPassword.isPending}>
              <KeyRound className="size-4" /> Reset password
            </Button>
            {partner.status === 'active' ? (
              <Button variant="danger" onClick={() => toggleStatus.mutate('suspend')} loading={toggleStatus.isPending}>
                <Pause className="size-4" /> Suspend
              </Button>
            ) : (
              <Button onClick={() => toggleStatus.mutate('reactivate')} loading={toggleStatus.isPending}>
                <Play className="size-4" /> Reactivate
              </Button>
            )}
          </>
        }
      />

      {/* Organisation header card */}
      <Card padded className="mb-6">
        <div className="flex items-start gap-5">
          {partner.logo_url ? (
            <img src={partner.logo_url} alt={partner.organization_name} className="size-20 rounded-2xl object-contain bg-bone p-2" />
          ) : (
            <div className="size-20 rounded-2xl bg-forest-50 text-forest-500 flex items-center justify-center font-display text-2xl font-semibold">
              {initials(partner.organization_name)}
            </div>
          )}
          <div className="flex-1 grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            <KV icon={Mail} label="Email" value={partner.organization_email} />
            <KV icon={Phone} label="Phone" value={partner.contact_phone || '—'} />
            <KV icon={MapPin} label="Address" value={[partner.address, partner.state].filter(Boolean).join(', ') || '—'} />
          </div>
        </div>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <MetricCard label="Linked users" value={formatNumber(partner.stats?.users || 0)} sub="Portal seats" />
        <MetricCard label="Pending requests" value={formatNumber(partner.stats?.financing?.pending || 0)} sub="Awaiting their decision" />
        <MetricCard label="Approved" value={formatNumber(partner.stats?.financing?.approved || 0)} tone="primary" sub="Requests they funded" />
        <MetricCard label="Approved amount" value={formatNaira(partner.stats?.financing?.totalAmount || 0)} tone="accent" sub="Total requested value" />
      </div>

      {/* FIXED — the page offered no way to reach the requests this partner has
          been forwarded; the stat tiles were a dead end. */}
      <Card padded>
        <h3 className="font-display text-xl font-semibold mb-1">Forwarded financing</h3>
        <p className="text-sm text-smoke mb-4">
          Requests routed to {partner.organization_name} are managed from the financing queue.
        </p>
        <Button variant="secondary" onClick={() => navigate('/admin/financing')}>
          Open financing queue
        </Button>
      </Card>
    </>
  );
}

function KV({ label, value, icon: Icon }) {
  return (
    <div>
      <p className="text-xs text-smoke uppercase tracking-wider mb-0.5 flex items-center gap-1">
        {Icon && <Icon className="size-3" />} {label}
      </p>
      <p className="font-medium text-ink truncate">{value || '—'}</p>
    </div>
  );
}
