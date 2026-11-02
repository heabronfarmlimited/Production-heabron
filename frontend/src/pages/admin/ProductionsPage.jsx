import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, X, Sprout, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, EmptyState, StatusPill } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Field, Textarea } from '@/components/ui/Input';
import { DataTable, Pagination } from '@/components/ui/DataTable';
import { formatDate, formatDateTime, formatScore, humanize } from '@/lib/utils';
import { statusTabs } from '@/lib/statuses';

/**
 * Yield verification.
 *
 * This is the screen with the most direct effect on a credit score of any in
 * the dashboard, and it did not exist: `/admin/productions` and
 * `/admin/productions/:id/verify` have been served all along with nothing
 * calling them.
 *
 * A season's production is recorded by a field agent and starts `pending`.
 * The production half of the score — half the final score — is built on the
 * actual yield against the regional benchmark, and a pending yield is an
 * agent's unchecked word. With no screen, nothing was ever verified: every
 * farmer in the system is being scored on unverified production, and no one
 * could see that, let alone change it.
 *
 * The status values here are the `yield_verification_status` enum —
 * `pending | verified | rejected` — and nothing else. This page originally
 * sent `unverified`, which is not a label on that type, so Postgres rejected
 * the comparison with 22P02 and the whole screen returned 400 ("A value had
 * the wrong type") on its default tab. The word for the unchecked state is
 * `pending` in the database; "Unverified" is only ever a label on screen.
 */
/**
 * Tab value -> label. The value is the enum label the API filters on; the
 * label is only what an administrator reads, which is why the pending tab
 * reads "Unverified" while sending `pending`. `statusTabs` refuses a value
 * that is not a label on the type, which is what this page needed.
 */
const TABS = statusTabs('yield_verification_status', [
  ['pending', 'Unverified'],
  ['verified', 'Verified'],
  ['rejected', 'Rejected'],
  ['', 'All'],
]);

