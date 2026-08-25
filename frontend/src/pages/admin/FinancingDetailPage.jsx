import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, X, Send, Banknote } from 'lucide-react';
import api from '@/lib/api';
import { Card, Skeleton, StatusPill, TierPill } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { Modal } from '@/components/ui/Modal';
import { Field, Input, Select, Textarea } from '@/components/ui/Input';
import { ImageUpload } from '@/components/ui/ImageUpload';
import { formatNaira, formatDate, relativeTime } from '@/lib/utils';
import toast from 'react-hot-toast';

export default function FinancingDetailPage() {
  const { requestId } = useParams();
  const navigate = useNavigate();
  const [modal, setModal] = useState(null); // 'approve' | 'reject' | 'disburse' | 'forward'
  const qc = useQueryClient();

  const { data: req, isLoading } = useQuery({
    queryKey: ['admin-financing', requestId],
    queryFn: () => api.get(`/admin/financing-requests/${requestId}`),
  });

  if (isLoading) return <Skeleton className="h-64" />;
  if (!req) return <Card><p className="py-12 text-center">Request not found</p></Card>;

  const coop = req.cooperatives;

  return (
    <>
      <button onClick={() => navigate(-1)} className="mb-4 inline-flex items-center gap-2 text-sm text-smoke hover:text-ink">
        <ArrowLeft className="size-4" /> Back
      </button>

      <PageHeader
        eyebrow="Financing request"
        title={coop?.name || 'Cooperative request'}
        description={`Submitted ${relativeTime(req.created_at)}`}
        actions={<StatusPill status={req.status} />}
      />

      {/* Summary card */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card>
          <p className="eyebrow mb-1">Amount</p>
          <p className="font-display text-3xl font-semibold">{formatNaira(req.loan_amount)}</p>
          {req.approved_amount && <p className="text-xs text-smoke mt-1">Approved: {formatNaira(req.approved_amount)}</p>}
        </Card>
        <Card>
          <p className="eyebrow mb-1">Purpose</p>
          <p className="font-medium">{req.purpose}</p>
          <p className="text-xs text-smoke mt-1 capitalize">{req.season} season · {req.repayment_window_days} day window</p>
        </Card>
        <Card>
          <p className="eyebrow mb-1">Borrower tier</p>
          <TierPill tier={coop?.cooperative_tier} />
          {coop?.average_credit_score != null && <p className="text-xs text-smoke mt-1">Avg score {coop.average_credit_score}</p>}
        </Card>
      </div>

      {/* Decision panel — reflects the partner-routing lifecycle */}
      {req.status === 'pending' && (
        <Card padded className="mb-6 bg-harvest-50 border-harvest-200">
          <p className="font-semibold mb-2">Awaiting your decision</p>
          <p className="text-sm text-smoke mb-4">Approve the loan in-house, forward it to a partner, or reject it.</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setModal('approve')}><Check className="size-4" /> Approve</Button>
            <Button variant="secondary" onClick={() => setModal('forward')}><Send className="size-4" /> Forward to partner</Button>
            <Button variant="danger" onClick={() => setModal('reject')}><X className="size-4" /> Reject</Button>
          </div>
        </Card>
      )}
      {/* Forwarded to a partner, no decision yet — admin should NOT disburse */}
      {req.status === 'approved' && req.forwarded_to_partner_id && !req.partner_decision && (
        <Card padded className="mb-6 bg-bone border-whisper">
          <p className="font-semibold mb-1">Awaiting partner decision</p>
          <p className="text-sm text-smoke">This request is with the partner. Disbursement unlocks once they approve.</p>
        </Card>
      )}
      {/* Partner rejected */}
      {req.partner_decision === 'rejected' && (
        <Card padded className="mb-6 bg-red-50 border-red-200">
          <p className="font-semibold text-red-700 mb-1">Partner rejected this request</p>
          {req.rejection_reason && <p className="text-sm text-red-700">{req.rejection_reason}</p>}
        </Card>
      )}
      {/* Ready to disburse: either no partner involved, or partner approved */}
      {req.status === 'approved' && !req.disbursed_at &&
        (!req.forwarded_to_partner_id || req.partner_decision === 'approved') && (
        <Card padded className="mb-6 bg-forest-50 border-forest-200">
          <p className="font-semibold mb-2">Ready to disburse</p>
          <p className="text-sm text-smoke mb-3">
            {req.forwarded_to_partner_id
              ? 'Partner has approved. Send the agreed amount manually, then attach the receipt.'
              : 'Send the agreed amount manually, then attach the receipt.'}
          </p>
          <Button onClick={() => setModal('disburse')}><Banknote className="size-4" /> Mark as disbursed</Button>
        </Card>
      )}

      {/* Details */}
      <Card padded className="mb-6">
        <p className="eyebrow mb-1">Request</p>
        <h3 className="font-display text-xl font-semibold mb-4">Details</h3>
        <dl className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
          <KV label="Cooperative" value={coop?.name} />
          <KV label="Cooperative state" value={coop?.state} />
          <KV label="Due date" value={formatDate(req.due_date)} />
          <KV label="Forwarded to" value={req.forwarded_to_partner_id ? 'Partner' : '—'} />
          <KV label="Partner decision" value={req.partner_decision || '—'} />
          <KV label="Disbursed" value={req.disbursed_at ? formatDate(req.disbursed_at) : '—'} />
          {req.rejection_reason && <KV label="Rejection reason" value={req.rejection_reason} />}
          {req.admin_comments && <KV label="Admin notes" value={req.admin_comments} />}
          {req.partner_comments && <KV label="Partner notes" value={req.partner_comments} />}
        </dl>
      </Card>

      {/* Repayments */}
      <Card padded>
        <p className="eyebrow mb-1">Repayments</p>
        <h3 className="font-display text-xl font-semibold mb-4">Repayment history</h3>
        {(req.repayment_records || []).length === 0 ? (
          <p className="text-sm text-smoke py-6 text-center">No repayments recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs uppercase text-smoke border-b border-whisper/60">
                <th className="py-2 pr-4">Date</th><th className="py-2 pr-4">Amount</th><th className="py-2 pr-4">Method</th><th className="py-2 pr-4">Context</th><th className="py-2 pr-4">Reference</th>
              </tr></thead>
              <tbody>
                {req.repayment_records.map((r) => (
                  <tr key={r.id} className="border-b border-whisper/40 last:border-0">
                    <td className="py-2 pr-4">{formatDate(r.payment_date)}</td>
                    <td className="py-2 pr-4 font-semibold">{formatNaira(r.amount_paid)}</td>
                    <td className="py-2 pr-4 capitalize">{r.payment_method?.replace('_', ' ')}</td>
                    <td className="py-2 pr-4">{r.context_flag === 'none' ? '—' : <span className="text-xs px-2 py-0.5 rounded bg-harvest-50 text-harvest-700">{r.context_flag}</span>}</td>
                    <td className="py-2 pr-4 font-mono text-xs">{r.reference_number || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <DecisionModal
        open={!!modal}
        kind={modal}
        request={req}
        onClose={() => setModal(null)}
        onDone={() => {
          qc.invalidateQueries({ queryKey: ['admin-financing'] });
          setModal(null);
        }}
      />
    </>
  );
}

function KV({ label, value }) {
  return (
    <div>
      <p className="text-xs text-smoke uppercase tracking-wider mb-0.5">{label}</p>
      <p className="font-medium text-ink">{value || '—'}</p>
    </div>
  );
}

function DecisionModal({ open, kind, request, onClose, onDone }) {
  const [approvedAmount, setApprovedAmount] = useState(request?.loan_amount || '');
  const [dueDate, setDueDate] = useState('');
  const [partnerId, setPartnerId] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [adminComments, setAdminComments] = useState('');
  // Manual payment: recipient account (the bank account the agent/farmer gave)
  // and, at disbursement, the transfer reference + proof image(s).
  const [accountDetails, setAccountDetails] = useState(request?.disbursement_account_details || '');
  const [disbursementReference, setDisbursementReference] = useState('');
  const [proofUrls, setProofUrls] = useState([]);

  const { data: partners } = useQuery({
    queryKey: ['admin-partners-active'],
    queryFn: () => api.raw.get('/admin/partners', { params: { status: 'active', pageSize: 100 } }).then((r) => r.data?.data || []),
    enabled: kind === 'forward',
  });

  const mutate = useMutation({
    mutationFn: (body) => api.post(`/admin/financing-requests/${request.id}/decision`, body),
    onSuccess: () => { toast.success('Decision recorded'); onDone(); },
  });

  function submit() {
    const body = { decision: kind === 'forward' ? 'approved' : kind === 'disburse' ? 'disbursed' : kind, adminComments };
    if (kind === 'approve' || kind === 'forward' || kind === 'disburse') {
      if (approvedAmount) body.approvedAmount = Number(approvedAmount);
      if (dueDate) body.dueDate = dueDate;
    }
    if (kind === 'forward') body.forwardToPartnerId = partnerId;
    if (kind === 'reject') body.rejectionReason = rejectionReason;
    // Recipient account can be attached when approving/forwarding or disbursing.
    if (accountDetails && (kind === 'approve' || kind === 'forward' || kind === 'disburse')) {
      body.disbursementAccountDetails = accountDetails;
    }
    if (kind === 'disburse') {
      if (disbursementReference) body.disbursementReference = disbursementReference;
      if (proofUrls.length) body.disbursementProofUrls = proofUrls;
    }
    mutate.mutate(body);
  }

  if (!open) return null;
  const titles = { approve: 'Approve in-house', forward: 'Forward to partner', disburse: 'Mark as disbursed', reject: 'Reject request' };

  return (
    <Modal
      open
      onClose={onClose}
      title={titles[kind]}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutate.isPending}>Cancel</Button>
          <Button variant={kind === 'reject' ? 'danger' : 'primary'} loading={mutate.isPending} onClick={submit}>
            Confirm
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {kind === 'forward' && (
          <Field label="Partner" required>
            <Select value={partnerId} onChange={(e) => setPartnerId(e.target.value)} required>
              <option value="">Select a partner organization…</option>
              {(partners || []).map((p) => <option key={p.id} value={p.id}>{p.organization_name}</option>)}
            </Select>
          </Field>
        )}
        {(kind === 'approve' || kind === 'forward' || kind === 'disburse') && (
          <>
            <Field label="Approved amount (NGN)">
              <Input type="number" min="0" value={approvedAmount} onChange={(e) => setApprovedAmount(e.target.value)} />
            </Field>
            <Field label="Repayment due date">
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </Field>
            <Field label="Recipient bank account" hint="Account the funds are sent to (from the field agent / farmer)">
              <Textarea value={accountDetails} onChange={(e) => setAccountDetails(e.target.value)} placeholder="e.g. GTBank · 0123456789 · GreenField Cooperative" />
            </Field>
          </>
        )}
        {kind === 'disburse' && (
          <>
            <Field label="Transfer reference" hint="Bank/transfer reference for this disbursement">
              <Input value={disbursementReference} onChange={(e) => setDisbursementReference(e.target.value)} placeholder="e.g. HBR-DISB-00231" />
            </Field>
            <Field label="Proof of transfer" hint="Upload the transfer receipt / screenshot">
              <ImageUpload value={proofUrls} onChange={setProofUrls} endpoint="/admin/uploads/transaction_receipt" />
            </Field>
          </>
        )}
        {kind === 'reject' && (
          <Field label="Reason" required>
            <Textarea value={rejectionReason} onChange={(e) => setRejectionReason(e.target.value)} required placeholder="Why is this request being rejected?" />
          </Field>
        )}
        <Field label="Admin notes" hint="Optional internal note">
          <Textarea value={adminComments} onChange={(e) => setAdminComments(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
