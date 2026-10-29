/**
 * The status badge colours used by `FinancingHistoryView` and
 * `FinancingDetailsView`: the foreground is `resolveStatus(status)` and the
 * fill is the same colour at 14% (10% for the partner-decision badge).
 *
 * Flutter expressed this as `Color.withValues(alpha:)`. React Native style
 * objects need a literal colour string, so the hex from `colors` is converted
 * to `rgba()` here rather than relying on an opacity on the container — which
 * would have faded the label too.
 */
import { resolveStatusColor } from '../../../core/utils/format';

/** `#RRGGBB` -> `rgba(r, g, b, alpha)`. Non-hex input is returned untouched. */
export function withAlpha(color: string, alpha: number): string {
  const hex = color.replace('#', '');
  if (hex.length !== 6) return color;

  const value = Number.parseInt(hex, 16);
  if (!Number.isFinite(value)) return color;

  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

export interface StatusTint {
  color: string;
  backgroundColor: string;
}

/** Dart: `resolveStatus(status)` + the same colour at `alpha: 0.14`. */
export function statusTint(status?: string | null, alpha = 0.14): StatusTint {
  const color = resolveStatusColor(status);
  return { color, backgroundColor: withAlpha(color, alpha) };
}
