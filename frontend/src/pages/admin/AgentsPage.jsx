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

const PAGE_SIZE = 20;

export default function AgentsPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [suspendTarget, setSuspendTarget] = useState(null);
  const qc = useQueryClient();

  // FIXED — api.raw bypass replaced with the list helper (keeps `meta`).
  const { data: list, isLoading, isError, error } = useQuery({
    queryKey: ['agents', { search, status, page }],
    queryFn: () => api.list('/admin/agents', { params: { search, status, page, pageSize: PAGE_SIZE } }),
  });

  const reactivate = useMutation({
    mutationFn: (id) => api.post(`/admin/agents/${id}/reactivate`),
    onSuccess: () => { toast.success('Reactivated'); qc.invalidateQueries({ queryKey: ['agents'] }); },
  });

  // FIXED — the row action read `r.user_id`, which is correct for the profiles
  // row the API returns, but nothing guarded against a row without one: the
  // request then hit /admin/agents/undefined/suspend and 400'd with "Invalid
  // agentId". Disable the control instead.
  const agentIdOf = (r) => r.user_id || null;

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
          <Button variant="ghost" disabled={!agentIdOf(r)} onClick={() => setSuspendTarget(r)}>
            <Pause className="size-4" /> Suspend
          </Button>
        ) : r.status === 'suspended' ? (
          <Button
            variant="secondary"
            disabled={!agentIdOf(r) || reactivate.isPending}
            onClick={() => reactivate.mutate(agentIdOf(r))}
          >
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
              aria-label="Search agents by name"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="pl-10"
            />
          </div>
          <select
            value={status}
            onChange={(e) => { setStatus(e.target.value); setPage(1); }}
            className="input max-w-[200px]"
            aria-label="Filter agents by status"
          >
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="pending">Pending</option>
            <option value="suspended">Suspended</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
      </Card>

      {isError && (
        <Card padded className="mb-4 border-red-200 bg-red-50/60">
          <p className="text-sm text-red-700">Could not load agents{error?.message ? `: ${error.message}` : ''}.</p>
        </Card>
      )}

      <DataTable
        loading={isLoading}
        columns={columns}
        rows={list?.data}
        empty={
          <EmptyState
            icon={UserCheck}
            title={search || status ? 'No agents match these filters' : 'No agents yet'}
            description={search || status ? 'Clear the search or status filter.' : 'Approved field-agent applications appear here.'}
          />
        }
      />
      <Pagination page={page} pageSize={list?.meta?.pageSize || PAGE_SIZE} total={list?.meta?.total || 0} onPageChange={setPage} />

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
      await api.post(`/admin/agents/${agent.user_id}/suspend`, { reason: reason.trim() });
      toast.success(`${agent.full_name || 'Agent'} suspended`);
      onDone();
    } catch {
      /* toasted by the api interceptor */
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Suspend ${agent.full_name || 'this agent'}?`}
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
