import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import api from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, EmptyState, Skeleton, TierPill } from '@/components/ui/Card';
import { DataTable } from '@/components/ui/DataTable';
import { formatDate, formatNumber, formatScore } from '@/lib/utils';

export default function PartnerWatchlistPage() {
  const navigate = useNavigate();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['partner-watchlist'],
    queryFn: () => api.get('/partner/watchlist'),
  });

  if (isLoading) return <Skeleton className="h-64" />;

  const rows = Array.isArray(data) ? data : [];

  return (
    <>
      <PageHeader
        eyebrow="Risk monitoring"
        title="Cooperatives to watch"
        description="Borrowers your organization has financed that are currently in Tier C or Tier D."
      />

      {/* FIXED — no error state: a failed request showed "Nothing on watch",
          which tells a lender their portfolio is healthy when it is unknown. */}
      {isError ? (
        <Card padded className="border-red-200 bg-red-50/60">
          <p className="py-8 text-center text-red-700">
            Could not load the watchlist{error?.message ? `: ${error.message}` : ''}.
          </p>
        </Card>
      ) : rows.length === 0 ? (
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
            { key: 'name', label: 'Cooperative', render: (r) => <span className="font-semibold">{r.cooperatives?.name || 'Unknown cooperative'}</span> },
            { key: 'location', label: 'Location', render: (r) => [r.cooperatives?.lga, r.cooperatives?.state].filter(Boolean).join(', ') || '—' },
            { key: 'tier', label: 'Tier', render: (r) => <TierPill tier={r.cooperative_tier} /> },
            // FIXED — Number(null).toFixed(1) printed "NaN".
            { key: 'average_score', label: 'Score', align: 'right', render: (r) => formatScore(r.average_score) },
            { key: 'tier_d_count', label: 'Tier D members', align: 'right', render: (r) => formatNumber(r.tier_d_count) },
            { key: 'total_farmers', label: 'Total members', align: 'right', render: (r) => formatNumber(r.total_farmers) },
            { key: 'last_calculated_at', label: 'Last calc', render: (r) => formatDate(r.last_calculated_at) },
          ]}
          rows={rows}
        />
      )}
    </>
  );
}
