import { Children, cloneElement, forwardRef, isValidElement, useId } from 'react';
import { cn } from '@/lib/utils';

export const Input = forwardRef(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cn('input', className)} {...rest} />;
});

export const Textarea = forwardRef(function Textarea({ className, rows = 4, ...rest }, ref) {
  return <textarea ref={ref} rows={rows} className={cn('input resize-y', className)} {...rest} />;
});

export const Select = forwardRef(function Select({ className, children, ...rest }, ref) {
  return (
    <select ref={ref} className={cn('input pr-9 appearance-none bg-no-repeat', className)} {...rest} style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='%236B7370'%3E%3Cpath fill-rule='evenodd' d='M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 011.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z' clip-rule='evenodd'/%3E%3C/svg%3E")`, backgroundPosition: 'right 0.65rem center', backgroundSize: '1.1rem' }}>
      {children}
    </select>
  );
});

/**
 * FIXED — `<label>` was rendered with no `htmlFor`, so none of the ~90 inputs
 * across the dashboards had an accessible name and clicking a label did
 * nothing. The field now mints an id and wires label/hint/error to the control
 * it wraps (when that control is a single element that doesn't set its own id).
 */
export function Field({ label, hint, error, children, required, className }) {
  const autoId = useId();
  const hintId = `${autoId}-hint`;
  const errorId = `${autoId}-error`;

  let control = children;
  const candidate = Children.count(children) === 1 ? Children.only(children) : null;
  // Only wire up our own form primitives — cloning an arbitrary wrapper <div>
  // would point htmlFor at a non-labelable element.
  const only =
    candidate && isValidElement(candidate) && [Input, Textarea, Select].includes(candidate.type)
      ? candidate
      : null;
  if (only) {
    const described = [hint && !error ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');
    control = cloneElement(only, {
      id: only.props.id || autoId,
      'aria-describedby': only.props['aria-describedby'] || described || undefined,
      'aria-invalid': error ? true : only.props['aria-invalid'],
      'aria-required': required || only.props['aria-required'] || undefined,
    });
  }

  return (
    <div className={cn('space-y-1', className)}>
      {label && (
        <label htmlFor={only ? autoId : undefined} className="label">
          {label}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
      )}
      {control}
      {hint && !error && <p id={hintId} className="text-xs text-smoke mt-1">{hint}</p>}
      {error && <p id={errorId} className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  );
}
