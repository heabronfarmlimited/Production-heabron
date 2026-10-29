/**
 * `Color.withValues(alpha:)` for the hex tokens in core/theme/colors.ts.
 *
 * NOTE — this belongs in `core/theme/colors.ts` as `withAlpha`; it is declared
 * per-module only because core is owned elsewhere. See the build report.
 */

/** Returns `rgba(r, g, b, alpha)` for a `#RRGGBB` token. */
export function withAlpha(hexColor: string, alpha: number): string {
  const hex = hexColor.replace('#', '');
  if (hex.length !== 6) return hexColor;

  const int = Number.parseInt(hex, 16);
  if (!Number.isFinite(int)) return hexColor;

  const red = (int >> 16) & 255;
  const green = (int >> 8) & 255;
  const blue = int & 255;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}
