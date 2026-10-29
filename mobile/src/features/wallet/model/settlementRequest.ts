/**
 * Settlement request — ported from
 * modules/wallet/domain/dto/settlement_request.dart
 *
 * The casing really is asymmetric, and both halves are confirmed against the
 * backend:
 *   READ   `settlement_requests` rows, snake_case
 *          (wallet.controller.js -> listSettlements returns the row verbatim)
 *   WRITE  camelCase — `validators/domain.js`:
 *            createSettlement = Joi.object({
 *              amount:        Joi.number().positive().required(),
 *              bankName:      Joi.string().required(),
 *              accountNumber: Joi.string().pattern(/^\d{10}$/).required(),
 *              accountName:   Joi.string().required(),
 *            })
 *
 * Audit item 27 ("confirm with API") is therefore resolved: the Dart code was
 * right. `toCreateSettlementBody` is the only writer, so the asymmetry is
 * contained to this file.
 */

/** Values the backend writes to `status`. */
export type SettlementStatus = 'approved' | 'rejected' | 'pending' | string;

export interface SettlementRequest {
  id: string | null;
  agentId: string | null;
  /** Dart: `?? 0.0`. */
  amount: number;
  bankName: string | null;
  accountNumber: string | null;
  accountName: string | null;
  status: SettlementStatus | null;
  adminNotes: string | null;
  createdAt: string | null;
}

const nullableStr = (v: unknown): string | null =>
  typeof v === 'string' && v.length > 0 ? v : null;

const num = (v: unknown, fallback: number): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/** `SettlementRequest.fromJson` — snake_case read keys. */
export function parseSettlementRequest(raw: unknown): SettlementRequest {
  const s = (raw ?? {}) as Record<string, unknown>;
  return {
    id: nullableStr(s.id),
    agentId: nullableStr(s.agent_id),
    amount: num(s.amount, 0),
    bankName: nullableStr(s.bank_name),
    accountNumber: nullableStr(s.account_number),
    accountName: nullableStr(s.account_name),
    status: nullableStr(s.status),
    adminNotes: nullableStr(s.admin_notes),
    createdAt: nullableStr(s.created_at),
  };
}

export interface SettlementRequestInput {
  amount: number;
  bankName: string;
  accountNumber: string;
  accountName: string;
}

/** `POST /agent/wallet/settlements` body — camelCase, per `createSettlement`. */
export function toCreateSettlementBody(
  input: SettlementRequestInput,
): Record<string, unknown> {
  return {
    amount: input.amount,
    bankName: input.bankName,
    accountNumber: input.accountNumber,
    accountName: input.accountName,
  };
}
