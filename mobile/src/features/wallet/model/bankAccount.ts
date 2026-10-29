/**
 * Bank account — ported from
 * modules/authentication/domain/model/bank_account.dart
 *
 * camelCase in both directions, and that is what the backend does too:
 *   GET  /agent/bank-account -> `{ bankName, accountNumber, accountName }`
 *        (profile.controller.js maps the snake_case `profiles` columns itself)
 *   PUT  /agent/bank-account <- `saveBankAccount` Joi object, same three keys
 *
 * It lives in the wallet module because that is where it is consumed
 * (RequestSettlementScreen). The profile module's Bank Account Settings screen
 * can import this model rather than declaring a second copy.
 */

export interface BankAccount {
  bankName: string | null;
  accountNumber: string | null;
  accountName: string | null;
}

const nullableStr = (v: unknown): string | null =>
  typeof v === 'string' && v.length > 0 ? v : null;

export function parseBankAccount(raw: unknown): BankAccount {
  const b = (raw ?? {}) as Record<string, unknown>;
  return {
    bankName: nullableStr(b.bankName ?? b.bank_name),
    accountNumber: nullableStr(b.accountNumber ?? b.bank_account_number),
    accountName: nullableStr(b.accountName ?? b.bank_account_name),
  };
}

/**
 * `BankAccount.isPopulated` — all three fields present **and** non-empty.
 * `parseBankAccount` already collapses `''` to null, so a presence check is
 * enough here.
 */
export const isBankAccountPopulated = (b?: BankAccount | null): boolean =>
  Boolean(b?.bankName && b?.accountNumber && b?.accountName);

/** `PUT /agent/bank-account` body. */
export function toSaveBankAccountBody(input: {
  bankName: string;
  accountNumber: string;
  accountName: string;
}): Record<string, unknown> {
  return {
    bankName: input.bankName.trim(),
    accountNumber: input.accountNumber.trim(),
    accountName: input.accountName.trim(),
  };
}
