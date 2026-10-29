/**
 * Activities API.
 *
 * The Flutter app reached repayments and imports through
 * `$farmersRepository.getRepayments` / `.getImports` — the activities module
 * owned no repository of its own, and had no delivery calls at all. All five
 * calls are gathered here so the module is self-contained.
 *
 * Routes, from backend/src/routes/agent.routes.js:
 *   GET  /agent/repayments            validate(listQuery, 'query')
 *   GET  /agent/imports               validate(listQuery, 'query')
 *   GET  /agent/deliveries            validate(listQuery, 'query')
 *   GET  /agent/deliveries/:id        requireParamUuid('deliveryId')
 *   POST /agent/deliveries            validate(createDelivery)
 *   GET  /agent/dashboard             -> { ..., recentActivity: [...] }
 *
 * List endpoints are fetched by `usePaginatedList`, which needs only a url and
 * a row parser; the one-shot calls return domain models.
 */
import { api } from '../../../core/api/client';
import { endpoints } from '../../../core/api/endpoints';
import { parseActivityLog, type ActivityLog } from '../model/activityLog';
import { parseAgentImport } from '../model/agentImport';
import { parseAgentRepayment } from '../model/agentRepayment';
import {
  parseDelivery,
  toCreateDeliveryBody,
  type CreateDeliveryInput,
  type Delivery,
} from '../model/delivery';

/** `GET /agent/deliveries/:id` */
export async function getDelivery(id: string): Promise<Delivery> {
  return parseDelivery(await api.get<unknown>(endpoints.deliveryById(id)));
}

/** `POST /agent/deliveries` — returns the created row. */
export async function createDelivery(input: CreateDeliveryInput): Promise<Delivery> {
  return parseDelivery(
    await api.post<unknown>(endpoints.deliveries, toCreateDeliveryBody(input)),
  );
}

/**
 * The agent's own activity log, read out of the dashboard payload.
 *
 * There is no agent-scoped `/activity-logs` route — see the note on
 * `model/activityLog.ts`. The response is `{ cooperatives, farmers,
 * deliveries, financing, recentActivity }`; only the last key is read here, so
 * the dashboard module's own parsing is untouched.
 */
export async function listActivityLogs(): Promise<ActivityLog[]> {
  const data = await api.get<unknown>(endpoints.dashboard);
  const payload = (data ?? {}) as Record<string, unknown>;
  const rows = payload.recentActivity ?? payload.recent_activity;
  return Array.isArray(rows) ? rows.map(parseActivityLog) : [];
}

/** The url + row parser each paginated hook needs. */
export const activityLists = {
  /** `GET /agent/repayments` */
  repayments: {
    url: endpoints.repayments,
    parse: parseAgentRepayment,
  },
  /** `GET /agent/imports` */
  imports: {
    url: endpoints.imports,
    parse: parseAgentImport,
  },
  /** `GET /agent/deliveries` */
  deliveries: {
    url: endpoints.deliveries,
    parse: parseDelivery,
  },
} as const;
