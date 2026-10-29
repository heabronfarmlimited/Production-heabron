import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
// FIXED — Send and ArrowRight were imported but never rendered.
import { Banknote, Check, X, Forward, FileText } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState, StatusPill, TierPill, Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Field, Input, Textarea, Select } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { DataTable, Pagination } from '@/components/ui/DataTable';
import { formatNaira, formatDateTime, formatDate, humanize } from '@/lib/utils';

const PAGE_SIZE = 20;

// financing_status enum — the only values the backend `status` filter accepts.
const STATUSES = ['pending', 'approved', 'disbursed', 'completed', 'rejected'];

// createFinancingRequest.season: wet | dry | all_year. Labels match the field
// app's mobile/src/core/api/domainConstants.ts FINANCING_SEASONS.
const SEASON_LABELS = { wet: 'Wet', dry: 'Dry', all_year: 'All Year' };

export default function FinancingPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('pending');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);

  // FIXED — api.raw bypass replaced with the list helper (keeps `meta`).
  const { data: list, isLoading, isError, error } = useQuery({
    queryKey: ['admin-financing', { status, page }],
    queryFn: () => api.list('/admin/financing-requests', { params: { status, page, pageSize: PAGE_SIZE } }),
  });

  const columns = [
    {
      key: 'coop',
      label: 'Cooperative',
      render: (r) => (
        <div>
          <p className="font-medium text-ink">{r.cooperatives?.name || 'Unknown cooperative'}</p>
          {r.farmers?.full_name && <p className="text-xs text-smoke">For: {r.farmers.full_name}</p>}
        </div>
      ),
    },
    { key: 'amount', label: 'Amount', align: 'right', render: (r) => <span className="font-display font-semibold">{formatNaira(r.loan_amount)}</span> },
    { key: 'purpose', label: 'Purpose', render: (r) => <span className="text-smoke text-sm line-clamp-1 max-w-xs">{r.purpose || '—'}</span> },
    {
      key: 'tier',
      label: 'Coop Tier',
      render: (r) => <TierPill tier={r.cooperatives?.cooperative_tier} />,
    },
    {
      key: 'status',
      label: 'Status',
      render: (r) => (
        <div className="flex items-center gap-2">
          <StatusPill status={r.status} />
          {r.status === 'approved' && r.forwarded_to_partner_id && !r.partner_decision && (
            <span className="text-[10px] uppercase tracking-wide text-smoke">Awaiting partner</span>
          )}
        </div>
      ),
    },
    { key: 'submitted', label: 'Submitted', render: (r) => <span className="text-xs text-smoke">{formatDateTime(r.created_at)}</span> },
    {
      key: 'actions',
      label: '',
      align: 'right',
      // FIXED — /admin/financing/:requestId (FinancingDetailPage, the only
      // place a loan can actually be disbursed or forwarded) had no link
      // anywhere in the app, so the route was dead. The row now opens it and
      // the quick-review modal keeps its own button.
      render: (r) => (
        <div className="flex items-center justify-end gap-1.5">
          <Button variant="ghost" onClick={(e) => { e.stopPropagation(); setSelected(r); }}>Quick review</Button>
          <Button variant="secondary" onClick={(e) => { e.stopPropagation(); navigate(`/admin/financing/${r.id}`); }}>
            <FileText className="size-4" /> Open
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Capital flows"
        title="Financing Requests"
        description="Approve or reject requests submitted by field agents. You can also forward them to partner lenders."
      />

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {STATUSES.map((s) => (
          <button type="button"
            key={s}
            onClick={() => { setStatus(s); setPage(1); }}
            className={`px-4 py-1.5 rounded-full text-sm font-medium capitalize transition ${status === s ? 'bg-forest-500 text-white' : 'bg-white border border-whisper text-smoke hover:text-ink'}`}
          >
            {s}
          </button>
        ))}
      </div>

      {isError && (
        <Card padded className="mb-4 border-red-200 bg-red-50/60">
          <p className="text-sm text-red-700">Could not load financing requests{error?.message ? `: ${error.message}` : ''}.</p>
        </Card>
      )}

      <DataTable
        loading={isLoading}
        columns={columns}
        rows={list?.data}
        onRowClick={(r) => navigate(`/admin/financing/${r.id}`)}
        empty={
          <EmptyState
            icon={Banknote}
            title={`No ${status} requests`}
            description="Field agents submit financing requests from the mobile app."
          />
        }
      />
      <Pagination page={page} pageSize={list?.meta?.pageSize || PAGE_SIZE} total={list?.meta?.total || 0} onPageChange={setPage} />

      {selected && (
        <FinancingDecisionModal
          request={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}

function FinancingDecisionModal({ request, onClose }) {
  const qc = useQueryClient();
  const [decision, setDecision] = useState('approved');
  const [approvedAmount, setApprovedAmount] = useState(request.loan_amount);
  const [dueDate, setDueDate] = useState('');
  const [forwardToPartnerId, setForwardTo] = useState('');
  const [adminComments, setComments] = useState('');
  const [rejectionReason, setReason] = useState('');

  // pageSize is capped at 100 by the listQuery validator.
  const { data: partners } = useQuery({
    queryKey: ['admin-partners-list'],
    queryFn: () => api.list('/admin/partners', { params: { status: 'active', pageSize: 100 } }),
  });
  const partnerOptions = partners?.data || [];

  const submit = useMutation({
    mutationFn: () => {
      // `decision` here is already the past-tense enum the admin validator
      // accepts ('approved' | 'rejected' | 'disbursed'); approvedAmount must be
      // a positive number, so never send NaN from an emptied input.
      const amount = Number(approvedAmount);
      return api.post(`/admin/financing-requests/${request.id}/decision`, {
        decision,
        approvedAmount: decision !== 'rejected' && Number.isFinite(amount) && amount > 0 ? amount : undefined,
        dueDate: dueDate || undefined,
        adminComments: adminComments.trim() || undefined,
        rejectionReason: decision === 'rejected' ? rejectionReason.trim() : undefined,
        forwardToPartnerId: decision === 'approved' && forwardToPartnerId ? forwardToPartnerId : undefined,
      });
    },
    onSuccess: () => {
      toast.success('Decision recorded');
      qc.invalidateQueries({ queryKey: ['admin-financing'] });
      qc.invalidateQueries({ queryKey: ['admin-dashboard'] });
      onClose();
    },
    onError: (e) => {
      const detail = e?.details?.[0];
      if (detail) toast.error(`${detail.field}: ${detail.message}`);
    },
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={`Financing for ${request.cooperatives?.name || 'cooperative'}`}
      description={request.purpose}
      size="lg"
      footer={
        request.status === 'pending' ? (
          <>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <Button
              loading={submit.isPending}
              onClick={() => submit.mutate()}
              variant={decision === 'rejected' ? 'danger' : 'primary'}
              disabled={decision === 'rejected' && !rejectionReason.trim()}
            >
              {decision === 'rejected' ? <><X className="size-4"/> Reject request</> :
                forwardToPartnerId ? <><Forward className="size-4"/> Approve & Forward</> :
                <><Check className="size-4"/> Approve request</>}
            </Button>
          </>
        ) : null
      }
    >
      <div className="grid grid-cols-2 gap-4 text-sm mb-6">
        <div><span className="label">Requested</span><p className="font-display text-xl font-semibold">{formatNaira(request.loan_amount)}</p></div>
        {/* FIXED — only replaced the FIRST underscore, so 'all_year' rendered
            as "All year" but a multi-word value kept its separators. */}
        <div><span className="label">Season</span><p>{SEASON_LABELS[request.season] || humanize(request.season) || '—'}</p></div>
        <div><span className="label">Repayment window</span><p>{request.repayment_window_days ?? '—'} days</p></div>
        <div><span className="label">Cooperative</span><p>{request.cooperatives?.name || '—'}</p></div>
      </div>

      {request.status === 'pending' && (
        <>
          <p className="label mb-2">Decision</p>
          <div className="grid grid-cols-2 gap-2 mb-5">
            <button
              type="button"
              onClick={() => setDecision('approved')}
              className={`p-4 rounded-xl border-2 text-left transition ${decision === 'approved' ? 'border-forest-500 bg-forest-50' : 'border-whisper hover:border-forest-200'}`}
            >
              <div className="flex items-center gap-2 mb-1">
                <Check className="size-4 text-forest-600" />
                <span className="font-semibold">Approve</span>
              </div>
              <p className="text-xs text-smoke">Approve the loan in-house, or forward to a partner.</p>
            </button>
            <button
              type="button"
              onClick={() => setDecision('rejected')}
              className={`p-4 rounded-xl border-2 text-left transition ${decision === 'rejected' ? 'border-red-500 bg-red-50' : 'border-whisper hover:border-red-200'}`}
            >
              <div className="flex items-center gap-2 mb-1">
                <X className="size-4 text-red-600" />
                <span className="font-semibold">Reject</span>
              </div>
              <p className="text-xs text-smoke">Reject the request with a reason. Agent will be notified.</p>
            </button>
          </div>

          {decision === 'approved' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Approved amount (₦)">
                  <Input type="number" value={approvedAmount} onChange={(e) => setApprovedAmount(e.target.value)} />
                </Field>
                <Field label="Repayment due date">
                  <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                </Field>
              </div>
              <Field label="Forward to partner (optional)" hint="If chosen, the partner organization will be emailed to make the final decision.">
                <Select value={forwardToPartnerId} onChange={(e) => setForwardTo(e.target.value)}>
                  <option value="">Keep in-house</option>
                  {partnerOptions.map((p) => (
                    <option key={p.id} value={p.id}>{p.organization_name}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Admin notes (optional)">
                <Textarea rows={2} value={adminComments} onChange={(e) => setComments(e.target.value)} />
              </Field>
            </div>
          )}

          {decision === 'rejected' && (
            <Field label="Rejection reason" required>
              <Textarea rows={3} value={rejectionReason} onChange={(e) => setReason(e.target.value)} placeholder="Explain why the request is being rejected." />
            </Field>
          )}
        </>
      )}

      {request.status !== 'pending' && (
        <Card className="bg-bone">
          <div className="grid grid-cols-2 gap-4 text-sm">
            {request.approved_amount != null && (<div><span className="label">Approved amount</span><p>{formatNaira(request.approved_amount)}</p></div>)}
            {request.due_date && (<div><span className="label">Due date</span><p>{formatDate(request.due_date)}</p></div>)}
            {request.rejection_reason && (<div className="col-span-2"><span className="label">Rejection reason</span><p>{request.rejection_reason}</p></div>)}
            {request.admin_comments && (<div className="col-span-2"><span className="label">Admin notes</span><p>{request.admin_comments}</p></div>)}
          </div>
        </Card>
      )}
    </Modal>
  );
}
