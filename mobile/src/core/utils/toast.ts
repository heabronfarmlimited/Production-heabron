/**
 * Toasts — replaces lib/src/services/toast_service.dart (toastification).
 *
 * The Dart app reported every failure as a toast and nothing else, so this is
 * the main error surface. `showApiError` accepts an unknown thrown value and
 * extracts the server's message, which is what `ToastService.showError(e.toString())`
 * did via `AppException.toString()`.
 */
import Toast from 'react-native-toast-message';

import { AppError } from '../api/AppError';

export function showSuccess(message: string, title = 'Success'): void {
  Toast.show({ type: 'success', text1: title, text2: message });
}

export function showError(message: string, title = 'Error'): void {
  Toast.show({ type: 'error', text1: title, text2: message });
}

export function showInfo(message: string, title = 'Heads up'): void {
  Toast.show({ type: 'info', text1: title, text2: message });
}

/**
 * Surfaces a thrown error. Field-level validation details are summarised so a
 * 422 says which field failed instead of just "Validation failed".
 *
 * Takes exactly one parameter so it can be passed straight to TanStack Query's
 * `onError`, which calls back with `(error, variables, context)` — a second
 * positional parameter here would be type-incompatible with that signature.
 * Use `apiErrorHandler(fallback)` when a custom fallback message is needed.
 */
export function showApiError(err: unknown, fallback?: unknown): void {
  const error = AppError.from(err);

  if (error.details.length > 0) {
    const first = error.details[0];
    const extra = error.details.length > 1 ? ` (+${error.details.length - 1} more)` : '';
    showError(`${first?.field ? `${first.field}: ` : ''}${first?.message}${extra}`);
    return;
  }

  // The second parameter is typed `unknown` so this stays assignable to
  // TanStack Query's `onError(error, variables, context)`; only a string is
  // treated as a fallback message.
  const fallbackMessage = typeof fallback === 'string' ? fallback : DEFAULT_ERROR;
  showError(error.message || fallbackMessage);
}

const DEFAULT_ERROR = 'Something went wrong.';

/** Builds an `onError` handler with a custom fallback message. */
export const apiErrorHandler =
  (fallback: string) =>
  (err: unknown): void => {
    const error = AppError.from(err);
    if (error.details.length === 0 && !error.message) {
      showError(fallback);
      return;
    }
    showApiError(err);
  };

export const toast = {
  showSuccess,
  showError,
  showInfo,
  showApiError,
  apiErrorHandler,
} as const;
