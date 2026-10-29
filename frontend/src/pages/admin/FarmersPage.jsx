import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Search, Sprout } from 'lucide-react';
import api from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, TierPill, EmptyState } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { DataTable, Pagination } from '@/components/ui/DataTable';
import { initials, formatDate, formatScore } from '@/lib/utils';

const PAGE_SIZE = 20;

export default function FarmersPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [tier, setTier] = useState('');
  const [page, setPage] = useState(1);

  // FIXED — bypassed apiClient (which dropped `meta`) via api.raw. Now uses the
  // list helper, which returns { data, meta } and still surfaces envelope errors.
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['admin-farmers', { search, tier, page }],
    queryFn: () => api.list('/admin/farmers', { params: { search, tier, page, pageSize: PAGE_SIZE } }),
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
    // FIXED — read `farm_profiles[0]`, but the API shapes the one-to-one join
    // into a single `farm` object (shapeFarmer). The array form is only present
    // on some responses, so the column rendered blank. Prefer the contract field.
    { key: 'crop', label: 'Crop', render: (r) => r.farm?.cropType || pickOne(r.farm_profiles)?.crop_type || '—' },
    { key: 'state', label: 'State', render: (r) => r.state || '—' },
    {
      key: 'score',
      label: 'Score',
      align: 'right',
      render: (r) => {
        // FIXED — same join-shape problem, plus `Number(null).toFixed(1)`
        // printed "NaN" for unscored farmers.
        const cs = r.creditScore || pickOne(r.credit_scores);
        const s = cs?.finalCreditScore ?? cs?.final_credit_score ?? r.credit_score;
        const t = cs?.creditTier ?? cs?.credit_tier ?? r.credit_tier;
        return (
          <div className="flex items-center justify-end gap-2">
            <span className="tabular font-display text-lg font-semibold">{formatScore(s)}</span>
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
          {/* Tier values must be uppercase A-D — the backend validator rejects
              anything else with a 422. */}
          <select
            value={tier}
            onChange={(e) => { setTier(e.target.value); setPage(1); }}
            className="input max-w-[200px]"
            aria-label="Filter by credit tier"
          >
            <option value="">All tiers</option>
            <option value="A">Tier A — Excellent</option>
            <option value="B">Tier B — Good</option>
            <option value="C">Tier C — Moderate</option>
            <option value="D">Tier D — At Risk</option>
          </select>
        </div>
      </Card>

      {/* FIXED — the page had no error state: a failed fetch left an empty
          table that read as "no farmers". */}
      {isError && (
        <Card padded className="mb-4 border-red-200 bg-red-50/60">
          <p className="text-sm text-red-700">
            Could not load farmers{error?.message ? `: ${error.message}` : ''}.
          </p>
        </Card>
      )}

      <DataTable
        loading={isLoading}
        columns={columns}
        rows={data?.data}
        onRowClick={(r) => navigate(`/admin/farmers/${r.id}`)}
        empty={
          <EmptyState
            icon={Sprout}
            title={search || tier ? 'No farmers match these filters' : 'No farmers yet'}
            description={search || tier ? 'Clear the search or tier filter to see everyone.' : 'Farmers appear here once field agents onboard them.'}
          />
        }
      />
      <Pagination page={page} pageSize={data?.meta?.pageSize || PAGE_SIZE} total={data?.meta?.total || 0} onPageChange={setPage} />
    </>
  );
}

/** Supabase returns one-to-one joins as either an object or a 1-element array. */
function pickOne(v) {
  if (!v) return null;
  return Array.isArray(v) ? v[0] || null : v;
}
