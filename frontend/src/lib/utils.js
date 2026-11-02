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

/**
 * FIXED — credit scores arrive from Postgres NUMERIC columns, which can be
 * null (unscored) or a string. `Number(x).toFixed(1)` printed a literal "NaN"
 * on every unscored row, and `x.toFixed(1)` threw on the string form.
 * Returns an em-dash for anything that isn't a finite number.
 */
export function formatScore(n, digits = 1) {
  const num = Number(n);
  if (n === null || n === undefined || n === '' || !Number.isFinite(num)) return '—';
  return num.toFixed(digits);
}

/**
 * Sum money fields without float drift. Naira amounts are NUMERIC(_,2), so we
 * accumulate in integer kobo and divide once at the end rather than adding
 * floats (which yields values like 150000.00000000003).
 */
export function sumAmounts(rows, pick) {
  const kobo = (rows || []).reduce((acc, row) => {
    const value = typeof pick === 'function' ? pick(row) : row?.[pick];
    const num = Number(value);
    return acc + (Number.isFinite(num) ? Math.round(num * 100) : 0);
  }, 0);
  return kobo / 100;
}

/** 'all_year' -> 'All year'. Used for seasons, statuses and other snake enums. */
export function humanize(s) {
  if (s === null || s === undefined || s === '') return '';
  return String(s)
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());
}

// FIXED — dates were rendered with the host locale ('en-NG' falls back to the
// browser default), so the same row could read "3/8/2026" for one user and
// "8/3/2026" for another. A fixed day–month-name–year order is unambiguous.
const DATE_FMT = { day: '2-digit', month: 'short', year: 'numeric' };

export function formatDate(iso, opts) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-GB', { ...DATE_FMT, ...opts });
}

export function formatDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', { ...DATE_FMT, hour: '2-digit', minute: '2-digit', hour12: false });
}

export function initials(name) {
  // FIXED — was `name.split(...)`, which threw on a non-string (the API returns
  // null full_name for a profile that hasn't completed onboarding).
  if (!name || typeof name !== 'string') return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  if (parts.length === 0) return '?';
  return parts.map((s) => s[0].toUpperCase()).join('');
}

export function relativeTime(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diffMs = Date.now() - t;
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(iso);
}

// ---------------------------------------------------------------- farm sets
/**
 * A farmer's farms, in display order.
 *
 * A farmer may hold several plots (v2 "Add Another Farm"), so the embedded
 * `farm_profiles` is a SET, not a single row. Every dashboard page took
 * `farm_profiles[0]` — an arbitrary row, since PostgREST promises no order on
 * an embedded select, so two page loads could show different acreage for the
 * same farmer. The API now sends `farms` already ordered and labelled; this
 * falls back to ordering `farm_profiles` the same way (primary first, then
 * oldest) for a response that predates it.
 */
export function farmList(farmer) {
  if (!farmer) return [];
  if (Array.isArray(farmer.farms) && farmer.farms.length > 0) return farmer.farms;
  const raw = farmer.farm_profiles;
  const list = Array.isArray(raw) ? [...raw] : raw ? [raw] : [];
  return list.filter(Boolean).sort((a, b) => {
    if (!!a.is_primary !== !!b.is_primary) return a.is_primary ? -1 : 1;
    return (a.created_at || '') < (b.created_at || '') ? -1 : 1;
  });
}

/**
 * The farm shown wherever one farm is shown: the primary.
 *
 * The API's own `farm` object is preferred — it is the server's pick, so the
 * app, the dashboards and the lender's report all name the same farm.
 */
export function primaryFarm(farmer) {
  if (!farmer) return null;
  return farmer.farm ?? farmList(farmer)[0] ?? null;
}

/**
 * The farmer's land in acres, summed across every farm.
 *
 * This is the figure the production score divides by, so a page showing one
 * plot's acreage was contradicting the score beside it. Returns null — not 0
 * — when there is no farm at all: "no farm recorded" and "a farm of no size"
 * are different things and read differently on screen.
 */
export function farmerLandAcres(farmer) {
  if (farmer?.land && Number.isFinite(Number(farmer.land.total_land_acres))) {
    return Number(farmer.land.total_land_acres);
  }
  const farms = farmList(farmer);
  if (farms.length === 0) return null;
  const total = farms.reduce((sum, f) => {
    // The entered size wins over the walked area: an agent can correct the
    // figure after mapping a boundary that took in a path.
    const entered = Number(f.acres ?? f.farm_size_acres);
    if (Number.isFinite(entered) && entered > 0) return sum + entered;
    const computed = Number(f.computed_area_acres);
    return Number.isFinite(computed) && computed > 0 ? sum + computed : sum;
  }, 0);
  return Math.round((total + Number.EPSILON) * 100) / 100;
}

/** Every crop across every farm, the primary farm's crop first. */
export function farmerCrops(farmer) {
  if (Array.isArray(farmer?.land?.crops) && farmer.land.crops.length > 0) {
    return farmer.land.crops;
  }
  const crops = [];
  for (const farm of farmList(farmer)) {
    if (farm.crop_type) crops.push(farm.crop_type);
    for (const crop of farm.secondary_crops || []) crops.push(crop);
  }
  return [...new Set(crops)];
}

/** `"Cassava plot"`, or `"Farm 2"` by position when unnamed. */
export function farmLabel(farm, index) {
  const explicit = (farm?.label || farm?.farm_label || '').trim();
  return explicit || `Farm ${index + 1}`;
}
