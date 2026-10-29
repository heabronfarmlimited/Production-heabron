/**
 * Financing models — ported from
 * modules/cooperatives/domain/dto/financing_history.dart and
 * modules/cooperatives/domain/dto/financing_request_req.dart
 *
 * `financing_requests` rows reach the client in two shapes: snake_case from
 * PostgREST (the list and detail endpoints) and camelCase from a few
 * hand-shaped admin payloads. The Dart `fromJson` read every key both ways and
 * that behaviour is preserved — the dual read lives here and nowhere else.
 *
 * Write bodies are validated by `createFinancingRequest` in
 * backend/src/validators/domain.js.
 */
import { parseCooperative, type Cooperative } from './cooperative';
import type { FinancingRequestForm } from './validation';

// ------------------------------------------------------------------ helpers
/** Reads the first of two keys that holds a string. */
const str2 = (
  o: Record<string, unknown>,
  snake: string,
  camel: string,
): string | null => {
  const a = o[snake];
  if (typeof a === 'string' && a.length > 0) return a;
  const b = o[camel];
  if (typeof b === 'string' && b.length > 0) return b;
  return null;
};

/** Reads the first of two keys that holds a finite number. */
const num2 = (
  o: Record<string, unknown>,
  snake: string,
  camel: string,
): number | null => {
  for (const key of [snake, camel]) {
    const v = o[key];
    if (v == null || v === '') continue;
    const n = typeof v === 'number' ? v : Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
};

const int2 = (
  o: Record<string, unknown>,
  snake: string,
  camel: string,
): number | null => {
  const n = num2(o, snake, camel);
  return n == null ? null : Math.trunc(n);
};

const strList = (v: unknown): string[] | null =>
  Array.isArray(v) ? v.filter((e) => e != null).map((e) => String(e)) : null;

const str = (v: unknown, fallback = ''): string =>
  typeof v === 'string' ? v : fallback;

// --------------------------------------------------------- nested farmer
/**
 * The farmer fields the financing endpoints embed —
 * `farmers(id, full_name, credit_tier)` on the list, the full row on the
 * detail.
 *
 * NOTE — the Dart DTO parsed this through the whole 31-field `Farmer.fromJson`
 * but only ever read `fullName` and `creditTier` from it. A local shape keeps
 * this module from depending on the farmers DTO for three fields; the full
 * farmer record is fetched by the farmers module when a screen needs it.
 */
export interface FinancingFarmer {
  id: string;
  fullName: string | null;
  creditTier: string | null;
}

function parseFinancingFarmer(raw: unknown): FinancingFarmer | null {
  if (!raw || typeof raw !== 'object') return null;
  const f = raw as Record<string, unknown>;
  return {
    id: str(f.id),
    fullName: str2(f, 'full_name', 'fullName'),
    creditTier: str2(f, 'credit_tier', 'creditTier'),
  };
}

// --------------------------------------------------- financing history item
export interface FinancingHistoryItem {
  id: string;
  cooperativeId: string | null;
  farmerId: string | null;
  /**
   * FIXED — absent in the Dart original this was replaced with a *fabricated*
   * reference built from the current clock
   * (`'FN-${DateTime.now().millisecondsSinceEpoch...}'`), so a request with no
   * loan reference showed a plausible-looking one that matched no record.
   * Null now means null.
   */
  loanRef: string | null;
  amount: number;
  /**
   * FIXED — the Dart parser fell back to `DateTime.now()`, dating an undated
   * request to the moment it was opened. Null now means null.
   */
  date: string | null;
  /**
   * FIXED — the Dart parser defaulted a missing status to the literal
   * `'Approved'`, which presented an unreviewed request as approved. Null now
   * means null, and the UI shows an em-dash.
   */
  status: string | null;
  purpose: string | null;
  season: string | null;
  repaymentWindowDays: number | null;
  adminComments: string | null;
  rejectionReason: string | null;
  forwardedToPartnerId: string | null;
  partnerDecision: string | null;
  partnerDecisionAt: string | null;
  partnerComments: string | null;
  approvedAmount: number | null;
  disbursedAmount: number | null;
  disbursedAt: string | null;
  dueDate: string | null;
  submittedByAgentId: string | null;
  reviewedByAdminId: string | null;
  updatedAt: string | null;
  cooperativeName: string | null;
  farmerName: string | null;
  cooperative: Cooperative | null;
  farmer: FinancingFarmer | null;
  cycleNumber: number | null;
  totalRepaid: number | null;
  forwardedAt: string | null;
  /** `Joi.string().max(500)` server-side, despite the Dart `Map` type. */
  disbursementAccountDetails: string | null;
  disbursementReference: string | null;
  disbursementProofUrls: string[] | null;
}

/** `FinancingHistoryItem.fromJson` — tolerates snake_case and camelCase. */
export function parseFinancingHistoryItem(raw: unknown): FinancingHistoryItem {
  const j = (raw ?? {}) as Record<string, unknown>;

  const coopRaw = j.cooperatives ?? j.cooperative;
  const farmerRaw = j.farmers ?? j.farmer;
  const coop =
    coopRaw && typeof coopRaw === 'object'
      ? (coopRaw as Record<string, unknown>)
      : null;
  const farmer = parseFinancingFarmer(farmerRaw);

  return {
    id: str(j.id),
    cooperativeId: str2(j, 'cooperative_id', 'cooperativeId'),
    farmerId: str2(j, 'farmer_id', 'farmerId'),
    loanRef: str2(j, 'loan_ref', 'loanRef'),
    amount: num2(j, 'loan_amount', 'amount') ?? 0,
    date: str2(j, 'created_at', 'date'),
    status: str2(j, 'status', 'status'),
    purpose: str2(j, 'purpose', 'purpose'),
    season: str2(j, 'season', 'season'),
    repaymentWindowDays: int2(j, 'repayment_window_days', 'repaymentWindowDays'),
    adminComments: str2(j, 'admin_comments', 'adminComments'),
    rejectionReason: str2(j, 'rejection_reason', 'rejectionReason'),
    forwardedToPartnerId: str2(
      j,
      'forwarded_to_partner_id',
      'forwardedToPartnerId',
    ),
    partnerDecision: str2(j, 'partner_decision', 'partnerDecision'),
    partnerDecisionAt: str2(j, 'partner_decision_at', 'partnerDecisionAt'),
    partnerComments: str2(j, 'partner_comments', 'partnerComments'),
    approvedAmount: num2(j, 'approved_amount', 'approvedAmount'),
    disbursedAmount: num2(j, 'disbursed_amount', 'disbursedAmount'),
    disbursedAt: str2(j, 'disbursed_at', 'disbursedAt'),
    dueDate: str2(j, 'due_date', 'dueDate'),
    submittedByAgentId: str2(j, 'submitted_by_agent_id', 'submittedByAgentId'),
    reviewedByAdminId: str2(j, 'reviewed_by_admin_id', 'reviewedByAdminId'),
    updatedAt: str2(j, 'updated_at', 'updatedAt'),
    cooperativeName: coop ? str2(coop, 'name', 'name') : null,
    farmerName: farmer?.fullName ?? null,
    // Only parse a nested cooperative when the embed carries more than the id
    // and name the list query selects.
    cooperative: coop ? parseCooperative(coop) : null,
    farmer,
    cycleNumber: int2(j, 'cycle_number', 'cycleNumber'),
    totalRepaid: num2(j, 'total_repaid', 'totalRepaid'),
    forwardedAt: str2(j, 'forwarded_at', 'forwardedAt'),
    disbursementAccountDetails: str2(
      j,
      'disbursement_account_details',
      'disbursementAccountDetails',
    ),
    disbursementReference: str2(
      j,
      'disbursement_reference',
      'disbursementReference',
    ),
    disbursementProofUrls:
      strList(j.disbursement_proof_urls) ?? strList(j.disbursementProofUrls),
  };
}

/** `(approvedAmount ?? amount) - (totalRepaid ?? 0)` — the Flutter formula. */
export const outstandingAmount = (item: FinancingHistoryItem): number =>
  (item.approvedAmount ?? item.amount) - (item.totalRepaid ?? 0);

// ----------------------------------------------------------- write bodies
/**
 * `FinancingRequestReq.toJson` — camelCase.
 *
 * FIXED — the Dart version built `season` with
 * `[if (s.toLowerCase() == 'all year') 'all_year' else s.toLowerCase()].join(',')`,
 * a one-element list joined on a comma. The value is a strict Joi enum
 * (`valid('wet','dry','all_year')`), so any drift in the display label — a
 * trailing space, a rename — produced a 422. The form now holds the API value
 * directly, sourced from `FINANCING_SEASONS`.
 */
export function toFinancingRequestBody(
  cooperativeId: string,
  form: FinancingRequestForm,
): Record<string, unknown> {
  return {
    cooperativeId,
    farmerId: form.farmerId,
    loanAmount: Number(form.loanAmount),
    purpose: form.purpose.trim(),
    season: form.season,
    repaymentWindowDays: Number(form.repaymentWindowDays),
  };
}
