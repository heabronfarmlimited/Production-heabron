/**
 * Repayment + financing-request models used by the Record Repayment screen.
 *
 * NOTE — the Flutter screen reused `FinancingHistoryItem` from the
 * cooperatives module (33 fields, every key read twice, a fabricated
 * `'FN-<epoch>'` loan ref and a `status` that defaulted to the literal
 * `'Approved'`). Only five of those fields are needed here, so this module
 * defines its own minimal read model rather than taking a cross-module
 * dependency — and it never invents a value the server did not send.
 */
import {
  compact,
  nullableInt,
  nullableNum,
  nullableStr,
  num,
  obj,
  orUndefined,
  pick,
  str,
} from './primitives';

/**
 * A row of `GET /agent/financing-requests?farmerId=…`.
 *
 * `repayments.controller.js` only accepts a repayment when the request's
 * status is `approved` or `disbursed`, so the screen filters on that rather
 * than offering every historical request as the Dart version did.
 */
export interface FarmerFinancingRequest {
  id: string;
  farmerId: string | null;
  cooperativeId: string | null;
  loanAmount: number;
  approvedAmount: number | null;
  disbursedAmount: number | null;
  purpose: string | null;
  season: string | null;
  status: string | null;
  cycleNumber: number | null;
  dueDate: string | null;
  createdAt: string | null;
}

export function parseFarmerFinancingRequest(raw: unknown): FarmerFinancingRequest {
  const f = obj(raw);
  return {
    id: str(f.id),
    farmerId: nullableStr(pick(f, 'farmer_id', 'farmerId')),
    cooperativeId: nullableStr(pick(f, 'cooperative_id', 'cooperativeId')),
    loanAmount: num(pick(f, 'loan_amount', 'loanAmount', 'amount')),
    approvedAmount: nullableNum(pick(f, 'approved_amount', 'approvedAmount')),
    disbursedAmount: nullableNum(pick(f, 'disbursed_amount', 'disbursedAmount')),
    purpose: nullableStr(f.purpose),
    season: nullableStr(f.season),
    // No `'Approved'` fallback: an absent status is unknown, not approved.
    status: nullableStr(f.status),
    cycleNumber: nullableInt(pick(f, 'cycle_number', 'cycleNumber')),
    dueDate: nullableStr(pick(f, 'due_date', 'dueDate')),
    createdAt: nullableStr(pick(f, 'created_at', 'createdAt')),
  };
}

/** The statuses `repayments.controller.create` will accept a payment against. */
export const REPAYABLE_STATUSES: readonly string[] = ['approved', 'disbursed'];

export const isRepayable = (request: FarmerFinancingRequest): boolean =>
  REPAYABLE_STATUSES.includes((request.status ?? '').toLowerCase());

/** A `repayment_records` row — `GET /agent/repayments`. */
export interface Repayment {
  id: string;
  financingRequestId: string | null;
  farmerId: string | null;
  farmerName: string | null;
  amountPaid: number;
  paymentDate: string | null;
  paymentMethod: string | null;
  referenceNumber: string | null;
  proofPhotoUrl: string | null;
  contextFlag: string | null;
  contextNotes: string | null;
  voided: boolean;
  createdAt: string | null;
}

export function parseRepayment(raw: unknown): Repayment {
  const r = obj(raw);
  const farmers = obj(Array.isArray(r.farmers) ? r.farmers[0] : r.farmers);
  return {
    id: str(r.id),
    financingRequestId: nullableStr(
      pick(r, 'financing_request_id', 'financingRequestId'),
    ),
    farmerId: nullableStr(pick(r, 'farmer_id', 'farmerId')),
    farmerName: nullableStr(pick(farmers, 'full_name', 'fullName')),
    amountPaid: num(pick(r, 'amount_paid', 'amountPaid')),
    paymentDate: nullableStr(pick(r, 'payment_date', 'paymentDate')),
    paymentMethod: nullableStr(pick(r, 'payment_method', 'paymentMethod')),
    referenceNumber: nullableStr(pick(r, 'reference_number', 'referenceNumber')),
    proofPhotoUrl: nullableStr(pick(r, 'proof_photo_url', 'proofPhotoUrl')),
    contextFlag: nullableStr(pick(r, 'context_flag', 'contextFlag')),
    contextNotes: nullableStr(pick(r, 'context_notes', 'contextNotes')),
    voided: pick(r, 'voided') === true,
    createdAt: nullableStr(pick(r, 'created_at', 'createdAt')),
  };
}

export interface RepaymentFormInput {
  financingRequestId: string;
  farmerId: string;
  amountPaid: number;
  /** `yyyy-MM-dd`; the validator caps it at `now`. */
  paymentDate: string;
  paymentMethod: string;
  referenceNumber: string;
  /** Required in practice — see `repaymentSchema`. */
  proofPhotoUrl: string;
  contextFlag: string;
  contextNotes: string;
}

/** `POST /agent/repayments` body — camelCase, all nine fields. */
export function toRepaymentBody(input: RepaymentFormInput): Record<string, unknown> {
  return compact({
    financingRequestId: input.financingRequestId,
    farmerId: input.farmerId,
    amountPaid: input.amountPaid,
    paymentDate: input.paymentDate,
    paymentMethod: input.paymentMethod,
    referenceNumber: orUndefined(input.referenceNumber),
    proofPhotoUrl: orUndefined(input.proofPhotoUrl),
    contextFlag: input.contextFlag,
    contextNotes: orUndefined(input.contextNotes),
  });
}

/** The extra fields `repayments.controller.create` returns alongside the row. */
export interface RepaymentResult extends Repayment {
  outstandingBalance: number;
  totalPaid: number;
  loanAmount: number;
  financingStatus: string | null;
}

export function parseRepaymentResult(raw: unknown): RepaymentResult {
  const r = obj(raw);
  return {
    ...parseRepayment(r),
    outstandingBalance: num(r.outstandingBalance),
    totalPaid: num(r.totalPaid),
    loanAmount: num(r.loanAmount),
    financingStatus: nullableStr(r.financingStatus),
  };
}
