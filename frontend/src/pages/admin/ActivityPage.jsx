import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { History } from 'lucide-react';
import api from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, Pagination } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Input';
import { relativeTime } from '@/lib/utils';

export default function ActivityPage() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['admin-activity', page, action, entityType],
    queryFn: () =>
      api.raw
        .get('/admin/activity-logs', { params: { page, pageSize: 50, action: action || undefined, entityType: entityType || undefined } })
        .then((r) => r.data),
  });

  const rows = data?.data || [];
  const meta = data?.meta;

  return (
    <>
      <PageHeader
        eyebrow="Audit"
        title="Activity Log"
        description="Immutable record of every action taken across the platform."
      />

      <div className="flex flex-wrap gap-2 mb-4">
        <Input
          placeholder="Filter by action e.g. financing_approved"
          value={action}
          onChange={(e) => { setAction(e.target.value); setPage(1); }}
          className="max-w-xs"
        />
        <Select value={entityType} onChange={(e) => { setEntityType(e.target.value); setPage(1); }} className="max-w-xs">
          <option value="">All entity types</option>
          <option value="cooperative">Cooperative</option>
          <option value="farmer">Farmer</option>
          <option value="delivery">Delivery</option>
          <option value="financing_request">Financing</option>
          <option value="repayment">Repayment</option>
          <option value="agent_application">Application</option>
          <option value="agent">Agent</option>
          <option value="partner">Partner</option>
          <option value="settlement">Settlement</option>
        </Select>
      </div>

      <DataTable
        loading={isLoading}
        empty={<EmptyState icon={History} title="No activity yet" />}
        columns={[
          { key: 'created_at', label: 'Time', width: 140, render: (r) => relativeTime(r.created_at) },
          { key: 'actor', label: 'Actor', render: (r) => (
            <div>
              <p className="font-medium text-sm">{r.profiles?.full_name || 'System'}</p>
              <p className="text-xs text-smoke">{r.actor_role?.replace('_', ' ')}</p>
            </div>
          )},
          { key: 'action', label: 'Action', render: (r) => (
            <code className="bg-bone px-2 py-0.5 rounded text-xs font-mono">{r.action}</code>
          )},
          { key: 'entity_type', label: 'Entity', render: (r) => r.entity_type ? <span className="capitalize">{r.entity_type.replace('_', ' ')}</span> : '—' },
          { key: 'entity_id', label: 'ID', render: (r) => r.entity_id ? <span className="text-xs font-mono text-smoke">{r.entity_id.slice(0, 8)}…</span> : '—' },
          { key: 'ip_address', label: 'IP', render: (r) => <span className="text-xs font-mono text-smoke">{r.ip_address || '—'}</span> },
        ]}
        rows={rows}
      />
      {meta && <Pagination page={meta.page} pageSize={meta.pageSize} total={meta.total} onPageChange={setPage} />}
    </>
  );
}
