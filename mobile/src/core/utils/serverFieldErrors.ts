/**
 * Maps `AppError.fieldErrors` onto a react-hook-form instance, so a 422 lands
 * on the offending input instead of only in a toast.
 *
 * The Dart controllers had no equivalent: every validation failure surfaced as
 * `ToastService.showError(e.toString())`, and the agent had to guess which
 * field the server rejected. `AppException` discarded the structured
 * `error.details` array entirely.
 */
import type { FieldValues, Path, UseFormSetError } from 'react-hook-form';

import { AppError } from '../api/AppError';

/**
 * Applies any server-side field errors that match the given form fields.
 *
 * Returns true when at least one matched, so the caller can skip the fallback
 * toast and let the inline messages speak for themselves.
 */
export function applyServerFieldErrors<T extends FieldValues>(
  err: unknown,
  setError: UseFormSetError<T>,
  fields: readonly Path<T>[],
): boolean {
  const error = AppError.from(err);
  const byField = error.fieldErrors;
  let matched = false;

  fields.forEach((field) => {
    const message = byField[field as string];
    if (message) {
      setError(field, { type: 'server', message });
      matched = true;
    }
  });

  return matched;
}

/**
 * Applies every server field error, without needing the field list up front.
 * Use this when the form's keys match the API's field names exactly; prefer
 * the explicit-field version when they differ, so an unknown key cannot set an
 * error on a field that does not exist.
 */
export function applyAllServerFieldErrors<T extends FieldValues>(
  err: unknown,
  setError: UseFormSetError<T>,
): boolean {
  const error = AppError.from(err);
  const entries = Object.entries(error.fieldErrors);

  entries.forEach(([field, message]) => {
    setError(field as Path<T>, { type: 'server', message });
  });

  return entries.length > 0;
}
