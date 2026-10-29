/**
 * CSV import log — ported from
 * modules/activities/domain/dto/activity_models.dart (`AgentImport`,
 * `ImportError`).
 *
 * Read keys are snake_case: `imports.listImports` returns raw `import_logs`
 * rows. `createdAt` reads `created_at` only in Dart; the camelCase spelling is
 * accepted here too since the bulk-import response echoes its own body.
 *
 * `statusText` and `errorSummary` were Dart **getters** with no server field
 * behind them. TypeScript interfaces cannot carry behaviour, so they are
 * exported as functions over the model and the derivation is unchanged.
 */
import { nullableInt, nullableStr, obj, pick, strList, type Raw } from './primitives';

/** `ImportError` — one failed CSV row. */
export interface ImportError {
  line: number | null;
  message: string | null;
}

export function parseImportError(raw: unknown): ImportError {
  const e = obj(raw);
  return {
    line: nullableInt(e.line),
    message: nullableStr(e.message),
  };
}

export interface AgentImport {
  id: string | null;
  agentId: string | null;
  filename: string | null;
  totalRows: number | null;
  successfulRows: number | null;
  failedRows: number | null;
  errors: ImportError[];
  importedCooperativeIds: string[];
  importedFarmerIds: string[];
  createdAt: string | null;
}

/** `AgentImport.fromJson` */
export function parseAgentImport(raw: unknown): AgentImport {
  const i: Raw = obj(raw);
  return {
    id: nullableStr(i.id),
    agentId: nullableStr(pick(i, 'agent_id', 'agentId')),
    filename: nullableStr(i.filename),
    totalRows: nullableInt(pick(i, 'total_rows', 'totalRows')),
    successfulRows: nullableInt(pick(i, 'successful_rows', 'successfulRows')),
    failedRows: nullableInt(pick(i, 'failed_rows', 'failedRows')),
    // NOTE — Dart left these `List<...>?`; empty arrays are easier to render
    // against and both call sites treated null as empty.
    errors: Array.isArray(i.errors) ? i.errors.map(parseImportError) : [],
    importedCooperativeIds: strList(
      pick(i, 'imported_cooperative_ids', 'importedCooperativeIds'),
    ),
    importedFarmerIds: strList(pick(i, 'imported_farmer_ids', 'importedFarmerIds')),
    createdAt: nullableStr(pick(i, 'created_at', 'createdAt')),
  };
}

/**
 * `AgentImport.statusText` — derived, no server field.
 *
 *   total == 0                  -> 'Empty'
 *   failed > 0 && success > 0   -> 'Partial'
 *   failed > 0 && success == 0  -> 'Failed'
 *   success > 0                 -> 'Completed'
 *   otherwise                   -> 'Pending'
 */
export function importStatusText(item: AgentImport): string {
  const success = item.successfulRows ?? 0;
  const failed = item.failedRows ?? 0;
  const total = item.totalRows ?? 0;

  if (total === 0) return 'Empty';
  if (failed > 0 && success > 0) return 'Partial';
  if (failed > 0 && success === 0) return 'Failed';
  if (success > 0) return 'Completed';
  return 'Pending';
}

/**
 * `AgentImport.errorSummary` — `'Line {line}: {message}'` joined by `', '`,
 * and the empty string when there are no errors.
 */
export function importErrorSummary(item: AgentImport): string {
  if (item.errors.length === 0) return '';
  return item.errors.map((e) => `Line ${e.line}: ${e.message}`).join(', ');
}

/**
 * The Imports tab filter — a case-insensitive contains over exactly the three
 * fields the Dart screen searched: `filename`, `statusText`, `errorSummary`.
 */
export function filterImports(items: AgentImport[], search: string): AgentImport[] {
  const term = search.trim().toLowerCase();
  if (term.length === 0) return items;

  return items.filter(
    (item) =>
      (item.filename?.toLowerCase().includes(term) ?? false) ||
      importStatusText(item).toLowerCase().includes(term) ||
      importErrorSummary(item).toLowerCase().includes(term),
  );
}
