/**
 * Agent repayment — ported from
 * modules/activities/domain/dto/activity_models.dart
 *
 * `AgentRepayment.fromJson` accepts **both** snake_case and camelCase on every
 * single field (`json['amount_paid'] ?? json['amountPaid']`, and so on), so
 * `pick` is used throughout with the snake_case spelling first. The backend's
 * `repayments.list` returns raw `repayment_records` rows, i.e. snake_case; the
 * camelCase fallbacks cover the create response, which echoes the request body.
 *
 * `farmerName` resolves through three sources in Dart order:
 *   json['farmer_name'] ?? farmers.full_name ?? json['farmerName']
 *
 * The embedded objects come from the PostgREST select in
 * backend/src/controllers/repayments.controller.js:
 *   `*, farmers(id, full_name),
 *       financing_requests(id, loan_amount, cooperative_id, cooperatives(name))`
 */
import { nullableNum, nullableStr, obj, pick, type Raw } from './primitives';

/** `RepaymentFarmer` */
export interface RepaymentFarmer {
  id: string | null;
  fullName: string | null;
}

export function parseRepaymentFarmer(raw: unknown): RepaymentFarmer | null {
  if (!raw || typeof raw !== 'object') return null;
  const f = obj(raw);
  return {
    id: nullableStr(f.id),
    fullName: nullableStr(pick(f, 'full_name', 'fullName')),
  };
}

/**
 * `RepaymentFinancingRequest`
 *
 * `cooperativeName` is **nested**: `json['cooperatives']['name']`. It is not a
 * column on `financing_requests`; it only exists because of the embed.
 */
export interface RepaymentFinancingRequest {
  id: string | null;
  loanAmount: number | null;
  cooperativeId: string | null;
  cooperativeName: string | null;
}

export function parseRepaymentFinancingRequest(
  raw: unknown,
): RepaymentFinancingRequest | null {
  if (!raw || typeof raw !== 'object') return null;
  const f = obj(raw);
  return {
    id: nullableStr(f.id),
    loanAmount: nullableNum(pick(f, 'loan_amount', 'loanAmount')),
    cooperativeId: nullableStr(pick(f, 'cooperative_id', 'cooperativeId')),
    // Dart: `(json['cooperatives'] as Map?)?['name'] as String?`
    cooperativeName: nullableStr(obj(f.cooperatives).name),
  };
}

export interface AgentRepayment {
  id: string | null;
  financingRequestId: string | null;
  farmerId: string | null;
  amountPaid: number | null;
  paymentDate: string | null;
  paymentMethod: string | null;
  referenceNumber: string | null;
  proofPhotoUrl: string | null;
  contextFlag: string | null;
  contextNotes: string | null;
  /** `farmer_name` ‖ `farmers.full_name` ‖ `farmerName`. */
  farmerName: string | null;
  recordedByAgentId: string | null;
  createdAt: string | null;
  farmer: RepaymentFarmer | null;
  financingRequest: RepaymentFinancingRequest | null;
}

/** `AgentRepayment.fromJson` */
export function parseAgentRepayment(raw: unknown): AgentRepayment {
  const r: Raw = obj(raw);

  const farmer = parseRepaymentFarmer(r.farmers);
  const financingRequest = parseRepaymentFinancingRequest(r.financing_requests);

  return {
    id: nullableStr(r.id),
    financingRequestId: nullableStr(pick(r, 'financing_request_id', 'financingRequestId')),
    farmerId: nullableStr(pick(r, 'farmer_id', 'farmerId')),
    amountPaid: nullableNum(pick(r, 'amount_paid', 'amountPaid')),
    paymentDate: nullableStr(pick(r, 'payment_date', 'paymentDate')),
    paymentMethod: nullableStr(pick(r, 'payment_method', 'paymentMethod')),
    referenceNumber: nullableStr(pick(r, 'reference_number', 'referenceNumber')),
    proofPhotoUrl: nullableStr(pick(r, 'proof_photo_url', 'proofPhotoUrl')),
    contextFlag: nullableStr(pick(r, 'context_flag', 'contextFlag')),
    contextNotes: nullableStr(pick(r, 'context_notes', 'contextNotes')),
    // The embedded farmer sits between the two flat spellings, per Dart.
    farmerName:
      nullableStr(r.farmer_name) ?? farmer?.fullName ?? nullableStr(r.farmerName),
    recordedByAgentId: nullableStr(pick(r, 'recorded_by_agent_id', 'recordedByAgentId')),
    createdAt: nullableStr(pick(r, 'created_at', 'createdAt')),
    farmer,
    financingRequest,
  };
}

/**
 * The Repayments tab filter — a case-insensitive contains over exactly the
 * five fields the Dart screen searched:
 *   farmerId, paymentMethod, referenceNumber, amountPaid.toString(), farmerName
 *
 * `amountPaid` is matched as a bare number string (`item.amountPaid?.toString()`
 * in Dart), so "1500" matches but the formatted "₦1,500.00" does not.
 */
export function filterRepayments(
  items: AgentRepayment[],
  search: string,
): AgentRepayment[] {
  const term = search.trim().toLowerCase();
  if (term.length === 0) return items;

  return items.filter(
    (item) =>
      (item.farmerId?.toLowerCase().includes(term) ?? false) ||
      (item.paymentMethod?.toLowerCase().includes(term) ?? false) ||
      (item.referenceNumber?.toLowerCase().includes(term) ?? false) ||
      (item.amountPaid != null && String(item.amountPaid).includes(term)) ||
      (item.farmerName?.toLowerCase().includes(term) ?? false),
  );
}
