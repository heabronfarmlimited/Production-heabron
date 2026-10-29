import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Search, Users, Sprout } from 'lucide-react';
import api from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, TierPill, EmptyState, Skeleton } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { cn, formatNumber, formatScore, initials } from '@/lib/utils';

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

  // FIXED — api.raw bypass replaced with the client. /partner/search answers
  // with `ok()` (an object, no meta), so the unwrapped `get` is correct.
  // The backend expects `q` (and an optional `type`) — not `search`.
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['partner-search', submitted],
    queryFn: () => api.get('/partner/search', { params: { q: submitted } }),
    enabled: submitted.length > 1,
  });

  const coops = data?.cooperatives || [];
  const farmers = data?.farmers || [];
  const noResults = !!submitted && !isLoading && !isError && coops.length === 0 && farmers.length === 0;

  return (
    <>
      {/* FIXED — the copy promised a search over "anyone in the CoopScore
          network", but partner.search is deliberately scoped to cooperatives
          and farmers that have been forwarded to this organization (and the
          members of those cooperatives). A partner with no forwarded requests
          gets an empty result for every query, so the old wording read as a
          broken search. The full directory lives on the Cooperatives and
          Farmers pages, which this now points at. */}
      <PageHeader
        eyebrow="Borrower research"
        title="Search your borrowers"
        description="Searches cooperatives and farmers financed through your organization. To browse every borrower on the network, use the Cooperatives or Farmers pages."
      />

      <Card padded className="mb-6">
        <form onSubmit={(e) => { e.preventDefault(); setSubmitted(q.trim()); }} className="flex gap-2">
          <div className="flex-1 relative">
            <Search className="size-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-smoke" />
            <Input
              value={q}
              aria-label="Search for a cooperative or farmer by name"
              onChange={(e) => setQ(e.target.value)}
              placeholder="Type a cooperative or farmer name…"
              className="pl-10"
            />
          </div>
          {/* The backend ignores a query shorter than 2 characters. */}
          <button className="btn-primary" type="submit" disabled={q.trim().length < 2}>Search</button>
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

      {/* FIXED — a failed search, and a search with no hits, both rendered
          absolutely nothing: ResultSection returns null when empty, so the page
          just went blank below the search box. */}
      {isError && (
        <Card padded className="border-red-200 bg-red-50/60">
          <p className="text-sm text-red-700">
            Search failed{error?.message ? `: ${error.message}` : ''}. Please try again.
          </p>
        </Card>
      )}

      {noResults && (
        <EmptyState
          icon={Search}
          title={`No matches for "${submitted}"`}
          description="This search covers borrowers financed through your organization. Browse the full network from the Cooperatives or Farmers pages."
        />
      )}

      {submitted && !isLoading && !isError && (
        <>
          <ResultSection
            icon={Users}
            title="Cooperatives"
            rows={coops}
            renderRow={(c) => (
              <button type="button"
                key={c.id}
                onClick={() => navigate(`/partner/reports/cooperative/${c.id}`)}
                className="w-full flex items-center gap-4 p-4 rounded-xl hover:bg-bone transition text-left"
              >
                <div className="size-11 rounded-xl bg-forest-50 text-forest-500 flex items-center justify-center font-semibold">
                  {initials(c.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold truncate">{c.name}</p>
                  <p className="text-xs text-smoke">{[c.location, `${formatNumber(c.members || 0)} members`].filter(Boolean).join(' · ')}</p>
                </div>
                <div className="text-right">
                  <p className="font-display text-xl font-semibold tabular">{formatScore(c.score, 0)}</p>
                  <span className={cn('pill', RISK_COLORS[c.risk] || RISK_COLORS.unknown)}>{c.risk || 'unknown'}</span>
                </div>
                <TierPill tier={c.tier} />
              </button>
            )}
          />

          <ResultSection
            icon={Sprout}
            title="Farmers"
            rows={farmers}
            renderRow={(f) => (
              <button type="button"
                key={f.id}
                onClick={() => navigate(`/partner/reports/farmer/${f.id}`)}
                className="w-full flex items-center gap-4 p-4 rounded-xl hover:bg-bone transition text-left"
              >
                <div className="size-11 rounded-xl bg-harvest-50 text-harvest-600 flex items-center justify-center font-semibold">
                  {initials(f.name)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold truncate">{f.name}</p>
                  <p className="text-xs text-smoke truncate">{[f.cooperative || 'Independent', f.location].filter(Boolean).join(' · ')}</p>
                </div>
                <div className="text-right">
                  <p className="font-display text-xl font-semibold tabular">{formatScore(f.score, 0)}</p>
                  <span className={cn('pill', RISK_COLORS[f.risk] || RISK_COLORS.unknown)}>{f.risk || 'unknown'}</span>
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
  if (!Array.isArray(rows) || rows.length === 0) return null;
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
