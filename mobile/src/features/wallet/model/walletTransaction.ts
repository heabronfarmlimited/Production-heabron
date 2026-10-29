/**
 * Wallet transaction — ported from
 * modules/wallet/domain/dto/wallet_transaction.dart
 *
 * All 20 fields are read from **snake_case** keys, matching the
 * `wallet_transactions` row the backend returns verbatim
 * (backend/src/controllers/wallet.controller.js -> listTransactions).
 *
 * `WalletTransactionsResponse.fromJson` is not ported: the audit records it as
 * never invoked, and pagination metadata now comes from the shared
 * `Paginated<T>` envelope in core/api/types.ts.
 */

/** Values the backend writes to `status`. */
export type TransactionStatus =
  | 'completed'
  | 'pending'
  | 'failed'
  | 'reversed'
  | string;

export interface WalletTransaction {
  id: string | null;
  walletId: string | null;
  /** Compared against `'credit'`; anything else renders as a debit. */
  transactionType: string | null;
  /** Dart: `?? 0.0`. */
  amount: number;
  reference: string | null;
  description: string | null;
  /** Rendered with `_` replaced by a space (e.g. `cash_purchase`). */
  source: string | null;
  status: TransactionStatus | null;
  referenceNumber: string | null;
  recipientName: string | null;
  paymentMethod: string | null;
  receiptImageUrl: string | null;
  proofImageUrls: string[];
  relatedFinancingId: string | null;
  relatedRepaymentId: string | null;
  relatedFarmerId: string | null;
  createdByUserId: string | null;
  confirmedByAdminId: string | null;
  /** ISO string; the Dart DTO parsed this one to a DateTime, `createdAt` not. */
  confirmedAt: string | null;
  createdAt: string | null;
}

const nullableStr = (v: unknown): string | null =>
  typeof v === 'string' && v.length > 0 ? v : null;

const num = (v: unknown, fallback: number): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((e): e is string => typeof e === 'string' && e.length > 0) : [];

/** `WalletTransaction.fromJson` */
export function parseWalletTransaction(raw: unknown): WalletTransaction {
  const t = (raw ?? {}) as Record<string, unknown>;
  return {
    id: nullableStr(t.id),
    walletId: nullableStr(t.wallet_id),
    transactionType: nullableStr(t.transaction_type),
    amount: num(t.amount, 0),
    reference: nullableStr(t.reference),
    description: nullableStr(t.description),
    source: nullableStr(t.source),
    status: nullableStr(t.status),
    referenceNumber: nullableStr(t.reference_number),
    recipientName: nullableStr(t.recipient_name),
    paymentMethod: nullableStr(t.payment_method),
    receiptImageUrl: nullableStr(t.receipt_image_url),
    // NOTE — Dart left this `List<String>?`; an empty array is easier to
    // render against and the two call sites both treated null as empty.
    proofImageUrls: strList(t.proof_image_urls),
    relatedFinancingId: nullableStr(t.related_financing_id),
    relatedRepaymentId: nullableStr(t.related_repayment_id),
    relatedFarmerId: nullableStr(t.related_farmer_id),
    createdByUserId: nullableStr(t.created_by_user_id),
    confirmedByAdminId: nullableStr(t.confirmed_by_admin_id),
    confirmedAt: nullableStr(t.confirmed_at),
    createdAt: nullableStr(t.created_at),
  };
}

/** `transactionType?.toLowerCase() == 'credit'` */
export const isCredit = (t: WalletTransaction): boolean =>
  (t.transactionType ?? '').toLowerCase() === 'credit';

/**
 * Every image attached to a transaction, receipt first.
 *
 * Mirrors `_ImageGallery._all`: the receipt is prepended only when it is not
 * already one of the proof URLs.
 */
export function transactionImages(t: WalletTransaction): string[] {
  const receipt = t.receiptImageUrl;
  const hasReceipt = receipt != null && !t.proofImageUrls.includes(receipt);
  return hasReceipt ? [receipt, ...t.proofImageUrls] : [...t.proofImageUrls];
}
