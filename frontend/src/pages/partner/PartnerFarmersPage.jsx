import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Search, Eye } from 'lucide-react';
import api from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, TierPill, EmptyState, Skeleton, StatusPill } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Input';
import { Pagination } from '@/components/ui/DataTable';
import { initials, formatScore } from '@/lib/utils';

const PAGE_SIZE = 25;

export default function PartnerFarmersPage() {
  const navigate = useNavigate();
  const [term, setTerm] = useState('');
  const [agentId, setAgentId] = useState('');
  const [tier, setTier] = useState('');
  const [page, setPage] = useState(1);

  // Plain array response (no meta) — unwrapped `get` is correct here.
  const { data: agents } = useQuery({
    queryKey: ['partner-field-agents'],
    queryFn: () => api.get('/partner/field-agents'),
  });

  // FIXED — api.raw bypass replaced with the list helper, and the page now
  // paginates instead of silently truncating the directory at 60 farmers.
  // `tier` must be the uppercase enum A-D.
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['partner-farmers', term, agentId, tier, page],
    queryFn: () =>
      api.list('/partner/farmers', {
        params: { search: term || undefined, agentId: agentId || undefined, tier: tier || undefined, page, pageSize: PAGE_SIZE },
      }),
  });
  const rows = data?.data || [];

  return (
    <>
      <PageHeader
        eyebrow="Borrower network"
        title="All farmers"
        description="Complete farmer directory with credit scores — open any profile for the full picture, even before a request reaches you."
      />

      <Card padded className="mb-6">
        <div className="flex flex-col lg:flex-row gap-3">
          <div className="flex-1 relative">
            <Search className="size-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-smoke" />
            <Input
              value={term}
              aria-label="Search farmers by name"
              onChange={(e) => { setTerm(e.target.value); setPage(1); }}
              placeholder="Search farmers by name..."
              className="pl-10"
            />
          </div>
          <Select
            value={agentId}
            aria-label="Filter farmers by managing field agent"
            onChange={(e) => { setAgentId(e.target.value); setPage(1); }}
            className="lg:w-56"
          >
            <option value="">All field agents</option>
            {(Array.isArray(agents) ? agents : []).map((a) => (
              <option key={a.user_id} value={a.user_id}>{a.full_name || a.user_id}</option>
            ))}
          </Select>
          {/* Values are the uppercase credit_tier enum the validator accepts —
              the visible label ("Grade A") is display-only. */}
          <Select
            value={tier}
            aria-label="Filter farmers by credit grade"
            onChange={(e) => { setTier(e.target.value); setPage(1); }}
            className="lg:w-40"
          >
            <option value="">All grades</option>
            <option value="A">Grade A — Excellent</option>
            <option value="B">Grade B — Good</option>
            <option value="C">Grade C — Moderate</option>
            <option value="D">Grade D — At risk</option>
          </Select>
        </div>
      </Card>

      {/* FIXED — no error state: a failed request rendered "No farmers found". */}
      {isError && (
        <Card padded className="mb-4 border-red-200 bg-red-50/60">
          <p className="text-sm text-red-700">
            Could not load farmers{error?.message ? `: ${error.message}` : ''}.
          </p>
        </Card>
      )}

      {isLoading ? (
        <Skeleton className="h-96" />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No farmers found"
          description={term || agentId || tier ? 'Try a different search, grade, or field-agent filter.' : 'Farmers appear here once field agents onboard them.'}
        />
      ) : (
        <Card padded={false} className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase text-smoke border-b border-whisper/60 bg-bone/40">
                  <th className="py-3 px-4">Farmer</th>
                  <th className="py-3 px-4">Crop</th>
                  <th className="py-3 px-4">Cooperative</th>
                  <th className="py-3 px-4">NIN</th>
                  <th className="py-3 px-4">Grade</th>
                  <th className="py-3 px-4">Score</th>
                  <th className="py-3 px-4"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((f) => {
                  // The API shapes these joins into `farm` / `creditScore`
                  // (camelCase) and keeps the raw snake_case arrays for
                  // back-compat; prefer the contract fields and fall back.
                  const rawFarm = Array.isArray(f.farm_profiles) ? f.farm_profiles[0] : f.farm_profiles;
                  const rawScore = Array.isArray(f.credit_scores) ? f.credit_scores[0] : f.credit_scores;
                  const crop = f.farm?.cropType ?? rawFarm?.crop_type;
                  const tierValue = f.creditScore?.creditTier ?? rawScore?.credit_tier ?? f.credit_tier;
                  const scoreValue = f.creditScore?.finalCreditScore ?? rawScore?.final_credit_score ?? f.credit_score;
                  return (
                    <tr
                      key={f.id}
                      className="border-b border-whisper/40 last:border-0 hover:bg-bone/40 cursor-pointer focus-visible:outline-none focus-visible:bg-bone"
                      tabIndex={0}
                      role="button"
                      onClick={() => navigate(`/partner/reports/farmer/${f.id}`)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/partner/reports/farmer/${f.id}`); }
                      }}
                    >
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <div className="size-9 rounded-full bg-forest-50 grid place-items-center text-forest-700 text-xs font-semibold">
                            {initials(f.full_name)}
                          </div>
                          <div>
                            <div className="font-medium text-ink">{f.full_name}</div>
                            <div className="text-[11px] text-smoke capitalize">{f.gender || ''}{f.lga ? ` · ${f.lga}` : ''}</div>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 capitalize">{crop || '—'}</td>
                      <td className="py-3 px-4 text-smoke">{f.cooperatives?.name || '—'}</td>
                      <td className="py-3 px-4">
                        <StatusPill status={f.nin_verification_status || 'pending'} />
                      </td>
                      <td className="py-3 px-4"><TierPill tier={tierValue} /></td>
                      <td className="py-3 px-4 font-semibold text-ink tabular">{formatScore(scoreValue, 0)}</td>
                      <td className="py-3 px-4 text-right">
                        <Eye className="size-4 text-smoke inline" aria-hidden="true" />
                        <span className="sr-only">Open credit report</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
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
