/**
 * Wallet API — ported from
 * modules/wallet/data/repository/wallet_remote_repository_impl.dart, plus the
 * two bank-account calls that lived in `AuthRemoteRepositoryImpl`.
 *
 * List endpoints are **not** wrapped here: `usePaginatedList` owns paging and
 * calls `api.getPaginated` itself, so the hooks pass it a url + parser. The
 * one-shot calls below return domain models.
 */
import { api } from '../../../core/api/client';
import { endpoints } from '../../../core/api/endpoints';
import type { AgentWallet} from '../model/agentWallet';
import { parseAgentWallet } from '../model/agentWallet';
import type {
  BankAccount} from '../model/bankAccount';
import {
  parseBankAccount,
  toSaveBankAccountBody,
} from '../model/bankAccount';
import type {
  SettlementRequest,
  SettlementRequestInput} from '../model/settlementRequest';
import {
  parseSettlementRequest,
  toCreateSettlementBody,
} from '../model/settlementRequest';
import type { WalletTransaction } from '../model/walletTransaction';
import { parseWalletTransaction } from '../model/walletTransaction';

/**
 * `GET /agent/wallet`
 *
 * The Dart repository unwrapped `data['data'] ?? data` by hand because
 * `ApiService.get` returned the whole envelope. `api.get` already unwraps it,
 * so a single parse is enough.
 */
export async function getWallet(): Promise<AgentWallet> {
  return parseAgentWallet(await api.get<unknown>(endpoints.wallet));
}

/** `GET /agent/wallet/transactions/:id` */
export async function getTransaction(id: string): Promise<WalletTransaction> {
  return parseWalletTransaction(
    await api.get<unknown>(endpoints.walletTransactionById(id)),
  );
}

/** `POST /agent/wallet/settlements` — returns the created row. */
export async function requestSettlement(
  input: SettlementRequestInput,
): Promise<SettlementRequest> {
  return parseSettlementRequest(
    await api.post<unknown>(endpoints.walletSettlements, toCreateSettlementBody(input)),
  );
}

/** `GET /agent/bank-account` */
export async function getBankAccount(): Promise<BankAccount> {
  return parseBankAccount(await api.get<unknown>(endpoints.bankAccount));
}

/** `PUT /agent/bank-account` */
export async function saveBankAccount(input: {
  bankName: string;
  accountNumber: string;
  accountName: string;
}): Promise<BankAccount> {
  return parseBankAccount(
    await api.put<unknown>(endpoints.bankAccount, toSaveBankAccountBody(input)),
  );
}

/**
 * List endpoint descriptors — the url + row parser each paginated hook needs.
 * Keeping them here means the endpoint path is still declared in one place.
 */
export const walletLists = {
  /** `GET /agent/wallet/transactions` */
  transactions: {
    url: endpoints.walletTransactions,
    parse: parseWalletTransaction,
  },
  /** `GET /agent/wallet/settlements` */
  settlements: {
    url: endpoints.walletSettlements,
    parse: parseSettlementRequest,
  },
} as const;
