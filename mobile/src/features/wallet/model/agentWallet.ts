/**
 * Agent wallet — ported from
 * modules/wallet/domain/dto/agent_wallet.dart
 *
 * Read keys are snake_case (the row comes straight out of `agent_wallets`).
 * `created_at` / `updated_at` arrive as ISO strings and are kept as strings,
 * exactly as the Dart DTO did, so the formatting helpers own the parsing.
 */

export interface AgentWallet {
  id: string | null;
  agentId: string | null;
  /** Dart: `(json['balance'] as num?)?.toDouble() ?? 0.0`. */
  balance: number;
  status: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

const nullableStr = (v: unknown): string | null =>
  typeof v === 'string' && v.length > 0 ? v : null;

const num = (v: unknown, fallback: number): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/** `AgentWallet.fromJson` — tolerates a null/absent payload. */
export function parseAgentWallet(raw: unknown): AgentWallet {
  const w = (raw ?? {}) as Record<string, unknown>;
  return {
    id: nullableStr(w.id),
    agentId: nullableStr(w.agent_id),
    balance: num(w.balance, 0),
    status: nullableStr(w.status),
    createdAt: nullableStr(w.created_at),
    updatedAt: nullableStr(w.updated_at),
  };
}
