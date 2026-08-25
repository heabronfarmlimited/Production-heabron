import { forwardRef } from 'react';
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

export function Field({ label, hint, error, children, required, className }) {
  return (
    <div className={cn('space-y-1', className)}>
      {label && (
        <label className="label">
          {label}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
      )}
      {children}
      {hint && !error && <p className="text-xs text-smoke mt-1">{hint}</p>}
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  );
}
