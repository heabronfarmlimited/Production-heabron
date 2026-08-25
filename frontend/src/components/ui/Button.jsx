import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';

const VARIANTS = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  ghost: 'btn-ghost',
  danger: 'btn-danger',
  accent: 'btn-accent',
};

export function Button({ variant = 'primary', loading, children, className, disabled, ...rest }) {
  return (
    <button className={cn(VARIANTS[variant], className)} disabled={disabled || loading} {...rest}>
      {loading && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  );
}
