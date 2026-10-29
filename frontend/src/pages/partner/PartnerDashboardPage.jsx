import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Search, Banknote, AlertTriangle, TrendingUp, Users, Sprout, ArrowUpRight } from 'lucide-react';
import api from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { PageHeader } from '@/components/ui/PageHeader';
import { MetricCard, Card, TierPill, Skeleton } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { formatNaira, formatNumber, formatScore } from '@/lib/utils';
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';

const TIER_COLORS = { A: '#2C6B47', B: '#4F8E6C', C: '#E0A82E', D: '#C84B4B' };

export default function PartnerDashboardPage() {
  const navigate = useNavigate();
  const { partner, user } = useAuth();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['partner-dashboard'],
    queryFn: () => api.get('/partner/dashboard'),
  });

  const tierData = Object.entries(data?.riskDistribution || {})
    .map(([tier, value]) => ({ tier, value: Number(value) || 0 }));
  const totals = data?.totals || {};

  return (
    <>
      <PageHeader
        eyebrow={partner?.organizationName || partner?.organization_name || 'Partner portal'}
        // FIXED — `user.fullName.split(' ')[0]` on a blank name yielded '' and
        // rendered a dangling "Welcome, ".
        title={`Welcome${firstName(user?.fullName) ? `, ${firstName(user.fullName)}` : ''}`}
        description="Search borrowers, review forwarded financing requests, and monitor your portfolio risk."
        actions={
          <>
            <Button variant="secondary" onClick={() => navigate('/partner/search')}>
              <Search className="size-4" /> Search borrowers
            </Button>
            <Button onClick={() => navigate('/partner/financing')}>
              <Banknote className="size-4" /> Review requests
            </Button>
          </>
        }
      />

      {/* FIXED — no error state: a failed request rendered zeroes, which a
          lender would read as "this network has no borrowers". */}
      {isError && (
        <Card padded className="mb-6 border-red-200 bg-red-50/60">
          <p className="text-sm text-red-700">
            Could not load your dashboard{error?.message ? `: ${error.message}` : ''}. The figures below are unavailable, not zero.
          </p>
        </Card>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {isLoading ? (
          <>{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32" />)}</>
        ) : (
          <>
            {/* FIXED — these two read `cooperativesInSystem` /
                `farmersInSystem`, which the dashboard controller computes as a
                count of EVERY cooperative and farmer on the platform, but the
                captions said "In your network" / implied they were the
                partner's own. Relabelled to match what the number actually is. */}
            <MetricCard
              label="Cooperatives"
              value={formatNumber(totals.cooperativesInSystem)}
              sub="On the CoopScore network"
              icon={Users}
              to="/partner/cooperatives"
            />
            <MetricCard
              label="Farmers"
              value={formatNumber(totals.farmersInSystem)}
              sub="On the CoopScore network"
              icon={Sprout}
              to="/partner/farmers"
            />
            <MetricCard
              label="Pending requests"
              value={formatNumber(totals.requestsPending)}
              sub="Awaiting your decision"
              tone="accent"
              icon={Banknote}
              to="/partner/financing"
            />
            <MetricCard
              label="Approved"
              value={formatNumber(totals.requestsApproved)}
              sub="Financed by you"
              tone="primary"
              icon={TrendingUp}
              to="/partner/portfolio"
            />
          </>
        )}
      </div>

      {!isLoading && data?.money && (
        <Card
          className="mb-6 cursor-pointer hover:shadow-md transition-all group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-forest-500/40"
          role="button"
          tabIndex={0}
          aria-label="Open portfolio"
          onClick={() => navigate('/partner/portfolio')}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate('/partner/portfolio'); }
          }}
        >
          <div className="flex items-center justify-between mb-3">
            <p className="eyebrow">Lending summary</p>
            <ArrowUpRight className="size-4 text-smoke opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MoneyStat label="Total loaned" value={formatNaira(data.money.totalLoaned)} />
            <MoneyStat label="Total repaid" value={formatNaira(data.money.totalRepaid)} />
            <MoneyStat label="Outstanding" value={formatNaira(data.money.totalOutstanding)} />
            {/* repaymentRate is a percentage with one decimal, already
                computed server-side — don't recompute or round it here. */}
            <MoneyStat label="Repayment rate" value={`${formatScore(data.money.repaymentRate ?? 0)}%`} accent />
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <div className="flex items-center justify-between mb-6">
            <div>
              <p className="eyebrow">Your portfolio</p>
              <h3 className="font-display text-xl font-semibold">Risk distribution</h3>
            </div>
            <Button variant="ghost" onClick={() => navigate('/partner/watchlist')}>
              Watchlist <ArrowUpRight className="size-4" />
            </Button>
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
                    <div className="flex items-center gap-2.5">
                      <span className="size-2.5 rounded-sm" style={{ background: TIER_COLORS[d.tier] }} />
                      <TierPill tier={d.tier} />
                    </div>
                    <span className="font-display text-2xl font-semibold tabular">{formatNumber(d.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>

        <Card>
          <div className="flex items-center justify-between mb-6">
            <div>
              <p className="eyebrow">Quick access</p>
              <h3 className="font-display text-xl font-semibold">Find your next borrower</h3>
            </div>
          </div>
          <div className="space-y-3">
            <QuickAction icon={Search} title="Search any borrower" desc="Find cooperatives or individual farmers by name." onClick={() => navigate('/partner/search')} />
            <QuickAction icon={Sprout} title="Browse portfolio" desc="See every cooperative you've ever financed, with current scores." onClick={() => navigate('/partner/portfolio')} />
            <QuickAction icon={AlertTriangle} title="Risk watchlist" desc="High-risk borrowers (Tier C, D) you've financed." onClick={() => navigate('/partner/watchlist')} />
          </div>
        </Card>
      </div>
    </>
  );
}

function QuickAction({ icon: Icon, title, desc, onClick }) {
  return (
    <button type="button" onClick={onClick} className="w-full flex items-start gap-3 p-3 rounded-xl hover:bg-bone transition text-left">
      <div className="size-10 rounded-lg bg-forest-50 text-forest-500 flex items-center justify-center shrink-0">
        <Icon className="size-5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm">{title}</p>
        <p className="text-xs text-smoke">{desc}</p>
      </div>
      <ArrowUpRight className="size-4 text-smoke" />
    </button>
  );
}

function MoneyStat({ label, value, accent }) {
  return (
    <div className="rounded-xl bg-bone/60 p-3">
      <p className="text-[11px] text-smoke uppercase tracking-wide">{label}</p>
      <p className={`font-display text-lg font-bold mt-0.5 ${accent ? 'text-harvest-600' : 'text-ink'}`}>{value}</p>
    </div>
  );
}

function firstName(full) {
  if (!full || typeof full !== 'string') return '';
  return full.trim().split(/\s+/)[0] || '';
}
