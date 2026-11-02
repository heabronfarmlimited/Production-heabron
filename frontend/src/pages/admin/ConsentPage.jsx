import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ShieldCheck,
  FileSignature,
  Mic,
  AlertCircle,
  Ban,
  Clock,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, EmptyState, StatusPill } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Field, Textarea } from '@/components/ui/Input';
import { DataTable, Pagination } from '@/components/ui/DataTable';
import { formatDateTime, initials } from '@/lib/utils';

/**
 * Data consent register.
 *
 * The backend has served `/admin/consent`, `/admin/consent/:id` and
 * `/admin/consent/:id/withdraw` since the consent work landed, and NOTHING
 * called them — so the three things the data consent specification requires of
 * an administrator were impossible: see what a farmer or cooperative actually
 * agreed to, play back the recorded statement and view the signature, and
 * withdraw consent with a reason.
 *
 * That is not a missing convenience. A consent record a nobody can inspect is
 * a consent record that cannot be audited, and a withdrawal request that
 * cannot be actioned is a legal exposure rather than a backlog.
 *
 * The signature and the voice recording are deliberately only available on
 * THIS screen. The agent-facing and partner-facing endpoints return consent
 * status only — never the evidence — and the detail endpoint mints 5-minute
 * signed URLs per request rather than storing public ones.
 */
