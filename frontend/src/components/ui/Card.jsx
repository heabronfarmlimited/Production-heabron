import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';

function useNavigateSafe() {
  try {
    return useNavigate();
  } catch {
    return null;
  }
}

export function Card({ className, children, padded = true, ...rest }) {
  return (
    <div className={cn('card', padded && 'card-pad', className)} {...rest}>
      {children}
    </div>
  );
}

export function TierPill({ tier, className }) {
  if (!tier) return <span className={cn('pill-neutral', className)}>—</span>;
  const map = { A: 'pill-A', B: 'pill-B', C: 'pill-C', D: 'pill-D' };
  return <span className={cn(map[tier] || 'pill-neutral', className)}>Tier {tier}</span>;
}

export function StatusPill({ status, className }) {
  const map = {
    active: 'status-active',
    pending: 'status-pending',
    rejected: 'status-rejected',
    suspended: 'status-suspended',
    approved: 'status-active',
    disbursed: 'status-active',
    completed: 'status-active',
  };
  return <span className={cn(map[status] || 'pill-neutral', 'capitalize', className)}>{status}</span>;
}

export function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div className="text-center py-12 md:py-16">
      {Icon && (
        <div className="size-16 mx-auto rounded-2xl bg-forest-50 text-forest-500 flex items-center justify-center mb-4">
          <Icon className="size-8" />
        </div>
      )}
      <h3 className="font-display text-xl font-semibold text-ink">{title}</h3>
      {description && <p className="text-sm text-smoke mt-1 max-w-md mx-auto">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }) {
  return <div className={cn('skeleton', className)} />;
}

export function MetricCard({ label, value, sub, tone = 'default', icon: Icon, to, onClick }) {
  const navigate = useNavigateSafe();
  const clickable = !!(to || onClick);
  const tones = {
    default: 'bg-white',
    primary: 'bg-forest-500 text-white',
    accent: 'bg-harvest-50',
  };
  const labelTone = tone === 'primary' ? 'text-forest-50' : 'text-smoke';
  const handle = () => {
    if (onClick) return onClick();
    if (to && navigate) navigate(to);
  };
  return (
    <div
      onClick={clickable ? handle : undefined}
      className={cn(
        'card card-pad relative overflow-hidden transition-all',
        tones[tone],
        clickable && 'cursor-pointer hover:shadow-md hover:-translate-y-0.5 group'
      )}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className={cn('text-[11px] font-semibold uppercase tracking-wider', labelTone)}>{label}</p>
          <p className="font-display text-3xl md:text-4xl font-semibold tabular mt-2">{value}</p>
          {sub && <p className={cn('text-xs mt-1', labelTone)}>{sub}</p>}
        </div>
        {Icon && (
          <div className={cn(
            'size-10 rounded-xl flex items-center justify-center',
            tone === 'primary' ? 'bg-white/15 text-white' : 'bg-forest-50 text-forest-500'
          )}>
            <Icon className="size-5" />
          </div>
        )}
      </div>
      {clickable && (
        <ArrowUpRight className={cn(
          'size-4 absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity',
          tone === 'primary' ? 'text-white' : 'text-forest-500'
        )} />
      )}
    </div>
  );
}