export default function ProductionsPage() {
  const [verificationStatus, setStatus] = useState('pending');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);
  const qc = useQueryClient();

  const { data: list, isLoading, isError, error } = useQuery({
    queryKey: ['admin-productions', verificationStatus, page],
    queryFn: () =>
      api.list('/admin/productions', {
        params: {
          // `status` is what the list validator accepts and what the
          // controller filters `verification_status` on — a
          // `verificationStatus` param would be stripped and the filter
          // would silently do nothing, showing every season under every tab.
          status: verificationStatus || undefined,
          page,
          pageSize: 20,
        },
      }),
  });

  const decide = useMutation({
    // `decision` is 'verify' | 'reject' — not 'approve', which is what the
    // change-request and application endpoints take. `verificationNotes` is
    // required on a rejection.
    mutationFn: ({ id, decision, verificationNotes }) =>
      api.post(`/admin/productions/${id}/verify`, {
        decision,
        verificationNotes: verificationNotes?.trim() ? verificationNotes : undefined,
      }),
    onSuccess: (_r, variables) => {
      toast.success(
        variables.decision === 'verify' ? 'Yield verified' : 'Yield rejected',
      );
      qc.invalidateQueries({ queryKey: ['admin-productions'] });
      // Verifying a yield recalculates the farmer's production score, which
      // rolls into their cooperative's average.
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
          <p className="font-medium text-ink truncate">
            {r.farmers?.full_name || '—'}
          </p>
          {/* The list query selects `farmers(id, full_name)` only — there
              is no cooperative join and no lga on the row, so the crop and
              cycle identify the season instead of inventing a location. */}
          <p className="text-xs text-smoke truncate capitalize">
            {[r.crop, r.cycle_number ? `cycle ${r.cycle_number}` : null]
              .filter(Boolean)
              .join(' · ') || '—'}
          </p>
        </div>
      ),
    },
    {
      key: 'season',
      label: 'Season',
      render: (r) => (
        <div>
          <p className="text-ink capitalize">{r.season || '—'}</p>
          <p className="text-xs text-smoke capitalize">{r.crop || '—'}</p>
        </div>
      ),
    },
    {
      key: 'yield',
      label: 'Actual / expected',
      render: (r) => (
        <span className="tabular text-ink">
          {r.actual_yield_tonnes != null ? formatScore(r.actual_yield_tonnes, 2) : '—'}
          <span className="text-smoke">
            {' / '}
            {r.expected_yield_tonnes != null ? formatScore(r.expected_yield_tonnes, 2) : '—'} t
          </span>
        </span>
      ),
    },
    {
      key: 'benchmark',
      label: 'Benchmark',
      render: (r) => (
        <span className="tabular text-smoke">
          {r.benchmark_yield_tonnes != null
            ? `${formatScore(r.benchmark_yield_tonnes, 2)} t/ha`
            : '—'}
        </span>
      ),
    },
    {
      key: 'status',
      label: 'Verification',
      render: (r) => <StatusPill status={r.verification_status || 'pending'} />,
    },
    {
      key: 'recorded',
      label: 'Recorded',
      render: (r) => <span className="text-smoke text-xs">{formatDate(r.created_at)}</span>,
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
        eyebrow="Credit scoring"
        title="Yield Verification"
        description="Production an agent recorded, awaiting verification. A verified yield is what the production score is built on."
      />

      <Card padded className="mb-4 border-harvest-200 bg-harvest-50/50">
        <p className="text-sm text-ink">
          <AlertTriangle className="inline size-4 text-harvest-500 mr-1.5 -mt-0.5" />
          The production score is half the final credit score, and it is
          calculated from the <strong>actual yield</strong> against the
          regional benchmark. Verifying confirms the figure an agent reported;
          rejecting records why, and the reason is kept with the season.
        </p>
      </Card>

      <div className="flex items-center gap-2 mb-4">
        {TABS.map(([value, label]) => (
          <button
            type="button"
            key={value || 'all'}
            onClick={() => {
              setStatus(value);
              setPage(1);
            }}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition ${
              verificationStatus === value
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
            Could not load production records{error?.message ? `: ${error.message}` : ''}.
          </p>
        </Card>
      )}

      <DataTable
        loading={isLoading}
        columns={columns}
        rows={list?.data}
        empty={
          <EmptyState
            icon={Sprout}
            title={`No ${
              verificationStatus
                ? `${(TABS.find(([v]) => v === verificationStatus)?.[1] ?? '').toLowerCase()} `
                : ''
            }production records`}
            description="Seasons recorded by field agents appear here for verification."
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
        <ProductionModal
          production={selected}
          onClose={() => setSelected(null)}
          onDecide={(decision, notes) =>
            decide.mutate({ id: selected.id, decision, verificationNotes: notes })
          }
          submitting={decide.isPending}
        />
      )}
    </>
  );
}

function ProductionModal({ production, onClose, onDecide, submitting }) {
  const [mode, setMode] = useState(null);
  const [notes, setNotes] = useState('');

  const p = production;
  const isPending = (p.verification_status || 'pending') === 'pending';

  /**
   * Yield per hectare, which is what the score actually divides by.
   *
   * Shown because the raw tonnage means little on its own — 4 tonnes is good
   * on one hectare and poor on ten — and an implausible per-hectare figure is
   * the single clearest sign of a data-entry error, which is what
   * verification is for.
   */
  const acres = Number(p.farm_size_acres);
  const hectares = Number.isFinite(acres) && acres > 0 ? acres * 0.404686 : null;
  const actual = Number(p.actual_yield_tonnes);
  const perHectare =
    hectares && Number.isFinite(actual) && actual > 0 ? actual / hectares : null;
  const benchmark = Number(p.benchmark_yield_tonnes);
  const ratio =
    perHectare && Number.isFinite(benchmark) && benchmark > 0
      ? perHectare / benchmark
      : null;

  return (
    <Modal
      open
      onClose={onClose}
      title={p.farmers?.full_name || 'Production record'}
      description={`${humanize(p.season || '')} · ${humanize(p.crop || '')}`}
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
              disabled={!notes.trim()}
              onClick={() => onDecide('reject', notes)}
            >
              <X className="size-4" /> Reject yield
            </Button>
          </>
        ) : isPending ? (
          <>
            <Button variant="ghost" onClick={() => setMode('reject')}>
              <X className="size-4" /> Reject
            </Button>
            <Button variant="primary" loading={submitting} onClick={() => onDecide('verify', notes)}>
              <Check className="size-4" /> Verify yield
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
          <KV label="Status" value={<StatusPill status={p.verification_status || 'pending'} />} />
          <KV label="Cycle" value={p.cycle_number ?? '—'} />
          <KV label="Crop" value={<span className="capitalize">{p.crop || '—'}</span>} />
          <KV
            label="Land this season"
            value={Number.isFinite(acres) && acres > 0 ? `${formatScore(acres, 2)} acres` : '—'}
          />
          <KV
            label="Actual yield"
            value={
              Number.isFinite(actual) ? `${formatScore(actual, 2)} t` : 'Not recorded'
            }
          />
          <KV
            label="Expected yield"
            value={
              p.expected_yield_tonnes != null
                ? `${formatScore(p.expected_yield_tonnes, 2)} t`
                : '—'
            }
          />
          <KV label="Planted" value={formatDate(p.expected_planting_date)} />
          <KV label="Harvest expected" value={formatDate(p.expected_harvest_date)} />
          <KV label="Recorded" value={formatDateTime(p.created_at)} />
        </div>

        {/* The figure the score is built from, and how it compares. */}
        <Card padded>
          <p className="eyebrow mb-2">What the score sees</p>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <dt className="text-xs text-smoke mb-0.5">Yield per hectare</dt>
              <dd className="text-ink font-semibold tabular">
                {perHectare != null ? `${formatScore(perHectare, 2)} t/ha` : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-smoke mb-0.5">Regional benchmark</dt>
              <dd className="text-ink font-semibold tabular">
                {Number.isFinite(benchmark) && benchmark > 0
                  ? `${formatScore(benchmark, 2)} t/ha`
                  : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-smoke mb-0.5">Against benchmark</dt>
              <dd
                className={`font-semibold tabular ${
                  ratio == null
                    ? 'text-smoke'
                    : ratio >= 1
                      ? 'text-forest-700'
                      : ratio >= 0.6
                        ? 'text-harvest-700'
                        : 'text-red-700'
                }`}
              >
                {ratio != null ? `${Math.round(ratio * 100)}%` : '—'}
              </dd>
            </div>
          </div>

          {/* Deliberately wide bounds: this flags a decimal in the wrong
              place, not good or poor farming. */}
          {perHectare != null && (perHectare < 0.05 || perHectare > 20) && (
            <p className="text-xs text-red-700 mt-3">
              <AlertTriangle className="inline size-3.5 mr-1 -mt-0.5" />
              {formatScore(perHectare, 2)} t/ha is outside any plausible range for a
              smallholder plot. Check the land size and the yield units before
              verifying — a misplaced decimal here moves the farmer&rsquo;s score
              by tiers.
            </p>
          )}

          {!Number.isFinite(acres) || acres <= 0 ? (
            <p className="text-xs text-harvest-700 mt-3">
              <AlertTriangle className="inline size-3.5 mr-1 -mt-0.5" />
              No land size on this season, so yield per hectare cannot be
              calculated. The score falls back to the farmer&rsquo;s total farm
              area.
            </p>
          ) : null}
        </Card>

        {p.notes && (
          <Card padded>
            <p className="eyebrow mb-1">Agent&rsquo;s notes</p>
            <p className="text-sm text-ink">{p.notes}</p>
          </Card>
        )}

        {(isPending || mode === 'reject') && (
          <Field
            label="Verification notes"
            required={mode === 'reject'}
            hint={
              mode === 'reject'
                ? 'Required when rejecting. Kept with the season.'
                : 'Optional. Kept with the season.'
            }
          >
            <Textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={
                mode === 'reject'
                  ? 'e.g. Yield does not match the delivery records for this season'
                  : 'Optional'
              }
            />
          </Field>
        )}

        {p.verification_notes && !isPending && (
          <Card padded>
            <p className="eyebrow mb-1">Verification notes</p>
            <p className="text-sm text-ink">{p.verification_notes}</p>
          </Card>
        )}
      </div>
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
