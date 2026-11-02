import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, X, GitPullRequest, ArrowRight } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, EmptyState, StatusPill } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Field, Textarea } from '@/components/ui/Input';
import { DataTable, Pagination } from '@/components/ui/DataTable';
import { formatDateTime, humanize } from '@/lib/utils';

/**
 * Agent change requests.
 *
 * A field agent cannot edit a verified record directly — they submit a change
 * request and an administrator approves it. The backend has served the queue,
 * the detail and the decision endpoint all along, and NOTHING called them.
 *
 * So every change an agent submitted sat in `pending` forever. Not a backlog
 * an admin could see and ignore: a queue with no screen, invisible to
 * everyone, while the agent who raised it waited for a correction that was
 * never going to arrive. Agents learn quickly that the feature does nothing
 * and stop using it, which is how a farmer's wrong phone number or farm size
 * stays wrong — and farm size is the denominator of the production score.
 */
export default function ChangeRequestsPage() {
  const [status, setStatus] = useState('pending');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);
  const qc = useQueryClient();

  const { data: list, isLoading, isError, error } = useQuery({
    queryKey: ['admin-change-requests', status, page],
    queryFn: () =>
      api.list('/admin/change-requests', {
        params: { status: status || undefined, page, pageSize: 20 },
      }),
  });

  const decide = useMutation({
    // `reviewNotes` is PLURAL in the validator and is REQUIRED when
    // rejecting — `reviewNote` would be stripped by `stripUnknown` and the
    // rejection would come back as a 422 naming a field this form does not
    // show.
    mutationFn: ({ id, decision, reviewNotes }) =>
      api.post(`/admin/change-requests/${id}/decision`, {
        decision,
        reviewNotes: reviewNotes?.trim() ? reviewNotes : undefined,
      }),
    onSuccess: (_result, variables) => {
      toast.success(
        variables.decision === 'approve'
          ? 'Change applied to the record'
          : 'Change request rejected',
      );
      qc.invalidateQueries({ queryKey: ['admin-change-requests'] });
      // An approval WRITES to the farmer, cooperative or farm profile, and a
      // farm-size change moves the credit score — so the record views and the
      // score views are both stale now.
      qc.invalidateQueries({ queryKey: ['admin-farmers'] });
      qc.invalidateQueries({ queryKey: ['admin-farmer'] });
      qc.invalidateQueries({ queryKey: ['admin-cooperatives'] });
      qc.invalidateQueries({ queryKey: ['admin-cooperative'] });
      qc.invalidateQueries({ queryKey: ['admin-credit'] });
      setSelected(null);
    },
  });

  const columns = [
    {
      key: 'entity',
      label: 'Record',
      render: (r) => (
        <div className="min-w-0">
          <p className="font-medium text-ink capitalize">
            {humanize(r.entity_type || '—')}
          </p>
          <p className="text-xs text-smoke font-mono truncate">
            {r.entity_id ? r.entity_id.slice(0, 8) : '—'}
          </p>
        </div>
      ),
    },
    {
      key: 'change_type',
      label: 'Type',
      render: (r) => <span className="capitalize text-smoke">{r.change_type || 'update'}</span>,
    },
    {
      key: 'fields',
      label: 'Fields',
      render: (r) => {
        const keys = Object.keys(r.proposed_changes || {});
        return (
          <span className="text-smoke text-xs">
            {keys.length === 0
              ? '—'
              : keys.slice(0, 3).map(humanize).join(', ') +
                (keys.length > 3 ? ` +${keys.length - 3}` : '')}
          </span>
        );
      },
    },
    { key: 'status', label: 'Status', render: (r) => <StatusPill status={r.status} /> },
    {
      key: 'submitted',
      label: 'Submitted',
      render: (r) => <span className="text-smoke text-xs">{formatDateTime(r.created_at)}</span>,
    },
    {
      key: 'actions',
      label: '',
      align: 'right',
      render: (r) => (
        <Button variant="secondary" onClick={() => setSelected(r)}>
          Review
        </Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Review"
        title="Change Requests"
        description="Edits field agents have asked for on verified records. Approving one writes it to the record."
      />

      <div className="flex items-center gap-2 mb-4">
        {[
          ['pending', 'Pending'],
          ['approved', 'Approved'],
          ['rejected', 'Rejected'],
          ['', 'All'],
        ].map(([value, label]) => (
          <button
            type="button"
            key={value || 'all'}
            onClick={() => {
              setStatus(value);
              setPage(1);
            }}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition ${
              status === value
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
            Could not load change requests{error?.message ? `: ${error.message}` : ''}.
          </p>
        </Card>
      )}

      <DataTable
        loading={isLoading}
        columns={columns}
        rows={list?.data}
        empty={
          <EmptyState
            icon={GitPullRequest}
            title={`No ${status || ''} change requests`.replace('  ', ' ')}
            description="When a field agent asks to correct a verified record, it appears here for approval."
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
        <ChangeRequestModal
          request={selected}
          onClose={() => setSelected(null)}
          onDecide={(decision, reviewNotes) =>
            decide.mutate({ id: selected.id, decision, reviewNotes })
          }
          submitting={decide.isPending}
        />
      )}
    </>
  );
}

function ChangeRequestModal({ request, onClose, onDecide, submitting }) {
  const [mode, setMode] = useState(null);
  const [reviewNotes, setNotes] = useState('');

  const proposed = request.proposed_changes || {};
  const snapshot = request.current_snapshot || {};
  const keys = Object.keys(proposed);
  const isPending = request.status === 'pending';

  return (
    <Modal
      open
      onClose={onClose}
      title={`${humanize(request.entity_type || 'Record')} change`}
      description={
        request.entity_id ? `Record ${request.entity_id.slice(0, 8)}` : undefined
      }
      size="lg"
      footer={
        mode === 'reject' ? (
          <>
            <Button variant="ghost" onClick={() => setMode(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={submitting}
              // A reason is mandatory on rejection, so the button stays
              // disabled rather than letting the server refuse it.
              disabled={!reviewNotes.trim()}
              onClick={() => onDecide('reject', reviewNotes)}
            >
              <X className="size-4" /> Reject request
            </Button>
          </>
        ) : isPending ? (
          <>
            <Button variant="ghost" onClick={() => setMode('reject')}>
              <X className="size-4" /> Reject
            </Button>
            <Button variant="primary" loading={submitting} onClick={() => onDecide('approve', reviewNotes)}>
              <Check className="size-4" /> Approve and apply
            </Button>
          </>
        ) : (
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        )
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
          <div>
            <dt className="text-xs text-smoke mb-0.5">Status</dt>
            <dd><StatusPill status={request.status} /></dd>
          </div>
          <div>
            <dt className="text-xs text-smoke mb-0.5">Type</dt>
            <dd className="text-ink font-medium capitalize">{request.change_type || 'update'}</dd>
          </div>
          <div>
            <dt className="text-xs text-smoke mb-0.5">Submitted</dt>
            <dd className="text-ink font-medium">{formatDateTime(request.created_at)}</dd>
          </div>
        </div>

        {request.reason && (
          <Card padded>
            <p className="eyebrow mb-1">Agent&rsquo;s reason</p>
            <p className="text-sm text-ink">{request.reason}</p>
          </Card>
        )}

        {/* Before and after, field by field.
            Approving writes these values to the record, so the only
            responsible way to present it is the current value beside the
            proposed one — a list of proposed values alone asks an admin to
            approve a change they cannot see the effect of. */}
        <div>
          <p className="eyebrow mb-2">Proposed changes</p>
          {keys.length === 0 ? (
            <p className="text-sm text-smoke">This request carries no field changes.</p>
          ) : (
            <ul className="divide-y divide-whisper/60 rounded-xl border border-whisper overflow-hidden">
              {keys.map((key) => (
                <li key={key} className="px-3 py-2.5 bg-white">
                  <p className="text-xs text-smoke mb-1">{humanize(key)}</p>
                  <div className="flex items-center gap-2 text-sm flex-wrap">
                    <span className="text-smoke line-through break-all">
                      {formatValue(snapshot[key])}
                    </span>
                    <ArrowRight className="size-3.5 text-smoke shrink-0" aria-hidden="true" />
                    <span className="text-ink font-medium break-all">
                      {formatValue(proposed[key])}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {(isPending || mode === 'reject') && (
          <Field
            label="Review notes"
            required={mode === 'reject'}
            hint={
              mode === 'reject'
                ? 'Required when rejecting. The agent sees it.'
                : 'Optional. Recorded against the decision.'
            }
          >
            <Textarea
              rows={2}
              value={reviewNotes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={
                mode === 'reject'
                  ? 'e.g. Farm size does not match the mapped boundary'
                  : 'Optional'
              }
            />
          </Field>
        )}

        {(request.review_notes || request.review_note) && !isPending && (
          <Card padded>
            <p className="eyebrow mb-1">Review notes</p>
            <p className="text-sm text-ink">{request.review_notes || request.review_note}</p>
          </Card>
        )}
      </div>
    </Modal>
  );
}

/**
 * Renders any stored value readably.
 *
 * `proposed_changes` holds whatever the column type was — an array of crops,
 * a boolean, a GPS polygon, null. `String(value)` would print "[object
 * Object]" for the polygon and an empty string for null, so an admin could
 * not tell "cleared" from "unchanged" in the one view where that matters.
 */
function formatValue(value) {
  if (value === null || value === undefined) return '—';
  if (value === '') return '(blank)';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.length === 0 ? '(none)' : value.join(', ');
  if (typeof value === 'object') {
    // A GPS polygon or similar. The count is the useful part; the ring itself
    // is unreadable as text and belongs on a map.
    const length = Array.isArray(value) ? value.length : Object.keys(value).length;
    return `${length} entries`;
  }
  return String(value);
}
