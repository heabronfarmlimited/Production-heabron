import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { History } from 'lucide-react';
import api from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, Pagination } from '@/components/ui/DataTable';
import { Card, EmptyState } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Input';
import { relativeTime } from '@/lib/utils';

export default function ActivityPage() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');

  // FIXED — api.raw bypass replaced with the list helper (keeps `meta`).
  //
  // NOTE (backend): /admin/activity-logs runs `validate(v.listQuery, 'query')`
  // and listQuery sets `stripUnknown: true` without declaring `action`,
  // `entityType` or `actorId`, so those two filters are stripped before the
  // controller sees them and currently have no effect. The params are still
  // sent (correct shape, ready to work) and the UI says so — see
  // AUDIT_FRONTEND.md "Required backend change".
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['admin-activity', page, action, entityType],
    queryFn: () =>
      api.list('/admin/activity-logs', {
        params: { page, pageSize: 50, action: action || undefined, entityType: entityType || undefined },
      }),
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
          aria-label="Filter activity by action"
          value={action}
          onChange={(e) => { setAction(e.target.value); setPage(1); }}
          className="max-w-xs"
        />
        <Select
          value={entityType}
          aria-label="Filter activity by entity type"
          onChange={(e) => { setEntityType(e.target.value); setPage(1); }}
          className="max-w-xs"
        >
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

      {isError && (
        <Card padded className="mb-4 border-red-200 bg-red-50/60">
          <p className="text-sm text-red-700">Could not load the activity log{error?.message ? `: ${error.message}` : ''}.</p>
        </Card>
      )}

      <DataTable
        loading={isLoading}
        empty={<EmptyState icon={History} title="No activity yet" description="Every admin, agent and partner action is recorded here." />}
        columns={[
          { key: 'created_at', label: 'Time', width: 140, render: (r) => relativeTime(r.created_at) },
          // FIXED — read `r.profiles`, but activity.controller attaches the
          // resolved profile as `actor` ({ user_id, full_name, email }). Every
          // row therefore showed "System" even for a named admin.
          { key: 'actor', label: 'Actor', render: (r) => (
            <div>
              <p className="font-medium text-sm">{r.actor?.full_name || (r.actor_id ? 'Unknown user' : 'System')}</p>
              <p className="text-xs text-smoke capitalize">{(r.actor_role || '').replace(/_/g, ' ')}</p>
            </div>
          )},
          { key: 'action', label: 'Action', render: (r) => (
            <code className="bg-bone px-2 py-0.5 rounded text-xs font-mono">{r.action}</code>
          )},
          { key: 'entity_type', label: 'Entity', render: (r) => r.entity_type ? <span className="capitalize">{r.entity_type.replace(/_/g, ' ')}</span> : '—' },
          // FIXED — `.slice()` on a non-string id would throw; coerce first.
          { key: 'entity_id', label: 'ID', render: (r) => r.entity_id ? <span className="text-xs font-mono text-smoke">{String(r.entity_id).slice(0, 8)}…</span> : '—' },
          { key: 'ip_address', label: 'IP', render: (r) => <span className="text-xs font-mono text-smoke">{r.ip_address || '—'}</span> },
        ]}
        rows={rows}
      />
      {meta && <Pagination page={meta.page} pageSize={meta.pageSize} total={meta.total} onPageChange={setPage} />}
    </>
  );
}
