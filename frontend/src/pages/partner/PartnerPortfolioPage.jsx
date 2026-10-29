import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { PieChart as PieIcon, MapPin } from 'lucide-react';
import api from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, MetricCard, TierPill, Skeleton, EmptyState } from '@/components/ui/Card';
import { DataTable } from '@/components/ui/DataTable';
import { formatNaira, formatNumber, formatScore } from '@/lib/utils';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';

const TIER_COLORS = { A: '#2C6B47', B: '#4F8E6C', C: '#E0A82E', D: '#C84B4B' };

export default function PartnerPortfolioPage() {
  const navigate = useNavigate();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['partner-portfolio'],
    queryFn: () => api.get('/partner/portfolio'),
  });

  if (isLoading) return <Skeleton className="h-64" />;
  // FIXED — no error state: a failed request rendered a portfolio of zeroes,
  // which a lender would read as "I have no exposure".
  if (isError) {
    return (
      <Card padded className="border-red-200 bg-red-50/60">
        <p className="py-8 text-center text-red-700">
          Could not load your portfolio{error?.message ? `: ${error.message}` : ''}.
        </p>
      </Card>
    );
  }

  const cooperatives = Array.isArray(data?.cooperatives) ? data.cooperatives : [];
  const tierData = Object.entries(data?.riskDistribution || {}).map(([tier, value]) => ({ tier, value: Number(value) || 0 }));
  const stateData = Object.entries(data?.geographicDistribution || {})
    .map(([state, amount]) => [state, Number(amount) || 0])
    .sort(([, a], [, b]) => b - a);

  return (
    <>
      <PageHeader
        eyebrow="Portfolio monitoring"
        title="Your financed borrowers"
        description="Every cooperative your organization has financed, with current credit scores and exposure."
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <MetricCard label="Cooperatives" value={formatNumber(data?.summary?.totalCooperatives || 0)} tone="primary" sub="Financed by you" />
        <MetricCard label="Total financed" value={formatNaira(data?.summary?.totalAmountFinanced || 0)} sub="Approved value" />
        <MetricCard
          label="Avg cooperative score"
          value={formatScore(data?.summary?.averageScore)}
          sub="out of 100"
        />
        <MetricCard label="States" value={formatNumber(stateData.length)} icon={MapPin} sub="Geographic spread" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <Card>
          <div className="flex items-center justify-between mb-6">
            <div>
              <p className="eyebrow">Risk profile</p>
              <h3 className="font-display text-xl font-semibold">By tier</h3>
            </div>
            <PieIcon className="size-5 text-smoke" />
          </div>
          {tierData.length === 0 || tierData.every((d) => d.value === 0) ? (
            <p className="text-sm text-smoke py-12 text-center">No financed cooperatives yet.</p>
          ) : (
            <div className="flex items-center gap-6">
              <ResponsiveContainer width={200} height={200}>
                <PieChart>
                  <Pie data={tierData.filter((d) => d.value > 0)} dataKey="value" innerRadius={50} outerRadius={85} paddingAngle={2}>
                    {tierData.map((d) => (<Cell key={d.tier} fill={TIER_COLORS[d.tier]} />))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 space-y-3">
                {tierData.map((d) => (
                  <div key={d.tier} className="flex items-center justify-between">
                    <TierPill tier={d.tier} />
                    <span className="font-display text-xl font-semibold tabular">{d.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        <Card>
          <p className="eyebrow mb-1">Geography</p>
          <h3 className="font-display text-xl font-semibold mb-5">By state (NGN exposure)</h3>
          {stateData.length === 0 ? (
            <p className="text-sm text-smoke py-12 text-center">No data yet.</p>
          ) : (
            <div className="space-y-3">
              {stateData.slice(0, 8).map(([state, amount]) => {
                // FIXED — `(amount / max) * 100` produced NaN (and an invalid
                // CSS width) whenever every state's exposure was 0.
                const max = stateData[0]?.[1] || 0;
                const pct = max > 0 ? Math.min(100, (amount / max) * 100) : 0;
                return (
                  <div key={state}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="font-medium">{state}</span>
                      <span className="tabular">{formatNaira(amount)}</span>
                    </div>
                    <div className="h-2 bg-bone rounded-full overflow-hidden">
                      <div className="h-full bg-forest-500" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      <DataTable
        loading={false}
        empty={
          <EmptyState
            icon={PieIcon}
            title="No cooperatives financed yet"
            description="Cooperatives appear here once you approve a financing request forwarded to you."
          />
        }
        onRowClick={(c) => navigate(`/partner/reports/cooperative/${c.cooperativeId}`)}
        columns={[
          { key: 'name', label: 'Cooperative', render: (c) => <span className="font-semibold">{c.name}</span> },
          { key: 'location', label: 'Location', render: (c) => [c.lga, c.state].filter(Boolean).join(', ') || '—' },
          { key: 'tier', label: 'Tier', render: (c) => <TierPill tier={c.tier} /> },
          { key: 'averageScore', label: 'Score', align: 'right', render: (c) => formatScore(c.averageScore) },
          { key: 'loanCount', label: 'Loans', align: 'right', render: (c) => formatNumber(c.loanCount) },
          { key: 'totalApproved', label: 'Approved', align: 'right', render: (c) => formatNaira(c.totalApproved) },
          { key: 'totalDisbursed', label: 'Disbursed', align: 'right', render: (c) => formatNaira(c.totalDisbursed) },
        ]}
        rows={cooperatives}
      />
    </>
  );
}
