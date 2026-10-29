import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, X, FileText } from 'lucide-react';
import api from '@/lib/api';
import { Card, Skeleton, StatusPill, MetricCard } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { Modal } from '@/components/ui/Modal';
import { Field, Input, Textarea } from '@/components/ui/Input';
import { formatNaira, formatDate, formatNumber, formatScore, humanize, relativeTime } from '@/lib/utils';

// createFinancingRequest.season: wet | dry | all_year.
const SEASON_LABELS = { wet: 'Wet', dry: 'Dry', all_year: 'All Year' };
import toast from 'react-hot-toast';

export default function PartnerFinancingDetailPage() {
  const { requestId } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [modal, setModal] = useState(null);

  const { data: req, isLoading, isError, error } = useQuery({
    queryKey: ['partner-financing', requestId],
    queryFn: () => api.get(`/partner/financing-requests/${requestId}`),
  });

  if (isLoading) return <Skeleton className="h-64" />;
  // FIXED — a load failure (including the 403 the backend returns when the
  // request was never forwarded to this partner) rendered a bare "Not found."
  // with no explanation and no way back.
  if (isError || !req) {
    return (
      <Card padded>
        <p className="py-10 text-center text-smoke">
          {isError
            ? `Could not load this request${error?.message ? `: ${error.message}` : ''}.`
            : 'This request is no longer available to your organization.'}
        </p>
        <div className="flex justify-center">
          <Button variant="secondary" onClick={() => navigate('/partner/financing')}>Back to requests</Button>
        </div>
      </Card>
    );
  }

  const coop = req.cooperatives;
  const decided = req.partner_decision && req.partner_decision !== 'pending';

  return (
    <>
      <button type="button" onClick={() => navigate(-1)} className="mb-4 inline-flex items-center gap-2 text-sm text-smoke hover:text-ink">
        <ArrowLeft className="size-4" /> Back to requests
      </button>

      <PageHeader
        eyebrow="Financing request"
        title={coop?.name || 'Financing request'}
        description={`Forwarded ${relativeTime(req.created_at)}`}
        actions={
          <>
            <StatusPill status={req.partner_decision || 'pending'} />
            {/* FIXED — the credit-report link was the only way into the
                borrower's detail from here and silently disappeared when the
                embed came back without an id; fall back to the request's own
                cooperative_id. */}
            {(coop?.id || req.cooperative_id) && (
              <Button variant="secondary" onClick={() => navigate(`/partner/reports/cooperative/${coop?.id || req.cooperative_id}`)}>
                <FileText className="size-4" /> View credit report
              </Button>
            )}
          </>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <MetricCard label="Requested" value={formatNaira(req.loan_amount)} tone="primary" />
        <MetricCard label="Tier" value={coop?.cooperative_tier || '—'} sub={coop?.average_credit_score != null ? `Avg score ${formatScore(coop.average_credit_score)}` : 'Unscored'} />
        {/* FIXED — rendered the raw season enum ("all_year") and crashed-looking
            "undefined-day window" when repayment_window_days was null. */}
        <MetricCard label="Season" value={SEASON_LABELS[req.season] || humanize(req.season) || '—'} sub={req.repayment_window_days ? `${req.repayment_window_days}-day window` : 'No window set'} />
        <MetricCard label="Members" value={formatNumber(coop?.total_members || 0)} />
      </div>

      <Card padded className="mb-6">
        <p className="eyebrow mb-1">Request</p>
        <h3 className="font-display text-xl font-semibold mb-4">Details</h3>
        <dl className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
          <KV label="Purpose" value={req.purpose} />
          <KV label="Approved amount" value={req.approved_amount != null ? formatNaira(req.approved_amount) : '—'} />
          <KV label="Due date" value={formatDate(req.due_date)} />
          <KV label="Cooperative state" value={coop?.state} />
          <KV label="Cooperative LGA" value={coop?.lga} />
          <KV label="Admin notes" value={req.admin_comments || '—'} />
        </dl>
      </Card>

      {!decided && (
        <Card padded className="bg-harvest-50 border-harvest-200">
          <p className="font-display text-lg font-semibold mb-1">Decision required</p>
          <p className="text-sm text-smoke mb-4">Your decision is sent back to Heabron Admin and recorded in the audit log.</p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setModal('approve')}><Check className="size-4" /> Approve</Button>
            <Button variant="danger" onClick={() => setModal('reject')}><X className="size-4" /> Reject</Button>
          </div>
        </Card>
      )}

      <DecisionModal
        kind={modal}
        request={req}
        onClose={() => setModal(null)}
        onDone={() => { qc.invalidateQueries({ queryKey: ['partner-financing'] }); setModal(null); }}
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

function DecisionModal({ kind, request, onClose, onDone }) {
  const [approvedAmount, setApprovedAmount] = useState(request?.loan_amount || '');
  const [partnerComments, setPartnerComments] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');

  const mutate = useMutation({
    mutationFn: () => {
      // partnerDecideFinancing accepts decision: 'approved' | 'rejected' only
      // (the past-tense enum), approvedAmount must be positive, and
      // rejectionReason is required when rejecting.
      const body = { decision: kind === 'approve' ? 'approved' : 'rejected' };
      if (partnerComments.trim()) body.partnerComments = partnerComments.trim();
      if (kind === 'approve') {
        const amount = Number(approvedAmount);
        if (Number.isFinite(amount) && amount > 0) body.approvedAmount = amount;
      }
      if (kind === 'reject') body.rejectionReason = rejectionReason.trim();
      return api.post(`/partner/financing-requests/${request.id}/decision`, body);
    },
    onSuccess: () => { toast.success('Decision recorded'); onDone(); },
    onError: (e) => {
      const detail = e?.details?.[0];
      if (detail) toast.error(`${detail.field}: ${detail.message}`);
    },
  });

  if (!kind) return null;
  // FIXED — Confirm was always enabled, but the validator requires
  // rejectionReason on a rejection, so rejecting with an empty box 422'd with
  // an unreadable "Validation failed".
  const blocked = kind === 'reject' && !rejectionReason.trim();

  return (
    <Modal
      open
      onClose={onClose}
      title={kind === 'approve' ? 'Approve this request' : 'Reject this request'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={mutate.isPending}>Cancel</Button>
          <Button
            variant={kind === 'reject' ? 'danger' : 'primary'}
            loading={mutate.isPending}
            disabled={blocked}
            title={blocked ? 'A reason is required to reject' : undefined}
            onClick={() => mutate.mutate()}
          >
            Confirm
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {kind === 'approve' && (
          <Field label="Approved amount (NGN)" hint="Defaults to the full requested amount">
            <Input type="number" min="0" value={approvedAmount} onChange={(e) => setApprovedAmount(e.target.value)} />
          </Field>
        )}
        {kind === 'reject' && (
          <Field label="Reason" required>
            <Textarea value={rejectionReason} onChange={(e) => setRejectionReason(e.target.value)} required placeholder="Visible to Heabron Admin." />
          </Field>
        )}
        <Field label="Notes" hint="Optional internal note for your team">
          <Textarea value={partnerComments} onChange={(e) => setPartnerComments(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
