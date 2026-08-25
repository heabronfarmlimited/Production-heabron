import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Search, Users, Sprout } from 'lucide-react';
import api from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, TierPill, EmptyState, Skeleton } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/utils';

const RISK_COLORS = {
  low: 'bg-forest-50 text-forest-700 ring-1 ring-forest-200',
  moderate: 'bg-harvest-50 text-harvest-700 ring-1 ring-harvest-200',
  high: 'bg-red-50 text-red-700 ring-1 ring-red-200',
  unknown: 'bg-bone text-smoke ring-1 ring-whisper',
};

export default function PartnerSearchPage() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [submitted, setSubmitted] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['partner-search', submitted],
    queryFn: () => api.raw.get('/partner/search', { params: { q: submitted } }).then((r) => r.data?.data),
    enabled: submitted.length > 1,
  });

  return (
    <>
      <PageHeader
        eyebrow="Borrower research"
        title="Find a cooperative or farmer"
        description="Search anyone in the CoopScore network. Pull a full credit report in a single click."
      />

      <Card padded className="mb-6">
        <form onSubmit={(e) => { e.preventDefault(); setSubmitted(q.trim()); }} className="flex gap-2">
          <div className="flex-1 relative">
            <Search className="size-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-smoke" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a cooperative or farmer name…" className="pl-10" />
          </div>
          <button className="btn-primary" type="submit">Search</button>
        </form>
      </Card>

      {!submitted && (
        <EmptyState
          icon={Search}
          title="Start by typing a name"
          description="You can search any cooperative or farmer onboarded to the Heabron CoopScore network."
        />
      )}

      {submitted && isLoading && (
        <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
      )}

      {submitted && !isLoading && (
        <>
          <ResultSection
            icon={Users}
            title="Cooperatives"
            rows={data?.cooperatives || []}
            renderRow={(c) => (
              <button
                key={c.id}
                onClick={() => navigate(`/partner/reports/cooperative/${c.id}`)}
                className="w-full flex items-center gap-4 p-4 rounded-xl hover:bg-bone transition text-left"
              >
                <div className="size-11 rounded-xl bg-forest-50 text-forest-500 flex items-center justify-center font-semibold">
                  {c.name?.[0]}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold truncate">{c.name}</p>
                  <p className="text-xs text-smoke">{c.location} · {c.members || 0} members</p>
                </div>
                <div className="text-right">
                  <p className="font-display text-xl font-semibold tabular">{c.score != null ? c.score : '—'}</p>
                  <span className={cn('pill', RISK_COLORS[c.risk])}>{c.risk}</span>
                </div>
                <TierPill tier={c.tier} />
              </button>
            )}
          />

          <ResultSection
            icon={Sprout}
            title="Farmers"
            rows={data?.farmers || []}
            renderRow={(f) => (
              <button
                key={f.id}
                onClick={() => navigate(`/partner/reports/farmer/${f.id}`)}
                className="w-full flex items-center gap-4 p-4 rounded-xl hover:bg-bone transition text-left"
              >
                <div className="size-11 rounded-xl bg-harvest-50 text-harvest-600 flex items-center justify-center font-semibold">
                  {f.name?.[0]}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold truncate">{f.name}</p>
                  <p className="text-xs text-smoke truncate">{f.cooperative || 'Independent'} · {f.location}</p>
                </div>
                <div className="text-right">
                  <p className="font-display text-xl font-semibold tabular">{f.score != null ? f.score : '—'}</p>
                  <span className={cn('pill', RISK_COLORS[f.risk])}>{f.risk}</span>
                </div>
                <TierPill tier={f.tier} />
              </button>
            )}
          />
        </>
      )}
    </>
  );
}

function ResultSection({ icon: Icon, title, rows, renderRow }) {
  if (!rows.length) return null;
  return (
    <Card className="mb-4">
      <div className="flex items-center gap-2 mb-4">
        <Icon className="size-4 text-forest-500" />
        <h3 className="font-display text-lg font-semibold">{title}</h3>
        <span className="text-xs text-smoke">({rows.length})</span>
      </div>
      <div className="space-y-1">{rows.map(renderRow)}</div>
    </Card>
  );
}
