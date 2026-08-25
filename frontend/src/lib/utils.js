import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

export function formatNaira(n, { dash = false } = {}) {
  const num = Number(n);
  if (n === null || n === undefined || n === '' || Number.isNaN(num) || !Number.isFinite(num)) {
    return dash ? '—' : '₦0';
  }
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    maximumFractionDigits: 0,
  }).format(num);
}

export function formatNumber(n) {
  const num = Number(n);
  if (n === null || n === undefined || n === '' || Number.isNaN(num) || !Number.isFinite(num)) return '0';
  return new Intl.NumberFormat('en-NG').format(num);
}

export function formatDate(iso, opts) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric', ...opts });
}

export function formatDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-NG', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function initials(name) {
  if (!name) return '?';
  return name.split(/\s+/).slice(0, 2).map((s) => s[0]?.toUpperCase()).join('');
}

export function relativeTime(iso) {
  if (!iso) return '';
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(iso);
}
