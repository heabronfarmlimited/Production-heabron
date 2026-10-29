import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Banknote } from 'lucide-react';
import api from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, Pagination } from '@/components/ui/DataTable';
import { EmptyState, StatusPill, TierPill } from '@/components/ui/Card';
import { Card } from '@/components/ui/Card';
import { formatNaira, relativeTime, humanize, formatScore } from '@/lib/utils';

const PAGE_SIZE = 25;

// createFinancingRequest.season: wet | dry | all_year.
const SEASON_LABELS = { wet: 'Wet', dry: 'Dry', all_year: 'All Year' };

// financing_status enum — the only values the `status` filter accepts.
const STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'disbursed', label: 'Disbursed' },
  { value: 'completed', label: 'Completed' },
];

export default function PartnerFinancingPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');

  // FIXED — api.raw bypass replaced with the list helper (keeps `meta`).
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['partner-financing', status, page],
    queryFn: () =>
      api.list('/partner/financing-requests', { params: { status: status || undefined, page, pageSize: PAGE_SIZE } }),
  });

  const rows = data?.data || [];
  const meta = data?.meta;

  return (
    <>
      <PageHeader
        eyebrow="Inbound"
        title="Financing Requests"
        description="Loan requests forwarded to your organization by Heabron CoopScore."
      />

      <div className="flex flex-wrap gap-2 mb-4">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s.value}
            type="button"
            aria-pressed={status === s.value}
            onClick={() => { setStatus(s.value); setPage(1); }}
            className={`px-3 py-1.5 rounded-lg text-sm ${
              status === s.value ? 'bg-forest-500 text-white' : 'bg-white text-smoke hover:bg-bone'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {isError && (
        <Card padded className="mb-4 border-red-200 bg-red-50/60">
          <p className="text-sm text-red-700">Could not load your financing requests{error?.message ? `: ${error.message}` : ''}.</p>
        </Card>
      )}

      <DataTable
        loading={isLoading}
        empty={<EmptyState icon={Banknote} title={status ? `No ${status} requests` : 'No requests yet'} description="When the admin team forwards a financing request to you, it'll show up here." />}
        onRowClick={(r) => navigate(`/partner/financing/${r.id}`)}
        columns={[
          { key: 'cooperative', label: 'Cooperative', render: (r) => (
            <div>
              <p className="font-semibold">{r.cooperatives?.name || 'Unknown cooperative'}</p>
              {/* `|| '—'` turned a real score of 0 into an em-dash and a null
                  one into "score —"; formatScore distinguishes the two. */}
              <p className="text-xs text-smoke">Avg score {formatScore(r.cooperatives?.average_credit_score)}</p>
            </div>
          )},
          { key: 'amount', label: 'Amount', align: 'right', render: (r) => <span className="font-semibold">{formatNaira(r.loan_amount)}</span> },
          { key: 'tier', label: 'Tier', render: (r) => <TierPill tier={r.cooperatives?.cooperative_tier} /> },
          // FIXED — printed the raw enum ("all_year").
          { key: 'season', label: 'Season', render: (r) => SEASON_LABELS[r.season] || humanize(r.season) || '—' },
          // forwarded_at is when it actually reached this partner; created_at is
          // when the agent submitted it. Prefer the former, fall back.
          { key: 'created_at', label: 'Forwarded', render: (r) => relativeTime(r.forwarded_at || r.created_at) || '—' },
          { key: 'status', label: 'Decision', render: (r) => <StatusPill status={r.partner_decision || 'pending'} /> },
        ]}
        rows={rows}
      />
      <Pagination page={meta?.page || page} pageSize={meta?.pageSize || PAGE_SIZE} total={meta?.total || 0} onPageChange={setPage} />
    </>
  );
}
