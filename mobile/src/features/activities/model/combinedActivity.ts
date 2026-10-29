/**
 * The merged feed behind the 'All' tab — ports `_CombinedActivity` and the
 * per-type title/subtitle builders from activities_view.dart.
 *
 * The Dart view built these strings inline in three places (the Repayments
 * tab, the Imports tab and the All tab), which is why the All tab drifted: it
 * re-derived the import status colour from `item.import?.statusText` with a
 * different fallback than the Imports tab used. They are derived once here, so
 * every tab shows the same row for the same record.
 *
 * Deliveries join the feed in this port. In Flutter the 'Deliveries' tab was
 * `const _EmptyState(message: 'No deliveries found')` with no repository
 * behind it, so deliveries never appeared in 'All' either.
 */
import { formatNaira, formatRelativeTime } from '../../../core/utils/format';

import { importStatusText, type AgentImport } from './agentImport';
import type { AgentRepayment } from './agentRepayment';
import type { Delivery } from './delivery';

export type ActivityKind = 'repayment' | 'import' | 'delivery';

export interface CombinedActivity {
  key: string;
  kind: ActivityKind;
  title: string;
  subtitle: string;
  /** Relative label, e.g. "3 hours ago". */
  time: string;
  /** Epoch ms, for the descending sort. */
  date: number;
  repayment?: AgentRepayment;
  import?: AgentImport;
  delivery?: Delivery;
}

/**
 * `DateTime.tryParse(x ?? '') ?? DateTime.now()` — the Dart fallback. A row
 * with a missing or malformed date sorts as "just now" rather than vanishing.
 */
function toMs(iso: string | null): number {
  if (!iso) return Date.now();
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? Date.now() : ms;
}

function describe(ms: number): { time: string; date: number } {
  return { time: formatRelativeTime(new Date(ms).toISOString()), date: ms };
}

/**
 * Repayment row.
 *
 * Dart title:    `'Repayment of ₦${amountPaid?.toStringAsFixed(2) ?? '0.00'}'`
 * Dart subtitle: `'Farmer: ${farmerName ?? farmerId ?? 'N/A'} via ${paymentMethod ?? 'N/A'}'`
 * Dart time:     `formatRelativeTime(paymentDate)`
 */
export function repaymentActivity(item: AgentRepayment, index = 0): CombinedActivity {
  const { time, date } = describe(toMs(item.paymentDate));
  return {
    key: item.id ?? `repayment-${index}`,
    kind: 'repayment',
    title: `Repayment of ${formatNaira(item.amountPaid)}`,
    subtitle: `Farmer: ${item.farmerName ?? item.farmerId ?? 'N/A'} via ${item.paymentMethod ?? 'N/A'}`,
    time,
    date,
    repayment: item,
  };
}

/**
 * Import row.
 *
 * Dart title:    `'Import: ${filename ?? 'CSV Upload'}'`
 * Dart subtitle: `'Status: ${statusText} (${successfulRows ?? 0}/${totalRows ?? 0} imported)'`
 * Dart time:     `formatRelativeTime(createdAt)`
 */
export function importActivity(item: AgentImport, index = 0): CombinedActivity {
  const { time, date } = describe(toMs(item.createdAt));
  return {
    key: item.id ?? `import-${index}`,
    kind: 'import',
    title: `Import: ${item.filename ?? 'CSV Upload'}`,
    subtitle: `Status: ${importStatusText(item)} (${item.successfulRows ?? 0}/${item.totalRows ?? 0} imported)`,
    time,
    date,
    import: item,
  };
}

/**
 * Delivery row — **new**, so the copy has no Flutter original.
 *
 * The title reuses the phrasing the backend already writes into its own
 * 'Delivery logged' notification (`${quantity_kg} kg of ${crop} from
 * ${full_name}`) rather than inventing a new form, and the subtitle follows the
 * repayment row's `'Farmer: … • …'` shape. Every value is read from the row —
 * nothing is filled in with a placeholder beyond the `'N/A'` the other tabs
 * already use.
 */
export function deliveryActivity(item: Delivery, index = 0): CombinedActivity {
  const { time, date } = describe(toMs(item.dateDelivered ?? item.createdAt));
  const quantity = item.quantityKg ?? 0;
  return {
    key: item.id ?? `delivery-${index}`,
    kind: 'delivery',
    title: `Delivery: ${quantity} kg of ${item.crop ?? 'produce'}`,
    subtitle: `Farmer: ${item.farmerName ?? item.farmerId ?? 'N/A'} • Grade ${item.qualityGrade ?? 'N/A'}`,
    time,
    date,
    delivery: item,
  };
}

/** Newest first — `allActivities.sort((a, b) => b.date.compareTo(a.date))`. */
export function sortByDateDesc(items: CombinedActivity[]): CombinedActivity[] {
  return [...items].sort((a, b) => b.date - a.date);
}

/**
 * The 'All' tab filter: a case-insensitive contains over the rendered title
 * and subtitle, which is what the Dart screen searched.
 */
export function filterCombined(
  items: CombinedActivity[],
  search: string,
): CombinedActivity[] {
  const term = search.trim().toLowerCase();
  if (term.length === 0) return items;

  return items.filter(
    (item) =>
      item.title.toLowerCase().includes(term) ||
      item.subtitle.toLowerCase().includes(term),
  );
}
