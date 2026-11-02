import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ban, Receipt, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, EmptyState } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Field, Textarea } from '@/components/ui/Input';
import { DataTable, Pagination } from '@/components/ui/DataTable';
import { formatDate, formatDateTime, formatNaira, humanize } from '@/lib/utils';

/**
 * Repayments, and voiding a wrong one.
 *
 * `/admin/repayments`, the detail and `/admin/repayments/:id/void` were all
 * served with nothing calling them, so a repayment entered wrongly by a field
 * agent — the wrong amount, the wrong loan, a duplicate of one already
 * recorded — was permanent.
 *
 * That is not merely untidy. The repayment half of the credit score is built
 * from these rows: the rate paid, whether payments were on time, and whether
 * a default was recovered. A duplicate ₦50,000 entry inflates a farmer's
 * repayment rate, and an entry against the wrong loan deflates someone
 * else's. With no way to void, the only remedy was a direct database edit —
 * which leaves no audit trail at all, where a void leaves one and keeps the
 * original row.
 */
export default function RepaymentsPage() {
  const [voided, setVoided] = useState('active');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);
  const qc = useQueryClient();

  const { data: list, isLoading, isError, error } = useQuery({
    queryKey: ['admin-repayments', voided, page],
    queryFn: () =>
      api.list('/admin/repayments', {
        params: {
          // 'active' | 'voided' | '' (all), mapped to the boolean the
          // controller filters on.
          voided: voided === '' ? undefined : voided === 'voided',
          page,
          pageSize: 20,
        },
      }),
  });

  const voidPayment = useMutation({
    mutationFn: ({ id, reason }) => api.post(`/admin/repayments/${id}/void`, { reason }),
    onSuccess: () => {
      toast.success('Repayment voided');
      qc.invalidateQueries({ queryKey: ['admin-repayments'] });
      // Voiding changes the loan's outstanding balance AND the farmer's
      // repayment score, which rolls into the cooperative average.
      qc.invalidateQueries({ queryKey: ['admin-financing'] });
      qc.invalidateQueries({ queryKey: ['admin-credit'] });
      qc.invalidateQueries({ queryKey: ['admin-farmer'] });
      qc.invalidateQueries({ queryKey: ['admin-cooperative'] });
      qc.invalidateQueries({ queryKey: ['admin-dashboard'] });
      setSelected(null);
    },
  });

  const columns = [
    {
      key: 'farmer',
      label: 'Farmer',
      render: (r) => (
        <div className="min-w-0">
          <p className="font-medium text-ink truncate">{r.farmers?.full_name || '—'}</p>
          <p className="text-xs text-smoke truncate">
            {r.financing_requests?.cooperatives?.name || '—'}
          </p>
        </div>
      ),
    },
    {
      key: 'amount',
      label: 'Amount paid',
      render: (r) => (
        <span className={`tabular font-semibold ${r.voided ? 'text-smoke line-through' : 'text-ink'}`}>
          {formatNaira(r.amount_paid)}
        </span>
      ),
    },
    {
      key: 'loan',
      label: 'Against loan',
      render: (r) => (
        <div>
          <p className="text-xs font-mono text-smoke">
            {r.financing_request_id ? r.financing_request_id.slice(0, 8) : '—'}
          </p>
          <p className="text-xs text-smoke">
            {r.financing_requests?.loan_amount != null
              ? formatNaira(r.financing_requests.loan_amount)
              : ''}
          </p>
        </div>
      ),
    },
    {
      key: 'method',
      label: 'Method',
      render: (r) => <span className="text-smoke capitalize">{humanize(r.payment_method || '—')}</span>,
    },
    {
      key: 'date',
      label: 'Paid',
      render: (r) => <span className="text-smoke text-xs">{formatDate(r.payment_date)}</span>,
    },
    {
      key: 'state',
      label: 'State',
      render: (r) =>
        r.voided ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-red-700 font-medium">
            <Ban className="size-3.5" /> Voided
          </span>
        ) : (
          <span className="text-xs text-forest-700 font-medium">Counted</span>
        ),
    },
    {
      key: 'actions',
      label: '',
      align: 'right',
      render: (r) => (
        <Button variant="secondary" onClick={() => setSelected(r)}>
          {r.voided ? 'View' : 'Review'}
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Credit scoring"
        title="Repayments"
        description="Every payment recorded against a loan. Voiding one removes it from the credit score without deleting the record."
      />

      <div className="flex items-center gap-2 mb-4">
        {[
          ['active', 'Counted'],
          ['voided', 'Voided'],
          ['', 'All'],
        ].map(([value, label]) => (
          <button
            type="button"
            key={value || 'all'}
            onClick={() => {
              setVoided(value);
              setPage(1);
            }}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition ${
              voided === value
                ? 'bg-forest-500 text-white'
                : 'bg-white border border-whisper text-smoke hover:text-ink'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {isError && (
        <Card padded className="mb-4 border-red-200 bg-red-50/60">
          <p className="text-sm text-red-700">
            Could not load repayments{error?.message ? `: ${error.message}` : ''}.
          </p>
        </Card>
      )}

      <DataTable
        loading={isLoading}
        columns={columns}
        rows={list?.data}
        empty={
          <EmptyState
            icon={Receipt}
            title="No repayments"
            description="Payments recorded by field agents against active loans appear here."
          />
        }
      />
      <Pagination
        page={page}
        pageSize={list?.meta?.pageSize || 20}
        total={list?.meta?.total || 0}
        onPageChange={setPage}
      />

      {selected && (
        <RepaymentModal
          repayment={selected}
          onClose={() => setSelected(null)}
          onVoid={(reason) => voidPayment.mutate({ id: selected.id, reason })}
          submitting={voidPayment.isPending}
        />
      )}
    </>
  );
}

function RepaymentModal({ repayment, onClose, onVoid, submitting }) {
  const [mode, setMode] = useState(null);
  const [reason, setReason] = useState('');

  const r = repayment;

  return (
    <Modal
      open
      onClose={onClose}
      title={r.farmers?.full_name || 'Repayment'}
      description={formatNaira(r.amount_paid)}
      size="md"
      footer={
        mode === 'void' ? (
          <>
            <Button variant="ghost" onClick={() => setMode(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={submitting}
              disabled={reason.trim().length < 3}
              onClick={() => onVoid(reason)}
            >
              <Ban className="size-4" /> Void repayment
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
            {!r.voided && (
              <Button variant="danger" onClick={() => setMode('void')}>
                <Ban className="size-4" /> Void
              </Button>
            )}
          </>
        )
      }
    >
      {mode === 'void' ? (
        <div className="space-y-3">
          <Card padded className="border-red-200 bg-red-50/60">
            <p className="text-sm text-red-800">
              <AlertTriangle className="inline size-4 mr-1.5 -mt-0.5" />
              The row is kept and marked voided, so the audit trail survives —
              but it stops counting toward the loan balance and toward the
              farmer&rsquo;s repayment score, which is recalculated. Use this for
              a duplicate, a wrong amount, or a payment recorded against the
              wrong loan.
            </p>
          </Card>
          <Field label="Reason" required hint="At least 3 characters. Kept with the record.">
            <Textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Duplicate of the payment recorded on 12 Nov"
            />
          </Field>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <KV label="Amount paid" value={formatNaira(r.amount_paid)} />
            <KV label="Method" value={<span className="capitalize">{humanize(r.payment_method || '—')}</span>} />
            <KV label="Payment date" value={formatDate(r.payment_date)} />
            <KV label="Recorded" value={formatDateTime(r.created_at)} />
            <KV
              label="Loan"
              value={
                <span className="font-mono text-xs">
                  {r.financing_request_id ? r.financing_request_id.slice(0, 8) : '—'}
                </span>
              }
            />
            <KV
              label="Loan amount"
              value={
                r.financing_requests?.loan_amount != null
                  ? formatNaira(r.financing_requests.loan_amount)
                  : '—'
              }
            />
            <KV label="Reference" value={r.reference || '—'} />
            <KV
              label="State"
              value={r.voided ? 'Voided — not counted' : 'Counted toward the score'}
            />
          </div>

          {r.notes && (
            <Card padded>
              <p className="eyebrow mb-1">Notes</p>
              <p className="text-sm text-ink">{r.notes}</p>
            </Card>
          )}

          {/* Why it was voided, for the person auditing it later. */}
          {r.voided && (
            <Card padded className="border-red-200 bg-red-50/40">
              <p className="eyebrow mb-1">Void reason</p>
              <p className="text-sm text-ink">{r.void_reason || 'No reason recorded.'}</p>
              {r.voided_at && (
                <p className="text-xs text-smoke mt-1">{formatDateTime(r.voided_at)}</p>
              )}
            </Card>
          )}
        </div>
      )}
    </Modal>
  );
}

function KV({ label, value }) {
  return (
    <div>
      <dt className="text-xs text-smoke mb-0.5">{label}</dt>
      <dd className="text-ink font-medium">{value}</dd>
    </div>
  );
}
