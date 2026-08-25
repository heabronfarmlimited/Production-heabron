import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, Pause, Play, UserCheck } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState, StatusPill, Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Field, Textarea } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { DataTable, Pagination } from '@/components/ui/DataTable';
import { initials, formatDate } from '@/lib/utils';

export default function AgentsPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [suspendTarget, setSuspendTarget] = useState(null);
  const qc = useQueryClient();

  const { data: list, isLoading } = useQuery({
    queryKey: ['agents', { search, status, page }],
    queryFn: () => api.raw.get('/admin/agents', { params: { search, status, page, pageSize: 20 } }).then((r) => r.data),
  });

  const reactivate = useMutation({
    mutationFn: (id) => api.post(`/admin/agents/${id}/reactivate`),
    onSuccess: () => { toast.success('Reactivated'); qc.invalidateQueries({ queryKey: ['agents'] }); },
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
            <p className="font-medium text-ink truncate">{r.full_name || '—'}</p>
            <p className="text-xs text-smoke truncate">{r.email}</p>
          </div>
        </div>
      ),
    },
    { key: 'phone', label: 'Phone', render: (r) => <span className="tabular">{r.phone || '—'}</span> },
    { key: 'location', label: 'Location', render: (r) => [r.lga, r.state].filter(Boolean).join(', ') || '—' },
    { key: 'status', label: 'Status', render: (r) => <StatusPill status={r.status} /> },
    { key: 'joined', label: 'Joined', render: (r) => <span className="text-smoke text-xs">{formatDate(r.created_at)}</span> },
    {
      key: 'actions',
      label: '',
      align: 'right',
      render: (r) => (
        r.status === 'active' ? (
          <Button variant="ghost" onClick={() => setSuspendTarget(r)}>
            <Pause className="size-4" /> Suspend
          </Button>
        ) : r.status === 'suspended' ? (
          <Button variant="secondary" onClick={() => reactivate.mutate(r.user_id)}>
            <Play className="size-4" /> Reactivate
          </Button>
        ) : null
      ),
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow="People"
        title="Field Agents"
        description="Manage all agents who collect cooperative + farmer data on the ground."
      />

      <Card padded={false} className="mb-4">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-smoke" />
            <Input
              placeholder="Search by name…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="pl-10"
            />
          </div>
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="input max-w-[200px]">
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="pending">Pending</option>
            <option value="suspended">Suspended</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
      </Card>

      <DataTable
        loading={isLoading}
        columns={columns}
        rows={list?.data || []}
        empty={<EmptyState icon={UserCheck} title="No agents found" />}
      />
      <Pagination page={page} pageSize={20} total={list?.meta?.total || 0} onPageChange={setPage} />

      {suspendTarget && (
        <SuspendModal
          agent={suspendTarget}
          onClose={() => setSuspendTarget(null)}
          onDone={() => { setSuspendTarget(null); qc.invalidateQueries({ queryKey: ['agents'] }); }}
        />
      )}
    </>
  );
}

function SuspendModal({ agent, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      await api.post(`/admin/agents/${agent.user_id}/suspend`, { reason });
      toast.success(`${agent.full_name} suspended`);
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Suspend ${agent.full_name}?`}
      description="The agent will be locked out and notified by email."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="danger" loading={busy} disabled={!reason.trim()} onClick={submit}>
            Suspend agent
          </Button>
        </>
      }
    >
      <Field label="Reason" required>
        <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why are you suspending this agent?" />
      </Field>
    </Modal>
  );
}
