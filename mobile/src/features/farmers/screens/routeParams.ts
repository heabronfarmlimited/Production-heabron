/**
 * Route-parameter reader.
 *
 * The `src/app` route files export these screens as the default component, so
 * expo-router renders them without props — the ids arrive as route params. Each
 * screen therefore reads `useRouteParams()` and treats its own props as an
 * optional override, which keeps it directly testable and usable as a child
 * component.
 *
 * `useLocalSearchParams` hands back `string | string[] | undefined` per key
 * (a repeated query key yields an array); only the first string is useful here.
 */
import { useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';

export function useRouteParams(): Record<string, string | undefined> {
  const raw = useLocalSearchParams();

  return useMemo(() => {
    const out: Record<string, string | undefined> = {};
    Object.entries(raw).forEach(([key, value]) => {
      const first = Array.isArray(value) ? value[0] : value;
      if (typeof first === 'string' && first.length > 0) out[key] = first;
    });
    return out;
  }, [raw]);
}
