import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

const VARIANTS = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  ghost: 'btn-ghost',
  danger: 'btn-danger',
  accent: 'btn-accent',
};

export function Button({ variant = 'primary', loading, children, className, disabled, type = 'button', ...rest }) {
  // FIXED — the default HTML button type is "submit", so every Button placed
  // inside a <form> (including modal footers) submitted that form on click.
  // Default to "button"; callers pass type="submit" explicitly.
  return (
    <button
      type={type}
      className={cn(VARIANTS[variant], className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  );
}
