/**
 * Debounces a value before it reaches a query key.
 *
 * FIXED — the Flutter search fields fired a request per keystroke
 * (`FarmersView`), or had no handler at all (`CooperativesView`'s
 * `AppTextField` was `const` with no controller and no `onChanged`, so typing
 * in it did nothing). The search box works here, and one request lands per
 * pause rather than per character — which matters on the connections field
 * agents actually have.
 *
 * NOTE — generic, not cooperative-specific. Kept local because `src/core` is
 * owned elsewhere; it belongs in `core/hooks` once a second module needs it.
 */
import { useEffect, useState } from 'react';

export function useDebouncedValue<T>(value: T, delayMs = 350): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
