import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
// FIXED — Trash2 was imported but never rendered (there is no delete action).
import { CheckCheck, Bell } from 'lucide-react';
import api from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, EmptyState, Skeleton } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Pagination } from '@/components/ui/DataTable';
import { relativeTime, cn } from '@/lib/utils';
import toast from 'react-hot-toast';

const PAGE_SIZE = 25;

export default function NotificationsPage({ audience = 'admin' }) {
  const base = audience === 'admin' ? '/admin' : '/partner';
  const [page, setPage] = useState(1);
  const qc = useQueryClient();

  // FIXED — api.raw bypass replaced with the list helper (keeps `meta`).
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['notifications-page', audience, page],
    queryFn: () => api.list(`${base}/notifications`, { params: { page, pageSize: PAGE_SIZE } }),
  });

  const rows = data?.data || [];
  const meta = data?.meta;
  const unreadCount = rows.filter((n) => !n.is_read).length;

  const markRead = useMutation({
    mutationFn: (id) => api.patch(`${base}/notifications/${id}/read`),
    // FIXED — only the page's own list was invalidated, so the bell's unread
    // badge in the header kept the stale count until a poll came round.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications-page', audience] });
      qc.invalidateQueries({ queryKey: ['notifications-unread', audience] });
      qc.invalidateQueries({ queryKey: ['notifications-list', audience] });
    },
  });
  const markAll = useMutation({
    mutationFn: () => api.patch(`${base}/notifications/read-all`),
    onSuccess: () => {
      toast.success('All marked as read');
      qc.invalidateQueries({ queryKey: ['notifications-page', audience] });
      qc.invalidateQueries({ queryKey: ['notifications-unread', audience] });
      qc.invalidateQueries({ queryKey: ['notifications-list', audience] });
    },
  });

  return (
    <>
      <PageHeader
        eyebrow="Inbox"
        title="Notifications"
        description="Updates from across the platform."
        actions={
          <Button
            variant="secondary"
            onClick={() => markAll.mutate()}
            loading={markAll.isPending}
            disabled={unreadCount === 0}
          >
            <CheckCheck className="size-4" /> Mark all read
          </Button>
        }
      />

      {/* FIXED — no error state: a failed request rendered "You're all caught
          up", which is the opposite of the truth. */}
      {isError && (
        <Card padded className="mb-4 border-red-200 bg-red-50/60">
          <p className="text-sm text-red-700">Could not load notifications{error?.message ? `: ${error.message}` : ''}.</p>
        </Card>
      )}

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : rows.length === 0 ? (
        <Card padded>
          <EmptyState icon={Bell} title="You're all caught up" description="New notifications will appear here." />
        </Card>
      ) : (
        <Card>
          <div className="divide-y divide-whisper/40">
            {/* FIXED — the row carried `cursor-pointer` but had no click
                handler at all: it looked interactive and did nothing. Clicking
                an unread row now marks it read (the only action available). */}
            {rows.map((n) => (
              <div
                key={n.id}
                role={!n.is_read ? 'button' : undefined}
                tabIndex={!n.is_read ? 0 : undefined}
                onClick={!n.is_read ? () => markRead.mutate(n.id) : undefined}
                onKeyDown={!n.is_read ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); markRead.mutate(n.id); }
                } : undefined}
                className={cn(
                  'flex items-start gap-3 p-4 transition',
                  !n.is_read && 'bg-forest-50/40 cursor-pointer hover:bg-bone focus-visible:outline-none focus-visible:bg-bone'
                )}
              >
                <div className={cn('size-2 rounded-full mt-2.5 shrink-0', !n.is_read ? 'bg-forest-500' : 'bg-transparent')} />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold">{n.title || 'Notification'}</p>
                  {n.message && <p className="text-sm text-smoke">{n.message}</p>}
                  <p className="text-[11px] text-smoke mt-1">{relativeTime(n.created_at)}</p>
                </div>
                {!n.is_read && (
                  <Button
                    variant="ghost"
                    disabled={markRead.isPending}
                    onClick={(e) => { e.stopPropagation(); markRead.mutate(n.id); }}
                  >
                    Mark read
                  </Button>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      <Pagination page={meta?.page || page} pageSize={meta?.pageSize || PAGE_SIZE} total={meta?.total || 0} onPageChange={setPage} />
    </>
  );
}
