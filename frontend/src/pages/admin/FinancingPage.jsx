import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Banknote, Send, Check, X, ArrowRight, Forward } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState, StatusPill, TierPill, Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Field, Input, Textarea, Select } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { DataTable, Pagination } from '@/components/ui/DataTable';
import { formatNaira, formatDateTime, formatDate } from '@/lib/utils';

export default function FinancingPage() {
  const [status, setStatus] = useState('pending');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);

  const { data: list, isLoading } = useQuery({
    queryKey: ['admin-financing', { status, page }],
    queryFn: () => api.raw.get('/admin/financing-requests', { params: { status, page, pageSize: 20 } }).then((r) => r.data),
  });

  const columns = [
    {
      key: 'coop',
      label: 'Cooperative',
      render: (r) => (
        <div>
          <p className="font-medium text-ink">{r.cooperatives?.name}</p>
          {r.farmers?.full_name && <p className="text-xs text-smoke">For: {r.farmers.full_name}</p>}
        </div>
      ),
    },
    { key: 'amount', label: 'Amount', align: 'right', render: (r) => <span className="font-display font-semibold">{formatNaira(r.loan_amount)}</span> },
    { key: 'purpose', label: 'Purpose', render: (r) => <span className="text-smoke text-sm line-clamp-1 max-w-xs">{r.purpose}</span> },
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
    { key: 'actions', label: '', align: 'right', render: (r) => <Button variant="secondary" onClick={() => setSelected(r)}>Review</Button> },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Capital flows"
        title="Financing Requests"
        description="Approve or reject requests submitted by field agents. You can also forward them to partner lenders."
      />

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        {['pending', 'approved', 'disbursed', 'completed', 'rejected'].map((s) => (
          <button
            key={s}
            onClick={() => { setStatus(s); setPage(1); }}
            className={`px-4 py-1.5 rounded-full text-sm font-medium capitalize transition ${status === s ? 'bg-forest-500 text-white' : 'bg-white border border-whisper text-smoke hover:text-ink'}`}
          >
            {s}
          </button>
        ))}
      </div>

      <DataTable
        loading={isLoading}
        columns={columns}
        rows={list?.data || []}
        empty={<EmptyState icon={Banknote} title={`No ${status} requests`} />}
      />
      <Pagination page={page} pageSize={20} total={list?.meta?.total || 0} onPageChange={setPage} />

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

  const { data: partners } = useQuery({
    queryKey: ['admin-partners-list'],
    queryFn: () => api.get('/admin/partners?pageSize=100'),
  });

  const submit = useMutation({
    mutationFn: () =>
      api.post(`/admin/financing-requests/${request.id}/decision`, {
        decision,
        approvedAmount: decision !== 'rejected' ? Number(approvedAmount) : undefined,
        dueDate: dueDate || undefined,
        adminComments: adminComments || undefined,
        rejectionReason: decision === 'rejected' ? rejectionReason : undefined,
        forwardToPartnerId: decision === 'approved' && forwardToPartnerId ? forwardToPartnerId : undefined,
      }),
    onSuccess: () => {
      toast.success('Decision recorded');
      qc.invalidateQueries({ queryKey: ['admin-financing'] });
      qc.invalidateQueries({ queryKey: ['admin-dashboard'] });
      onClose();
    },
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={`Financing for ${request.cooperatives?.name}`}
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
        <div><span className="label">Season</span><p className="capitalize">{request.season?.replace('_', ' ')}</p></div>
        <div><span className="label">Repayment window</span><p>{request.repayment_window_days} days</p></div>
        <div><span className="label">Cooperative</span><p>{request.cooperatives?.name}</p></div>
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
                  {(partners || []).filter((p) => p.status === 'active').map((p) => (
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
            {request.approved_amount && (<div><span className="label">Approved amount</span><p>{formatNaira(request.approved_amount)}</p></div>)}
            {request.due_date && (<div><span className="label">Due date</span><p>{formatDate(request.due_date)}</p></div>)}
            {request.rejection_reason && (<div className="col-span-2"><span className="label">Rejection reason</span><p>{request.rejection_reason}</p></div>)}
            {request.admin_comments && (<div className="col-span-2"><span className="label">Admin notes</span><p>{request.admin_comments}</p></div>)}
          </div>
        </Card>
      )}
    </Modal>
  );
}
