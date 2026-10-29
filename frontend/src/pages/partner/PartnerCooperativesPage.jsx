import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Search, MapPin, Users, Eye } from 'lucide-react';
import api from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, TierPill, EmptyState, Skeleton } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Pagination } from '@/components/ui/DataTable';
import { formatNumber, formatScore } from '@/lib/utils';

const PAGE_SIZE = 24;

export default function PartnerCooperativesPage() {
  const navigate = useNavigate();
  const [term, setTerm] = useState('');
  const [agentId, setAgentId] = useState('');
  const [page, setPage] = useState(1);

  // /partner/field-agents returns a plain array (no meta), so the unwrapped
  // `get` is the right client here.
  const { data: agents } = useQuery({
    queryKey: ['partner-field-agents'],
    queryFn: () => api.get('/partner/field-agents'),
  });

  // FIXED — api.raw bypass replaced with the list helper, which keeps `meta`.
  // The page also threw away everything past the first 60 rows with no
  // pagination at all; `pageSize` is now a real page and `meta.total` drives
  // the pager (pageSize is capped at 100 server-side).
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['partner-cooperatives', term, agentId, page],
    queryFn: () =>
      api.list('/partner/cooperatives', {
        params: { search: term || undefined, agentId: agentId || undefined, page, pageSize: PAGE_SIZE },
      }),
  });
  const rows = data?.data || [];

  return (
    <>
      <PageHeader
        eyebrow="Borrower network"
        title="All cooperatives"
        description="Browse every cooperative in the network — including those not yet sent to you — and open a full credit report."
      />

      <Card padded className="mb-6">
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="flex-1 relative">
            <Search className="size-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-smoke" />
            <Input
              value={term}
              aria-label="Search cooperatives by name"
              onChange={(e) => { setTerm(e.target.value); setPage(1); }}
              placeholder="Search cooperatives..."
              className="pl-10"
            />
          </div>
          <Select
            value={agentId}
            aria-label="Filter cooperatives by managing field agent"
            onChange={(e) => { setAgentId(e.target.value); setPage(1); }}
            className="sm:w-64"
          >
            <option value="">All field agents</option>
            {(Array.isArray(agents) ? agents : []).map((a) => (
              <option key={a.user_id} value={a.user_id}>
                {a.full_name}{a.state ? ` · ${a.state}` : ''}
              </option>
            ))}
          </Select>
        </div>
      </Card>

      {/* FIXED — no error state: a failed request showed "No cooperatives
          found", telling a lender the network is empty. */}
      {isError && (
        <Card padded className="mb-4 border-red-200 bg-red-50/60">
          <p className="text-sm text-red-700">
            Could not load cooperatives{error?.message ? `: ${error.message}` : ''}.
          </p>
        </Card>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-52" />)}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No cooperatives found"
          description={term || agentId ? 'Try a different search or field-agent filter.' : 'Cooperatives appear here once field agents register them.'}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {rows.map((c) => {
            return (
              <Card key={c.id} className="flex flex-col">
                <div className="flex items-start justify-between gap-2">
                  <div className="size-10 rounded-xl bg-forest-50 grid place-items-center text-forest-600">
                    <Users className="size-5" />
                  </div>
                  <TierPill tier={c.cooperative_tier} />
                </div>
                <h3 className="font-display text-lg font-semibold text-ink mt-3 leading-snug">{c.name}</h3>
                <p className="text-xs text-smoke flex items-center gap-1 mt-1">
                  <MapPin className="size-3" /> {[c.lga, c.state].filter(Boolean).join(', ') || '—'}
                </p>
                <div className="flex items-center gap-3 text-xs text-smoke mt-1">
                  <span>{formatNumber(c.total_farmers ?? c.total_members ?? 0)} members</span>
                  <span>·</span>
                  <span>{formatNumber(c.scored_farmers || 0)} scored</span>
                </div>

                {/* FIXED — this card used to render an A/B/C/D "tier mix" grid
                    from c.tier_a_count … c.tier_d_count. partner.browse-
                    Cooperatives only selects average_score, cooperative_tier,
                    total_farmers and scored_farmers from the score join, so
                    those four fields are never returned: the grid showed a
                    hard "0" in all four buckets for every cooperative on the
                    page — invented data a lender could act on. Removed; the
                    real per-tier breakdown is on the cooperative's credit
                    report, which "View details" opens. */}
                <div className="mt-3 rounded-xl bg-bone/60 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-smoke">Avg credit score</span>
                    {/* `|| 0` printed "0/100" for an unscored cooperative,
                        which reads as a real (terrible) score. */}
                    <span className="font-display text-lg font-bold text-forest-700">
                      {c.average_score == null || Number(c.average_score) === 0 ? (
                        <span className="text-smoke text-sm font-medium">Not yet scored</span>
                      ) : (
                        <>{formatScore(c.average_score, 0)}<span className="text-xs text-smoke">/100</span></>
                      )}
                    </span>
                  </div>
                </div>

                <Button
                  variant="secondary"
                  className="mt-3 w-full"
                  onClick={() => navigate(`/partner/reports/cooperative/${c.id}`)}
                >
                  <Eye className="size-4" /> View details
                </Button>
              </Card>
            );
          })}
        </div>
      )}

      <Pagination
        page={data?.meta?.page || page}
        pageSize={data?.meta?.pageSize || PAGE_SIZE}
        total={data?.meta?.total || 0}
        onPageChange={setPage}
      />
    </>
  );
}
