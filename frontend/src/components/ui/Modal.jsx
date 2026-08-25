import { useEffect } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Modal({ open, onClose, title, description, children, size = 'md', footer }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;
  const sizes = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fade-in">
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-sm" onClick={onClose} />
      <div className={cn('relative w-full bg-white rounded-2xl shadow-elev animate-slide-up flex flex-col max-h-[92vh]', sizes[size])}>
        <div className="px-6 md:px-7 pt-6 pb-4 flex items-start gap-4">
          <div className="flex-1 min-w-0">
            <h2 className="font-display text-xl md:text-2xl font-semibold text-ink">{title}</h2>
            {description && <p className="text-sm text-smoke mt-1">{description}</p>}
          </div>
          <button onClick={onClose} className="size-9 rounded-lg flex items-center justify-center text-smoke hover:bg-bone hover:text-ink transition">
            <X className="size-5" />
          </button>
        </div>
        <div className="px-6 md:px-7 pb-6 overflow-y-auto">{children}</div>
        {footer && <div className="border-t border-whisper/70 px-6 md:px-7 py-4 flex items-center justify-end gap-3">{footer}</div>}
      </div>
    </div>
  );
}
