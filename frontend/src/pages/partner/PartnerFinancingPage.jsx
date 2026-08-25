import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Banknote } from 'lucide-react';
import api from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, Pagination } from '@/components/ui/DataTable';
import { EmptyState, StatusPill, TierPill } from '@/components/ui/Card';
import { formatNaira, relativeTime } from '@/lib/utils';

export default function PartnerFinancingPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['partner-financing', status, page],
    queryFn: () =>
      api.raw.get('/partner/financing-requests', { params: { status: status || undefined, page, pageSize: 25 } }).then((r) => r.data),
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
        {[
          { v: '', label: 'All' },
          { v: 'pending', label: 'Pending' },
          { v: 'approved', label: 'Approved' },
          { v: 'rejected', label: 'Rejected' },
          { v: 'disbursed', label: 'Disbursed' },
          { v: 'completed', label: 'Completed' },
        ].map((s) => (
          <button
            key={s.v}
            onClick={() => { setStatus(s.v); setPage(1); }}
            className={`px-3 py-1.5 rounded-lg text-sm ${
              status === s.v ? 'bg-forest-500 text-white' : 'bg-white text-smoke hover:bg-bone'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <DataTable
        loading={isLoading}
        empty={<EmptyState icon={Banknote} title="No requests yet" description="When the admin team forwards a financing request to you, it'll show up here." />}
        onRowClick={(r) => navigate(`/partner/financing/${r.id}`)}
        columns={[
          { key: 'cooperative', label: 'Cooperative', render: (r) => (
            <div>
              <p className="font-semibold">{r.cooperatives?.name}</p>
              <p className="text-xs text-smoke">Tier {r.cooperatives?.cooperative_tier || '—'} · score {r.cooperatives?.average_credit_score || '—'}</p>
            </div>
          )},
          { key: 'amount', label: 'Amount', align: 'right', render: (r) => <span className="font-semibold">{formatNaira(r.loan_amount)}</span> },
          { key: 'tier', label: 'Tier', render: (r) => <TierPill tier={r.cooperatives?.cooperative_tier} /> },
          { key: 'season', label: 'Season', render: (r) => <span className="capitalize">{r.season}</span> },
          { key: 'created_at', label: 'Forwarded', render: (r) => relativeTime(r.created_at) },
          { key: 'status', label: 'Decision', render: (r) => <StatusPill status={r.partner_decision || 'pending'} /> },
        ]}
        rows={rows}
      />
      {meta && <Pagination page={meta.page} pageSize={meta.pageSize} total={meta.total} onPageChange={setPage} />}
    </>
  );
}
