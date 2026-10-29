/**
 * Debounced value.
 *
 * FIXED — both searchable Flutter screens filtered on every keystroke:
 * `onChanged: (value) => setState(() => _search = value)`, which re-ran the
 * filter and rebuilt the whole list for each character. Typing a six-letter
 * farmer name re-filtered six times over every loaded page.
 *
 * NOTE — this is a generic hook and belongs in `core/hooks/`; it lives here
 * only because core is owned elsewhere. See the build report.
 */
import { useEffect, useState } from 'react';

/** The delay the activities and activity-log searches use. */
export const SEARCH_DEBOUNCE_MS = 350;

export function useDebouncedValue<T>(value: T, delay = SEARCH_DEBOUNCE_MS): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
