import { cn } from '@/lib/utils';

export function PageHeader({ eyebrow, title, description, actions, className }) {
  return (
    <header className={cn('mb-6 md:mb-8 flex flex-col md:flex-row md:items-end md:justify-between gap-4', className)}>
      <div>
        {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
        <h1 className="section-title">{title}</h1>
        {description && <p className="section-sub max-w-2xl">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
