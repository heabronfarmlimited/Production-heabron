import { useState } from 'react';
import { Bell } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { relativeTime, cn } from '@/lib/utils';

export function NotificationBell({ audience }) {
  const [open, setOpen] = useState(false);
  const base = audience === 'admin' ? '/admin' : '/partner';
  const qc = useQueryClient();

  // Unread count — polls frequently + refetches when the tab regains focus,
  // so the badge stays close to real-time without a websocket.
  const { data: unread } = useQuery({
    queryKey: ['notifications-unread', audience],
    queryFn: () => api.get(`${base}/notifications/unread-count`),
    refetchInterval: 20_000,
    refetchOnWindowFocus: true,
  });

  // List — always enabled and polling, so opening the bell shows current data
  // immediately (no "fetch only on open" delay). Polls a little slower.
  const { data: list } = useQuery({
    queryKey: ['notifications-list', audience],
    queryFn: () => api.get(`${base}/notifications?pageSize=15`),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  const count = unread?.count || 0;
  const items = Array.isArray(list) ? list : (list?.data || []);

  async function markAll() {
    await api.patch(`${base}/notifications/read-all`);
    qc.invalidateQueries({ queryKey: ['notifications-unread', audience] });
    qc.invalidateQueries({ queryKey: ['notifications-list', audience] });
  }

  async function openPanel() {
    setOpen((v) => !v);
    // refresh the moment it opens
    qc.invalidateQueries({ queryKey: ['notifications-list', audience] });
    qc.invalidateQueries({ queryKey: ['notifications-unread', audience] });
  }

  async function markOne(n) {
    if (n.is_read) return;
    try {
      await api.patch(`${base}/notifications/${n.id}/read`);
      qc.invalidateQueries({ queryKey: ['notifications-unread', audience] });
      qc.invalidateQueries({ queryKey: ['notifications-list', audience] });
    } catch { /* non-fatal */ }
  }

  return (
    <div className="relative">
      <button
        onClick={openPanel}
        className="size-10 rounded-xl hover:bg-white transition flex items-center justify-center text-smoke relative"
        aria-label="Notifications"
      >
        <Bell className="size-5" />
        {count > 0 && (
          <span className="absolute top-1 right-1 min-w-4 h-4 px-1 rounded-full bg-harvest-400 text-[10px] font-bold text-forest-800 flex items-center justify-center">
            {count > 9 ? '9+' : count}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-2 w-96 bg-white rounded-xl shadow-elev border border-whisper/60 z-20 animate-fade-in overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-whisper/60">
              <p className="font-display text-base font-semibold">Notifications</p>
              {count > 0 && (
                <button onClick={markAll} className="text-xs text-forest-500 hover:text-forest-700 font-medium">
                  Mark all read
                </button>
              )}
            </div>
            <div className="max-h-96 overflow-y-auto divide-y divide-whisper/40">
              {items.length === 0 && (
                <p className="px-4 py-8 text-sm text-smoke text-center">You're all caught up</p>
              )}
              {items.map((n) => (
                <button
                  key={n.id}
                  onClick={() => markOne(n)}
                  className={cn('w-full text-left px-4 py-3 hover:bg-bone/60 transition', !n.is_read && 'bg-forest-50/40')}
                >
                  <div className="flex items-start gap-3">
                    <div className={cn('size-2 rounded-full mt-2 shrink-0', !n.is_read ? 'bg-forest-500' : 'bg-transparent')} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-ink">{n.title}</p>
                      <p className="text-sm text-smoke line-clamp-2">{n.message}</p>
                      <p className="text-[11px] text-smoke mt-1">{relativeTime(n.created_at)}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
