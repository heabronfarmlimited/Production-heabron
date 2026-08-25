import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Search, Sprout } from 'lucide-react';
import api from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, TierPill, EmptyState } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { DataTable, Pagination } from '@/components/ui/DataTable';
import { initials, formatDate } from '@/lib/utils';

export default function FarmersPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [tier, setTier] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['admin-farmers', { search, tier, page }],
    queryFn: () => api.raw.get('/admin/farmers', { params: { search, tier, page, pageSize: 20 } }).then((r) => r.data),
  });

  const columns = [
    {
      key: 'farmer',
      label: 'Farmer',
      render: (r) => (
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-lg bg-harvest-50 text-harvest-700 text-xs font-bold flex items-center justify-center">
            {initials(r.full_name)}
          </div>
          <div className="min-w-0">
            <p className="font-medium text-ink truncate">{r.full_name}</p>
            <p className="text-xs text-smoke truncate">{r.cooperatives?.name || '—'}</p>
          </div>
        </div>
      ),
    },
    { key: 'phone', label: 'Phone', render: (r) => <span className="tabular">{r.phone || '—'}</span> },
    { key: 'crop', label: 'Crop', render: (r) => r.farm_profiles?.[0]?.crop_type || '—' },
    { key: 'state', label: 'State', render: (r) => r.state || '—' },
    {
      key: 'score',
      label: 'Score',
      align: 'right',
      render: (r) => {
        const s = r.credit_scores?.[0]?.final_credit_score ?? r.credit_score;
        const t = r.credit_scores?.[0]?.credit_tier ?? r.credit_tier;
        return (
          <div className="flex items-center justify-end gap-2">
            <span className="tabular font-display text-lg font-semibold">{s != null ? Number(s).toFixed(1) : '—'}</span>
            <TierPill tier={t} />
          </div>
        );
      },
    },
    { key: 'created', label: 'Added', render: (r) => <span className="text-xs text-smoke">{formatDate(r.created_at)}</span> },
  ];

  return (
    <>
      <PageHeader eyebrow="Borrowers" title="Farmers" description="Every smallholder farmer onboarded onto CoopScore." />

      <Card padded={false} className="mb-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-smoke" />
            <Input placeholder="Search by name…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} className="pl-10" />
          </div>
          <select value={tier} onChange={(e) => { setTier(e.target.value); setPage(1); }} className="input max-w-[200px]">
            <option value="">All tiers</option>
            <option value="A">Tier A — Excellent</option>
            <option value="B">Tier B — Good</option>
            <option value="C">Tier C — Moderate</option>
            <option value="D">Tier D — At Risk</option>
          </select>
        </div>
      </Card>

      <DataTable
        loading={isLoading}
        columns={columns}
        rows={data?.data || []}
        onRowClick={(r) => navigate(`/admin/farmers/${r.id}`)}
        empty={<EmptyState icon={Sprout} title="No farmers yet" />}
      />
      <Pagination page={page} pageSize={20} total={data?.meta?.total || 0} onPageChange={setPage} />
    </>
  );
}
