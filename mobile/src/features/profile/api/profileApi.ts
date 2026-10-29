/**
 * Profile + bank-account API — ported from
 * modules/profile/presentation/controller/{edit_profile,bank_account}_controller.dart
 * and the auth repository's profile methods.
 */
import { api } from '../../../core/api/client';
import { endpoints } from '../../../core/api/endpoints';
import { parseUser, type User } from '../../auth/model/user';

export interface BankAccount {
  bankName?: string | null;
  accountNumber?: string | null;
  accountName?: string | null;
}

const nullableStr = (v: unknown): string | null =>
  typeof v === 'string' ? v : null;

/** `BankAccount.fromJson` — camelCase both ways. */
export function parseBankAccount(raw: unknown): BankAccount | null {
  if (!raw || typeof raw !== 'object') return null;
  const b = raw as Record<string, unknown>;
  return {
    bankName: nullableStr(b.bankName ?? b.bank_name),
    accountNumber: nullableStr(b.accountNumber ?? b.account_number),
    accountName: nullableStr(b.accountName ?? b.account_name),
  };
}

/** `BankAccount.isPopulated` — all three present AND non-empty. */
export const isBankAccountPopulated = (a?: BankAccount | null): boolean =>
  Boolean(a?.bankName?.trim() && a?.accountNumber?.trim() && a?.accountName?.trim());

/**
 * `PATCH /agent/profile`
 *
 * Validator `updateProfile`: every field optional, `fullName` 2–120,
 * `phone` matching `/^\+?[0-9]{7,15}$/`, `state`, `lga`, `avatarUrl` a URI.
 * Only changed fields are sent, so an untouched avatar is never cleared.
 */
export async function updateProfile(input: {
  fullName?: string;
  phone?: string;
  state?: string;
  lga?: string;
  avatarUrl?: string;
}): Promise<User | null> {
  const body: Record<string, unknown> = {};
  if (input.fullName?.trim()) body.fullName = input.fullName.trim();
  if (input.phone?.trim()) body.phone = input.phone.trim();
  if (input.state?.trim()) body.state = input.state.trim();
  if (input.lga?.trim()) body.lga = input.lga.trim();
  if (input.avatarUrl?.trim()) body.avatarUrl = input.avatarUrl.trim();

  const data = await api.patch<Record<string, unknown>>(endpoints.editProfile, body);
  return data?.user ? parseUser(data.user) : null;
}

/** `GET /agent/bank-account` */
export async function getBankAccount(): Promise<BankAccount | null> {
  const data = await api.get<unknown>(endpoints.bankAccount);
  return parseBankAccount(data);
}

/**
 * `PUT /agent/bank-account`
 *
 * Validator `saveBankAccount`: `bankName` 2–120 required,
 * `accountNumber` exactly 10 digits required, `accountName` 2–120 required.
 */
export async function saveBankAccount(input: {
  bankName: string;
  accountNumber: string;
  accountName: string;
}): Promise<BankAccount | null> {
  const data = await api.put<unknown>(endpoints.bankAccount, {
    bankName: input.bankName.trim(),
    accountNumber: input.accountNumber.trim(),
    accountName: input.accountName.trim(),
  });
  return parseBankAccount(data);
}

/**
 * `DELETE /agent/profile` — permanent account deletion.
 *
 * NOTE — in Flutter this endpoint had no working UI: the delete sheet
 * collected a name, validated nothing, and its confirm button only popped,
 * leaving `// TODO(heabron): wire delete account action`. It is wired here.
 */
export async function deleteAccount(): Promise<void> {
  await api.delete(endpoints.deleteAccount);
}

/** `GET /agent/profile/export` — the agent's own data export. */
export async function exportMyData(): Promise<unknown> {
  return api.get<unknown>(endpoints.exportMyData);
}
