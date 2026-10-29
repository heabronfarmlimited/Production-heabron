/**
 * Formatting + status helpers — ported from lib/src/core/utils/helper.dart
 *
 * `intl`'s DateFormat is replaced by `date-fns`. The format tokens below are
 * chosen to produce byte-identical output to the Dart patterns:
 *   DateFormat.yMMMEd('en_US')        -> "Tue, Sep 30, 2025"
 *   DateFormat.jm('en_US')            -> "4:05 PM"
 *   DateFormat('dd MMM, yyyy')        -> "30 Sep, 2025"
 */
import { format, parseISO } from 'date-fns';

import { colors } from '../theme/colors';

/** `DateFormat.yMMMEd` + `.add_jm()` — date and time, local timezone. */
export function formatDateAndTime(iso?: string | null): string {
  const d = toDate(iso);
  return d ? format(d, "EEE, MMM d, yyyy h:mm a") : '-';
}

/** `DateFormat.yMMMEd` — date only, local timezone. */
export function formatDate(iso?: string | null): string {
  const d = toDate(iso);
  return d ? format(d, 'EEE, MMM d, yyyy') : '-';
}

/** `DateFormat.jm` — time only, local timezone. */
export function formatTime(iso?: string | null): string {
  const d = toDate(iso);
  return d ? format(d, 'h:mm a') : '-';
}

/**
 * `formatRelativeTime` — "Just now" / "N minutes ago" / "N hours ago" /
 * "N days ago", falling back to "dd MMM, yyyy" past a week.
 * Singular/plural handling matches the Dart original.
 */
export function formatRelativeTime(iso?: string | null): string {
  const d = toDate(iso);
  if (!d) return '-';

  const diffMs = Date.now() - d.getTime();
  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return 'Just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`;
  return format(d, 'dd MMM, yyyy');
}

function toDate(iso?: string | null): Date | null {
  if (!iso) return null;
  try {
    const d = parseISO(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

/**
 * `maskEmail` — "jo****hn@example.com".
 * Usernames of 2 characters or fewer keep only the first letter.
 */
export function maskEmail(email: string): string {
  if (!email || !email.includes('@')) return email;

  const [username = '', domain = ''] = email.split('@');
  if (username.length <= 2) return `${username[0] ?? ''}****@${domain}`;

  return `${username[0]}****${username.slice(-2)}@${domain}`;
}

/**
 * Formats an amount as Naira.
 *
 * The Dart app relied on a `.withNaira` TextStyle to switch fonts so the ₦
 * glyph would render. Here the symbol is part of the string and the style
 * helper (`withNaira` in typography.ts) handles the font.
 */
export function formatNaira(
  amount?: number | string | null,
  options: { decimals?: boolean } = {},
): string {
  const n = typeof amount === 'string' ? Number(amount) : amount;
  if (n == null || !Number.isFinite(n)) return '₦0.00';

  return `₦${n.toLocaleString('en-NG', {
    minimumFractionDigits: options.decimals === false ? 0 : 2,
    maximumFractionDigits: options.decimals === false ? 0 : 2,
  })}`;
}

// ------------------------------------------------------------ status colours
/** `resolveStatus` — approved/rejected/pending badge colour. */
export function resolveStatusColor(status?: string | null): string {
  switch ((status ?? '').toLowerCase()) {
    case 'approved':
      return colors.success;
    case 'rejected':
    case 'denied':
      return colors.failure;
    case 'pending':
      return colors.orange700;
    default:
      return colors.failure;
  }
}

/** `resolveCoopTier` — tier A/B/other colour. */
export function resolveCoopTierColor(tier?: string | null): string {
  switch ((tier ?? '').toLowerCase()) {
    case 'a':
      return colors.success;
    case 'b':
      return colors.orange;
    default:
      return colors.red;
  }
}

/**
 * `resolveCoopScoreColor` — colour for a 0-100 credit score.
 *
 * NOTE — the Dart original special-cases `value == 5` to green before the
 * range checks, which looks like a leftover test condition: a score of 5
 * renders as "good" while 19 renders red. That quirk is preserved here so
 * scores render identically; delete the first branch once confirmed with the
 * product owner.
 */
export function resolveCoopScoreColor(value: number): string {
  if (value === 5) return colors.success;
  if (value >= 80 && value <= 100) return colors.green;
  if (value >= 60 && value < 80) return colors.orange;
  if (value >= 40 && value < 60) return colors.yellow;
  if (value >= 0 && value < 40) return colors.red;
  return colors.grey;
}

// ----------------------------------------------------------------- misc
/** `isObjectEmpty` */
export function isEmpty(value: unknown): boolean {
  if (value == null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

/** Capitalises the first letter — used for status labels. */
export const capitalize = (s?: string | null): string =>
  s ? s.charAt(0).toUpperCase() + s.slice(1) : '';

/** Converts `snake_case` / `kebab-case` status values to "Title Case". */
export const titleCase = (s?: string | null): string =>
  (s ?? '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map(capitalize)
    .join(' ');
