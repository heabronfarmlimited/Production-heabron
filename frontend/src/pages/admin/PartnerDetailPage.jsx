import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, KeyRound, Pause, Play, Mail, MapPin, Phone } from 'lucide-react';
import api from '@/lib/api';
import { Card, Skeleton, StatusPill, MetricCard } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { formatNaira, formatDate } from '@/lib/utils';
import toast from 'react-hot-toast';

export default function PartnerDetailPage() {
  const { partnerId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: partner, isLoading } = useQuery({
    queryKey: ['admin-partner', partnerId],
    queryFn: () => api.get(`/admin/partners/${partnerId}`),
  });

  const resetPassword = useMutation({
    mutationFn: () => api.post(`/admin/partners/${partnerId}/reset-password`),
    onSuccess: () => toast.success('A new password was generated and emailed'),
  });

  const toggleStatus = useMutation({
    mutationFn: (action) => api.post(`/admin/partners/${partnerId}/${action}`),
    onSuccess: () => { toast.success('Partner status updated'); qc.invalidateQueries({ queryKey: ['admin-partner'] }); },
  });

  if (isLoading) return <Skeleton className="h-64" />;
  if (!partner) return <Card><p className="py-12 text-center">Partner not found</p></Card>;

  return (
    <>
      <button onClick={() => navigate(-1)} className="mb-4 inline-flex items-center gap-2 text-sm text-smoke hover:text-ink">
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
              {partner.organization_name?.[0]}
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
        <MetricCard label="Linked users" value={partner.stats?.users || 0} />
        <MetricCard label="Pending requests" value={partner.stats?.financing?.pending || 0} />
        <MetricCard label="Approved" value={partner.stats?.financing?.approved || 0} tone="primary" />
        <MetricCard label="Approved amount" value={formatNaira(partner.stats?.financing?.totalAmount || 0)} tone="accent" />
      </div>
    </>
  );
}

function KV({ label, value, icon: Icon }) {
  return (
    <div>
      <p className="text-xs text-smoke uppercase tracking-wider mb-0.5 flex items-center gap-1">
        {Icon && <Icon className="size-3" />} {label}
      </p>
      <p className="font-medium text-ink truncate">{value}</p>
    </div>
  );
}
