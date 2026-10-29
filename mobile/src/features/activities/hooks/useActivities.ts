/**
 * Activity lists — replaces `ActivitiesController`.
 *
 * The Dart controller kept `_repayments` / `_imports` with a page counter and
 * a `hasMore` flag each, plus a `fetchAll` that set a single shared loading
 * state for both. Three independent infinite queries replace all of it, and
 * `usePaginatedList` removes the page-counter bug (the cursor only advanced
 * while more pages remained, so the last page was re-fetched forever).
 *
 * `deliveries` is new: the Flutter tab had no data source at all.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { qk } from '../../../core/api/queryClient';
import { usePaginatedList } from '../../../core/hooks/usePaginatedList';
import { activityLists, createDelivery } from '../api/activitiesApi';
import type { AgentImport } from '../model/agentImport';
import type { AgentRepayment } from '../model/agentRepayment';
import type { CreateDeliveryInput, Delivery } from '../model/delivery';

/** `GET /agent/repayments` */
export function useRepayments(options: { enabled?: boolean } = {}) {
  return usePaginatedList<AgentRepayment>({
    queryKey: qk.repayments(),
    url: activityLists.repayments.url,
    select: activityLists.repayments.parse,
    enabled: options.enabled,
  });
}

/** `GET /agent/imports` */
export function useImports(options: { enabled?: boolean } = {}) {
  return usePaginatedList<AgentImport>({
    queryKey: qk.imports(),
    url: activityLists.imports.url,
    select: activityLists.imports.parse,
    enabled: options.enabled,
  });
}

/**
 * `GET /agent/deliveries`
 *
 * The backend scopes the list to `logged_by_agent_id = req.user.userId` for a
 * field agent, so no filter is needed client-side.
 */
export function useDeliveries(options: { enabled?: boolean } = {}) {
  return usePaginatedList<Delivery>({
    queryKey: qk.deliveries(),
    url: activityLists.deliveries.url,
    select: activityLists.deliveries.parse,
    enabled: options.enabled,
  });
}

/**
 * `POST /agent/deliveries`
 *
 * Creating a delivery triggers a credit-score recalculation server-side and
 * writes a notification, so the dashboard counts and the notification badge
 * are invalidated alongside the list.
 */
export function useCreateDelivery() {
  const queryClient = useQueryClient();

  const mutation = useMutation<Delivery, unknown, CreateDeliveryInput>({
    mutationFn: createDelivery,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.deliveries() });
      void queryClient.invalidateQueries({ queryKey: qk.dashboard });
      void queryClient.invalidateQueries({ queryKey: qk.notificationsUnreadCount });
    },
  });

  return {
    logDelivery: mutation.mutate,
    logDeliveryAsync: mutation.mutateAsync,
    isPending: mutation.isPending,
    error: mutation.error,
  };
}
