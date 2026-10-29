/**
 * Date patterns the wallet screens use that core/utils/format.ts does not
 * expose yet.
 *
 * Dart:
 *   DateFormat('dd MMM, yyyy • hh:mm a')  -> "30 Sep, 2025 • 04:05 PM"
 *   DateFormat('dd MMM, yyyy')            -> "30 Sep, 2025"
 *
 * date-fns uses the same tokens (`hh` = 01-12, `a` = AM/PM) and passes
 * non-letter characters through literally, so the patterns are copied as-is
 * and the output is byte-identical. Both fall back to the raw string when it
 * is unparseable and to the em dash when it is missing, matching
 * `fmtDateTime` / `fmtDate` in the Dart views.
 */
import { format, parseISO } from 'date-fns';

/** The Dart views rendered a missing date as an em dash, not "-". */
export const EMPTY_VALUE = '—';

function toDate(iso?: string | null): Date | null {
  if (!iso) return null;
  try {
    const d = parseISO(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

/** `DateFormat('dd MMM, yyyy • hh:mm a')` */
export function formatDateTimeDot(iso?: string | null): string {
  if (!iso) return EMPTY_VALUE;
  const d = toDate(iso);
  // Dart returned the raw string when `DateTime.tryParse` failed.
  return d ? format(d, 'dd MMM, yyyy • hh:mm a') : iso;
}

/** `DateFormat('dd MMM, yyyy')` */
export function formatDayMonthYear(iso?: string | null): string {
  if (!iso) return EMPTY_VALUE;
  const d = toDate(iso);
  return d ? format(d, 'dd MMM, yyyy') : iso;
}

/** `s.replaceAll('_', ' ').toUpperCase()` — `fmtSource` / `fmtMethod`. */
export function upperWords(value?: string | null): string {
  if (!value) return EMPTY_VALUE;
  return value.replace(/_/g, ' ').toUpperCase();
}

/**
 * `change_case`'s `toSentenceCase` as the details screen used it on
 * `description`: first letter upper, the rest left alone.
 */
export function sentenceCase(value?: string | null): string {
  if (!value) return EMPTY_VALUE;
  return value.charAt(0).toUpperCase() + value.slice(1);
}
