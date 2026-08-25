import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCheck, Bell, Trash2 } from 'lucide-react';
import api from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, EmptyState, Skeleton } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Pagination } from '@/components/ui/DataTable';
import { relativeTime, cn } from '@/lib/utils';
import toast from 'react-hot-toast';

export default function NotificationsPage({ audience = 'admin' }) {
  const base = audience === 'admin' ? '/admin' : '/partner';
  const [page, setPage] = useState(1);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['notifications-page', audience, page],
    queryFn: () => api.raw.get(`${base}/notifications`, { params: { page, pageSize: 25 } }).then((r) => r.data),
  });

  const rows = data?.data || [];
  const meta = data?.meta;

  const markRead = useMutation({
    mutationFn: (id) => api.patch(`${base}/notifications/${id}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications-page', audience] }),
  });
  const markAll = useMutation({
    mutationFn: () => api.patch(`${base}/notifications/read-all`),
    onSuccess: () => { toast.success('All marked as read'); qc.invalidateQueries({ queryKey: ['notifications-page', audience] }); },
  });

  return (
    <>
      <PageHeader
        eyebrow="Inbox"
        title="Notifications"
        description="Updates from across the platform."
        actions={<Button variant="secondary" onClick={() => markAll.mutate()} loading={markAll.isPending}><CheckCheck className="size-4" /> Mark all read</Button>}
      />

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : rows.length === 0 ? (
        <Card padded>
          <EmptyState icon={Bell} title="You're all caught up" description="New notifications will appear here." />
        </Card>
      ) : (
        <Card>
          <div className="divide-y divide-whisper/40">
            {rows.map((n) => (
              <div key={n.id} className={cn('flex items-start gap-3 p-4 cursor-pointer hover:bg-bone transition', !n.is_read && 'bg-forest-50/40')}>
                <div className={cn('size-2 rounded-full mt-2.5', !n.is_read ? 'bg-forest-500' : 'bg-transparent')} />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold">{n.title}</p>
                  <p className="text-sm text-smoke">{n.message}</p>
                  <p className="text-[11px] text-smoke mt-1">{relativeTime(n.created_at)}</p>
                </div>
                {!n.is_read && (
                  <Button variant="ghost" onClick={() => markRead.mutate(n.id)}>Mark read</Button>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {meta && <Pagination page={meta.page} pageSize={meta.pageSize} total={meta.total} onPageChange={setPage} />}
    </>
  );
}