export default function ConsentPage() {
  const [status, setStatus] = useState('pending_verification');
  const [entityType, setEntityType] = useState('');
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState(null);
  const qc = useQueryClient();

  const { data: list, isLoading, isError, error } = useQuery({
    queryKey: ['admin-consent', status, entityType, page],
    queryFn: () =>
      api.list('/admin/consent', {
        params: {
          // Omitted rather than sent blank: the list validator treats an
          // empty string as a value and would filter on it.
          status: status || undefined,
          entityType: entityType || undefined,
          page,
          pageSize: 20,
        },
      }),
  });

  const withdraw = useMutation({
    mutationFn: ({ id, reason }) => api.post(`/admin/consent/${id}/withdraw`, { reason }),
    onSuccess: () => {
      toast.success('Consent withdrawn');
      qc.invalidateQueries({ queryKey: ['admin-consent'] });
      // A withdrawal stops future collection and sharing for that entity, so
      // anything showing its sharing state is now stale.
      qc.invalidateQueries({ queryKey: ['admin-farmers'] });
      qc.invalidateQueries({ queryKey: ['admin-cooperatives'] });
      setSelectedId(null);
    },
  });

  const columns = [
    {
      key: 'signer',
      label: 'Signer',
      render: (r) => (
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-lg bg-forest-100 text-forest-700 text-xs font-bold flex items-center justify-center">
            {initials(r.signer_name)}
          </div>
          <div className="min-w-0">
            <p className="font-medium text-ink truncate">{r.signer_name || '—'}</p>
            <p className="text-xs text-smoke truncate">{r.signer_role || '—'}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'entity',
      label: 'For',
      render: (r) => (
        <span className="capitalize text-smoke">{r.entity_type || '—'}</span>
      ),
    },
    {
      key: 'sharing',
      label: 'Third-party sharing',
      render: (r) =>
        r.third_party_sharing ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-forest-700 font-medium">
            <ShieldCheck className="size-3.5 text-forest-500" /> Agreed
          </span>
        ) : (
          // Declining sharing is a valid outcome, not a problem — the
          // record registers without it. Shown in neutral grey, not red.
          <span className="text-xs text-smoke">Declined</span>
        ),
    },
    {
      key: 'evidence',
      label: 'Evidence',
      render: (r) => (
        <span className="inline-flex items-center gap-2 text-xs text-smoke">
          {r.signature_file ? (
            <FileSignature className="size-3.5 text-forest-500" title="Signature on file" />
          ) : null}
          {r.voice_file ? (
            <Mic className="size-3.5 text-forest-500" title="Voice statement on file" />
          ) : null}
          {!r.signature_file && !r.voice_file ? '—' : null}
        </span>
      ),
    },
    { key: 'status', label: 'Status', render: (r) => <StatusPill status={r.status} /> },
    {
      key: 'recorded',
      label: 'Recorded',
      render: (r) => <span className="text-smoke text-xs">{formatDateTime(r.created_at)}</span>,
    },
    {
      key: 'actions',
      label: '',
      align: 'right',
      render: (r) => (
        <Button variant="secondary" onClick={() => setSelectedId(r.id)}>
          View
        </Button>
      ),
    },
  ];

  const STATUSES = [
    ['pending_verification', 'Pending verification'],
    ['active', 'Active'],
    ['withdrawn', 'Withdrawn'],
    ['superseded', 'Superseded'],
    ['', 'All'],
  ];

  return (
    <>
      <PageHeader
        eyebrow="Compliance"
        title="Data Consent Register"
        description="Every consent on record, with the signature and recorded statement behind it. Withdrawals take effect immediately."
      />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        {STATUSES.map(([value, label]) => (
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

        <span className="mx-1 h-5 w-px bg-whisper" aria-hidden="true" />

        {[
          ['', 'Both'],
          ['cooperative', 'Cooperatives'],
          ['farmer', 'Farmers'],
        ].map(([value, label]) => (
          <button
            type="button"
            key={value || 'both'}
            onClick={() => {
              setEntityType(value);
              setPage(1);
            }}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition ${
              entityType === value
                ? 'bg-ink text-white'
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
            Could not load the consent register{error?.message ? `: ${error.message}` : ''}.
          </p>
        </Card>
      )}

      <DataTable
        loading={isLoading}
        columns={columns}
        rows={list?.data}
        empty={
          <EmptyState
            icon={FileSignature}
            title="No consent records"
            description="Consent captured by field agents during onboarding appears here."
          />
        }
      />
      <Pagination
        page={page}
        pageSize={list?.meta?.pageSize || 20}
        total={list?.meta?.total || 0}
        onPageChange={setPage}
      />

      {selectedId && (
        <ConsentModal
          consentId={selectedId}
          onClose={() => setSelectedId(null)}
          onWithdraw={(reason) => withdraw.mutate({ id: selectedId, reason })}
          submitting={withdraw.isPending}
        />
      )}
    </>
  );
}

/**
 * One consent record, with its evidence.
 *
 * Fetched by id rather than reused from the list row, because the evidence
 * URLs are minted per request and expire in five minutes — a URL carried in a
 * list response would be dead by the time anyone clicked it.
 */
function ConsentModal({ consentId, onClose, onWithdraw, submitting }) {
  const [mode, setMode] = useState(null);
  const [reason, setReason] = useState('');

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['admin-consent-detail', consentId],
    queryFn: () => api.get(`/admin/consent/${consentId}`),
    // Not cached: the signed URLs inside expire, so a second open must mint
    // new ones rather than serve a stale pair.
    gcTime: 0,
    staleTime: 0,
  });

  const consent = data ?? null;
  const items = consent?.item_responses ?? {};
  const canWithdraw = consent?.status === 'active' || consent?.status === 'pending_verification';

  return (
    <Modal
      open
      onClose={onClose}
      title={consent?.signer_name || 'Consent record'}
      description={
        consent
          ? `${consent.entity_type === 'cooperative' ? 'Cooperative' : 'Farmer'} consent · ${consent.agreement_version || 'v1.0'}`
          : undefined
      }
      size="lg"
      footer={
        mode === 'withdraw' ? (
          <>
            <Button variant="ghost" onClick={() => setMode(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={submitting}
              disabled={reason.trim().length < 3}
              onClick={() => onWithdraw(reason)}
            >
              <Ban className="size-4" /> Withdraw consent
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
            {canWithdraw && (
              <Button variant="danger" onClick={() => setMode('withdraw')}>
                <Ban className="size-4" /> Withdraw
              </Button>
            )}
          </>
        )
      }
    >
      {isLoading && <p className="text-sm text-smoke">Loading the record…</p>}

      {isError && (
        <p className="text-sm text-red-700">
          Could not load this record{error?.message ? `: ${error.message}` : ''}.
        </p>
      )}

      {consent && mode === 'withdraw' && (
        <div className="space-y-3">
          <Card padded className="border-red-200 bg-red-50/60">
            <p className="text-sm text-red-800">
              Withdrawal stops any further collection and sharing for this{' '}
              {consent.entity_type}. Loan and repayment records already made are
              retained for settlement and audit — withdrawing consent does not
              erase them.
            </p>
          </Card>
          <Field label="Reason" required hint="Recorded against the withdrawal. At least 3 characters.">
            <Textarea
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Leader requested withdrawal by phone on 12 Nov"
            />
          </Field>
        </div>
      )}

      {consent && mode !== 'withdraw' && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            <KV label="Status" value={<StatusPill status={consent.status} />} />
            <KV label="Signer role" value={consent.signer_role || '—'} />
            <KV label="Language" value={(consent.language || 'en').toUpperCase()} />
            <KV
              label="OTP verification"
              value={
                consent.otp_status === 'verified' ? (
                  <span className="inline-flex items-center gap-1.5 text-forest-700">
                    <ShieldCheck className="size-3.5 text-forest-500" /> Verified
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-harvest-700">
                    <Clock className="size-3.5 text-harvest-500" />
                    {(consent.otp_status || 'pending').replace(/_/g, ' ')}
                  </span>
                )
              }
            />
            <KV
              label="Third-party sharing"
              value={consent.third_party_sharing ? 'Agreed' : 'Declined'}
            />
            <KV label="Recorded" value={formatDateTime(consent.created_at)} />
          </div>

          {/* What was actually agreed, item by item. A summary flag is not an
              audit trail — the register has to show which questions were put
              and how each was answered. */}
          <div>
            <p className="eyebrow mb-2">Responses</p>
            {Object.keys(items).length === 0 ? (
              <p className="text-sm text-smoke">No itemised responses on this record.</p>
            ) : (
              <ul className="divide-y divide-whisper/60 rounded-xl border border-whisper overflow-hidden">
                {Object.entries(items).map(([key, agreed]) => (
                  <li
                    key={key}
                    className="flex items-center justify-between gap-4 px-3 py-2 text-sm bg-white"
                  >
                    <span className="font-mono text-xs text-smoke">{key}</span>
                    <span
                      className={
                        agreed ? 'text-forest-700 font-medium' : 'text-smoke font-medium'
                      }
                    >
                      {agreed ? 'Agreed' : 'Declined'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* The evidence. These URLs expire in five minutes, which is why
              they are fetched with the record rather than held in a list. */}
          <div>
            <p className="eyebrow mb-2">Evidence</p>
            <div className="space-y-3">
              {consent.evidence?.signatureUrl ? (
                <div>
                  <p className="text-xs text-smoke mb-1">Signature</p>
                  <img
                    src={consent.evidence.signatureUrl}
                    alt={`Signature of ${consent.signer_name || 'the signer'}`}
                    className="max-h-32 rounded-lg border border-whisper bg-white"
                  />
                </div>
              ) : (
                <EvidenceMissing
                  icon={FileSignature}
                  label="Signature"
                  stored={Boolean(consent.signature_file)}
                />
              )}

              {consent.evidence?.voiceUrl ? (
                <div>
                  <p className="text-xs text-smoke mb-1">Recorded statement</p>
                  {/* No caption track: a spoken consent statement in the
                      signer's own voice has none, and inventing a transcript
                      would misrepresent the evidence. The itemised responses
                      above are the readable record of what was agreed. */}
                  <audio controls src={consent.evidence.voiceUrl} className="w-full">
                    Your browser cannot play this recording.
                  </audio>
                </div>
              ) : (
                <EvidenceMissing
                  icon={Mic}
                  label="Recorded statement"
                  stored={Boolean(consent.voice_file)}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

/**
 * Distinguishes "never captured" from "captured but the link failed".
 *
 * The detail endpoint sets an evidence URL to null when signing it fails, so
 * without this an expired bucket or a storage outage would read as the agent
 * never having collected a signature — which is the difference between a
 * compliant record and a non-compliant one.
 */
function EvidenceMissing({ icon: Icon, label, stored }) {
  return (
    <div className="flex items-start gap-2 text-sm">
      {stored ? (
        <AlertCircle className="size-4 text-harvest-500 mt-0.5 shrink-0" />
      ) : (
        <Icon className="size-4 text-smoke mt-0.5 shrink-0" />
      )}
      <div>
        <p className="text-ink">{label}</p>
        <p className="text-xs text-smoke">
          {stored
            ? 'On file, but the secure link could not be generated. Try again shortly.'
            : 'Not captured.'}
        </p>
      </div>
    </div>
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
