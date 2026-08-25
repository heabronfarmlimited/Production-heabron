import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Search, Users, MapPin } from 'lucide-react';
import api from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, TierPill, EmptyState } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { DataTable, Pagination } from '@/components/ui/DataTable';
import { formatNumber, formatDate } from '@/lib/utils';

export default function CooperativesPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [state, setState] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-cooperatives', { search, state, page }],
    queryFn: () => api.raw.get('/admin/cooperatives', { params: { search, state, page, pageSize: 20 } }).then((r) => r.data),
  });

  const columns = [
    {
      key: 'name',
      label: 'Cooperative',
      render: (r) => (
        <div>
          <p className="font-medium text-ink">{r.name}</p>
          <p className="text-xs text-smoke flex items-center gap-1.5">
            <MapPin className="size-3" /> {[r.lga, r.state].filter(Boolean).join(', ')}
          </p>
        </div>
      ),
    },
    { key: 'members', label: 'Members', align: 'right', render: (r) => formatNumber(r.total_members) },
    {
      key: 'crops',
      label: 'Crops',
      render: (r) => (
        <div className="flex flex-wrap gap-1">
          {(r.crops_supported || []).slice(0, 3).map((c) => (
            <span key={c} className="pill-neutral text-[10px]">{c}</span>
          ))}
        </div>
      ),
    },
    {
      key: 'score',
      label: 'Avg Score',
      align: 'right',
      render: (r) => {
        const s = r.cooperative_credit_scores?.[0]?.average_score ?? r.average_credit_score;
        const tier = r.cooperative_credit_scores?.[0]?.cooperative_tier ?? r.cooperative_tier;
        return (
          <div className="flex items-center justify-end gap-2">
            <span className="tabular font-display text-lg font-semibold">{s != null ? Number(s).toFixed(1) : '—'}</span>
            <TierPill tier={tier} />
          </div>
        );
      },
    },
    { key: 'created', label: 'Added', render: (r) => <span className="text-xs text-smoke">{formatDate(r.created_at)}</span> },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Borrowers"
        title="Cooperatives"
        description="Every cooperative onboarded into the platform — across all field agents."
      />

      <Card padded={false} className="mb-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-smoke" />
            <Input placeholder="Search by name…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="pl-10" />
          </div>
          <Input placeholder="Filter by state" value={state} onChange={(e) => { setState(e.target.value); setPage(1); }} className="max-w-[200px]" />
        </div>
      </Card>

      <DataTable
        loading={isLoading}
        columns={columns}
        rows={data?.data || []}
        onRowClick={(r) => navigate(`/admin/credit/cooperatives/${r.id}`)}
        empty={<EmptyState icon={Users} title="No cooperatives yet" />}
      />
      <Pagination page={page} pageSize={20} total={data?.meta?.total || 0} onPageChange={setPage} />
    </>
  );
}
