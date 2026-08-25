import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Gauge, Users, Sprout } from 'lucide-react';
import api from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, TierPill, EmptyState } from '@/components/ui/Card';
import { DataTable, Pagination } from '@/components/ui/DataTable';
import { initials, formatNumber } from '@/lib/utils';

export default function CreditPage() {
  const [tab, setTab] = useState('cooperatives');
  const [tier, setTier] = useState('');
  const [page, setPage] = useState(1);
  const navigate = useNavigate();

  return (
    <>
      <PageHeader
        eyebrow="Risk"
        title="Credit Scoring"
        description="Cooperative and farmer credit scores per the Heabron CoopScore v1.0 model."
      />

      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-2">
          <button
            onClick={() => { setTab('cooperatives'); setPage(1); }}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition ${tab === 'cooperatives' ? 'bg-forest-500 text-white' : 'bg-white border border-whisper text-smoke hover:text-ink'}`}
          >
            <Users className="size-3.5 inline mr-1.5 -mt-0.5" /> Cooperatives
          </button>
          <button
            onClick={() => { setTab('farmers'); setPage(1); }}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition ${tab === 'farmers' ? 'bg-forest-500 text-white' : 'bg-white border border-whisper text-smoke hover:text-ink'}`}
          >
            <Sprout className="size-3.5 inline mr-1.5 -mt-0.5" /> Farmers
          </button>
        </div>
        <select value={tier} onChange={(e) => { setTier(e.target.value); setPage(1); }} className="input max-w-[200px]">
          <option value="">All tiers</option>
          <option value="A">Tier A</option>
          <option value="B">Tier B</option>
          <option value="C">Tier C</option>
          <option value="D">Tier D</option>
        </select>
      </div>

      {tab === 'cooperatives'
        ? <CoopScores tier={tier} page={page} setPage={setPage} onOpen={(id) => navigate(`/admin/credit/cooperatives/${id}`)} />
        : <FarmerScores tier={tier} page={page} setPage={setPage} onOpen={(id) => navigate(`/admin/credit/farmers/${id}`)} />}
    </>
  );
}

function CoopScores({ tier, page, setPage, onOpen }) {
  const { data, isLoading } = useQuery({
    queryKey: ['credit-coops', { tier, page }],
    queryFn: () => api.raw.get('/admin/credit/cooperatives', { params: { tier, page, pageSize: 20 } }).then((r) => r.data),
  });

  const columns = [
    {
      key: 'name',
      label: 'Cooperative',
      render: (r) => (
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-lg bg-forest-100 text-forest-700 text-xs font-bold flex items-center justify-center">
            {initials(r.cooperatives?.name)}
          </div>
          <div>
            <p className="font-medium text-ink">{r.cooperatives?.name}</p>
            <p className="text-xs text-smoke">{[r.cooperatives?.lga, r.cooperatives?.state].filter(Boolean).join(', ')}</p>
          </div>
        </div>
      ),
    },
    { key: 'members', label: 'Farmers', align: 'right', render: (r) => formatNumber(r.total_farmers) },
    { key: 'scored', label: 'Scored', align: 'right', render: (r) => formatNumber(r.scored_farmers) },
    {
      key: 'tiers',
      label: 'Tier mix',
      render: (r) => (
        <div className="flex items-center gap-1 text-[10px] font-medium">
          <span className="px-1.5 py-0.5 rounded bg-forest-50 text-forest-700">A {r.tier_a_count}</span>
          <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700">B {r.tier_b_count}</span>
          <span className="px-1.5 py-0.5 rounded bg-harvest-50 text-harvest-700">C {r.tier_c_count}</span>
          <span className="px-1.5 py-0.5 rounded bg-red-50 text-red-700">D {r.tier_d_count}</span>
        </div>
      ),
    },
    {
      key: 'score',
      label: 'Avg Score',
      align: 'right',
      render: (r) => (
        <div className="flex items-center justify-end gap-2">
          <span className="tabular font-display text-xl font-semibold">{Number(r.average_score).toFixed(1)}</span>
          <TierPill tier={r.cooperative_tier} />
        </div>
      ),
    },
  ];
  return (
    <>
      <DataTable loading={isLoading} columns={columns} rows={data?.data || []} onRowClick={(r) => onOpen(r.cooperative_id)} empty={<EmptyState icon={Gauge} title="No scored cooperatives" />} />
      <Pagination page={page} pageSize={20} total={data?.meta?.total || 0} onPageChange={setPage} />
    </>
  );
}

function FarmerScores({ tier, page, setPage, onOpen }) {
  const { data, isLoading } = useQuery({
    queryKey: ['credit-farmers', { tier, page }],
    queryFn: () => api.raw.get('/admin/credit/farmers', { params: { tier, page, pageSize: 20 } }).then((r) => r.data),
  });

  const columns = [
    { key: 'name', label: 'Farmer', render: (r) => (
      <div>
        <p className="font-medium text-ink">{r.farmers?.full_name}</p>
        <p className="text-xs text-smoke">{r.farmers?.cooperatives?.name}</p>
      </div>
    ) },
    { key: 'prod', label: 'Production', align: 'right', render: (r) => <span className="tabular">{Number(r.production_score).toFixed(1)}</span> },
    { key: 'rep', label: 'Repayment', align: 'right', render: (r) => <span className="tabular">{Number(r.repayment_score).toFixed(1)}</span> },
    { key: 'cycle', label: 'Cycle', render: (r) => r.is_first_cycle ? <span className="pill-neutral">1st cycle</span> : <span className="text-smoke">#{r.cycle_count}</span> },
    {
      key: 'score',
      label: 'Final',
      align: 'right',
      render: (r) => (
        <div className="flex items-center justify-end gap-2">
          <span className="tabular font-display text-xl font-semibold">{Number(r.final_credit_score).toFixed(1)}</span>
          <TierPill tier={r.credit_tier} />
        </div>
      ),
    },
  ];
  return (
    <>
      <DataTable loading={isLoading} columns={columns} rows={data?.data || []} onRowClick={(r) => onOpen(r.farmer_id)} empty={<EmptyState icon={Gauge} title="No scored farmers" />} />
      <Pagination page={page} pageSize={20} total={data?.meta?.total || 0} onPageChange={setPage} />
    </>
  );
}
