import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import api from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, EmptyState, Skeleton, TierPill } from '@/components/ui/Card';
import { DataTable } from '@/components/ui/DataTable';
import { formatDate } from '@/lib/utils';

export default function PartnerWatchlistPage() {
  const navigate = useNavigate();
  const { data, isLoading } = useQuery({
    queryKey: ['partner-watchlist'],
    queryFn: () => api.get('/partner/watchlist'),
  });

  if (isLoading) return <Skeleton className="h-64" />;

  return (
    <>
      <PageHeader
        eyebrow="Risk monitoring"
        title="Cooperatives to watch"
        description="Borrowers your organization has financed that are currently in Tier C or Tier D."
      />

      {(data || []).length === 0 ? (
        <Card padded>
          <EmptyState
            icon={AlertTriangle}
            title="Nothing on watch"
            description="All cooperatives in your portfolio are scoring at Tier A or B. Keep an eye on this page over time as scores update."
          />
        </Card>
      ) : (
        <DataTable
          loading={false}
          onRowClick={(c) => navigate(`/partner/reports/cooperative/${c.cooperative_id}`)}
          columns={[
            { key: 'name', label: 'Cooperative', render: (r) => <span className="font-semibold">{r.cooperatives?.name}</span> },
            { key: 'location', label: 'Location', render: (r) => `${r.cooperatives?.lga || ''}${r.cooperatives?.lga ? ', ' : ''}${r.cooperatives?.state || ''}` },
            { key: 'tier', label: 'Tier', render: (r) => <TierPill tier={r.cooperative_tier} /> },
            { key: 'average_score', label: 'Score', align: 'right', render: (r) => Number(r.average_score).toFixed(1) },
            { key: 'tier_d_count', label: 'Tier D members', align: 'right' },
            { key: 'total_farmers', label: 'Total members', align: 'right' },
            { key: 'last_calculated_at', label: 'Last calc', render: (r) => formatDate(r.last_calculated_at) },
          ]}
          rows={data || []}
        />
      )}
    </>
  );
}
