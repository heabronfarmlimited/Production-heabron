import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, X, FileCheck, ShieldCheck, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, EmptyState, StatusPill, Skeleton } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Field, Textarea } from '@/components/ui/Input';
import { DataTable, Pagination } from '@/components/ui/DataTable';
import { formatDateTime, initials } from '@/lib/utils';

export default function ApplicationsPage() {
  const [status, setStatus] = useState('pending');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);
  const qc = useQueryClient();

  const { data: list, isLoading } = useQuery({
    queryKey: ['applications', status, page],
    queryFn: () => api.raw.get('/admin/agent-applications', { params: { status, page, pageSize: 20 } }).then((r) => r.data),
  });

  const decide = useMutation({
    mutationFn: ({ id, decision, rejectionReason }) =>
      api.post(`/admin/agent-applications/${id}/decision`, { decision, rejectionReason }),
    onSuccess: () => {
      toast.success('Decision recorded');
      qc.invalidateQueries({ queryKey: ['applications'] });
      qc.invalidateQueries({ queryKey: ['admin-dashboard'] });
      setSelected(null);
    },
  });

  const columns = [
    {
      key: 'agent',
      label: 'Agent',
      render: (r) => (
        <div className="flex items-center gap-3">
          <div className="size-9 rounded-lg bg-forest-100 text-forest-700 text-xs font-bold flex items-center justify-center">
            {initials(r.full_name)}
          </div>
          <div className="min-w-0">
            <p className="font-medium text-ink truncate">{r.full_name}</p>
            <p className="text-xs text-smoke truncate">{r.email}</p>
          </div>
        </div>
      ),
    },
    { key: 'phone', label: 'Phone', render: (r) => <span className="tabular">{r.phone}</span> },
    {
      key: 'location',
      label: 'Location',
      render: (r) => (
        <span className="text-smoke">{[r.lga, r.state].filter(Boolean).join(', ')}</span>
      ),
    },
    {
      key: 'nin',
      label: 'NIN Status',
      render: (r) => (
        <span className="inline-flex items-center gap-1.5 text-xs">
          {r.nin_verification_status === 'verified' ? (
            <><ShieldCheck className="size-3.5 text-forest-500" /> <span className="text-forest-700 font-medium">Verified</span></>
          ) : r.nin_verification_status === 'mismatch' ? (
            <><AlertCircle className="size-3.5 text-harvest-500" /> <span className="text-harvest-700 font-medium">Mismatch</span></>
          ) : (
            <><AlertCircle className="size-3.5 text-red-500" /> <span className="text-red-700 font-medium">{r.nin_verification_status}</span></>
          )}
        </span>
      ),
    },
    { key: 'submitted', label: 'Submitted', render: (r) => <span className="text-smoke text-xs">{formatDateTime(r.created_at)}</span> },
    {
      key: 'actions',
      label: '',
      align: 'right',
      render: (r) => (
        <Button variant="secondary" onClick={() => setSelected(r)}>Review</Button>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Onboarding"
        title="Field Agent Applications"
        description="Review and decide on field agent KYC submissions."
      />

      <div className="flex items-center gap-2 mb-4">
        {['pending', 'active', 'rejected'].map((s) => (
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
        empty={
          <EmptyState
            icon={FileCheck}
            title={`No ${status} applications`}
            description="Applications from new field agents will appear here."
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
        <ApplicationModal
          application={selected}
          onClose={() => setSelected(null)}
          onDecide={(decision, reason) => decide.mutate({ id: selected.id, decision, rejectionReason: reason })}
          submitting={decide.isPending}
        />
      )}
    </>
  );
}

function ApplicationModal({ application, onClose, onDecide, submitting }) {
  const [rejectionReason, setReason] = useState('');
  const [mode, setMode] = useState(null);

  return (
    <Modal
      open
      onClose={onClose}
      title={application.full_name}
      description={application.email}
      size="lg"
      footer={
        mode === 'reject' ? (
          <>
            <Button variant="ghost" onClick={() => setMode(null)}>Cancel</Button>
            <Button variant="danger" loading={submitting} disabled={!rejectionReason.trim()} onClick={() => onDecide('reject', rejectionReason)}>
              <X className="size-4" /> Reject application
            </Button>
          </>
        ) : (
          application.status === 'pending' ? (
            <>
              <Button variant="ghost" onClick={() => setMode('reject')}>
                <X className="size-4" /> Reject
              </Button>
              <Button loading={submitting} onClick={() => onDecide('approve')}>
                <Check className="size-4" /> Approve
              </Button>
            </>
          ) : null
        )
      }
    >
      <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4">
        <Detail label="Full name" value={application.full_name} />
        <Detail label="Phone" value={application.phone} />
        <Detail label="State" value={application.state} />
        <Detail label="LGA" value={application.lga} />
        <Detail label="NIN" value={<span className="tabular">{application.nin}</span>} />
        <Detail label="Date of Birth" value={application.date_of_birth} />
        <Detail label="NIN Verification" value={<StatusPill status={application.nin_verification_status} />} />
        <Detail label="Status" value={<StatusPill status={application.status} />} />
      </dl>

      {application.selfie_url && (
        <div className="mt-6">
          <p className="label mb-2">Selfie</p>
          <img src={application.selfie_url} alt="Selfie" className="max-h-72 rounded-xl border border-whisper" />
        </div>
      )}

      {application.nin_verification_payload && (
        <details className="mt-4">
          <summary className="text-sm font-medium cursor-pointer text-forest-600">View NIMC response</summary>
          <pre className="mt-2 text-xs bg-bone p-3 rounded-lg overflow-x-auto">
            {JSON.stringify(application.nin_verification_payload, null, 2)}
          </pre>
        </details>
      )}

      {mode === 'reject' && (
        <Field label="Rejection reason" required className="mt-6">
          <Textarea
            rows={3}
            value={rejectionReason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Explain why this application is being rejected. The applicant will see this."
          />
        </Field>
      )}
    </Modal>
  );
}

function Detail({ label, value }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-smoke font-semibold">{label}</dt>
      <dd className="text-sm text-ink mt-1">{value || '—'}</dd>
    </div>
  );
}
