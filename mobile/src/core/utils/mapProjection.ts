/**
 * Projecting a farm boundary onto a screen.
 *
 * The v2 flow asks for a full-screen map with a marker and a polygon. This
 * module is the geometry half: it turns a ring of `{lat, lng}` points into
 * screen coordinates, and reports the area and perimeter so the view can
 * state them.
 *
 * The projection is the same local-plane approximation the server's
 * `utils/geo.js` uses for area — project to metres around the ring's own
 * centre, then scale to fit the viewport. For a few acres that is accurate to
 * a fraction of a percent, and using the SAME method as the server means the
 * acreage shown beside the shape cannot disagree with the acreage stored
 * against the farm.
 *
 * Deliberately free of any mapping SDK: the figures here are the farm's own
 * geometry, not a basemap, and nothing about them needs a tile provider or an
 * API key.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface ProjectedPolygon {
  /** Screen points, in the input order. */
  points: Point[];
  /** The ring's centre, projected. */
  center: Point;
  /** Metres per screen pixel — for a scale bar. */
  metersPerPixel: number;
  areaSqMeters: number;
  areaAcres: number;
  areaHectares: number;
  perimeterMeters: number;
}

const EARTH_RADIUS_M = 6378137; // WGS-84 equatorial radius, as on the server
const SQM_PER_ACRE = 4046.8564224;
const SQM_PER_HECTARE = 10000;

const toRad = (deg: number): number => (deg * Math.PI) / 180;

/** Keeps only usable coordinates, in order. */
export function normalizeRing(input: readonly (LatLng | null | undefined)[]): LatLng[] {
  const ring: LatLng[] = [];
  for (const p of input) {
    const lat = Number(p?.lat);
    const lng = Number(p?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
    ring.push({ lat, lng });
  }
  return ring;
}

/** The ring's average position. */
export function ringCenter(ring: readonly LatLng[]): LatLng | null {
  if (ring.length === 0) return null;
  const lat = ring.reduce((sum, p) => sum + p.lat, 0) / ring.length;
  const lng = ring.reduce((sum, p) => sum + p.lng, 0) / ring.length;
  return { lat, lng };
}

/**
 * Local metres from a reference point.
 *
 * `x` is east, `y` is NORTH — so a caller drawing to a screen must flip `y`,
 * because screen y grows downward. Keeping the maths in true orientation and
 * flipping once at the end is far less error-prone than carrying an inverted
 * axis through the area and perimeter calculations.
 */
export function toLocalMeters(point: LatLng, origin: LatLng): Point {
  const latRad = toRad(origin.lat);
  return {
    x: toRad(point.lng - origin.lng) * EARTH_RADIUS_M * Math.cos(latRad),
    y: toRad(point.lat - origin.lat) * EARTH_RADIUS_M,
  };
}

/** Shoelace area of a ring already in metres. */
function shoelaceSqMeters(ring: readonly Point[]): number {
  if (ring.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i] as Point;
    const b = ring[(i + 1) % ring.length] as Point;
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/** Closed perimeter of a ring already in metres. */
function perimeterMeters(ring: readonly Point[]): number {
  if (ring.length < 2) return 0;
  let total = 0;
  // A 2-point ring is a line walked out and back, which is what a partially
  // captured boundary looks like; closing it double-counts the single edge,
  // so the closing segment is skipped until there are three points.
  const last = ring.length < 3 ? ring.length - 1 : ring.length;
  for (let i = 0; i < last; i += 1) {
    const a = ring[i] as Point;
    const b = ring[(i + 1) % ring.length] as Point;
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}

/**
 * Fit a ring into a viewport.
 *
 * `padding` keeps the shape off the edges so vertex handles and labels are not
 * clipped. A single point, or several points at the same place — which is what
 * a boundary looks like after one tap, or when the GPS has not moved — has no
 * extent to scale, so `fallbackSpanMeters` sets how much ground the view
 * covers in that case. Without it the scale would be a division by zero and
 * the marker would land at an undefined position.
 */
export function projectRing(
  input: readonly (LatLng | null | undefined)[],
  options: {
    width: number;
    height: number;
    padding?: number;
    fallbackSpanMeters?: number;
  },
): ProjectedPolygon | null {
  const ring = normalizeRing(input);
  const origin = ringCenter(ring);
  if (!origin) return null;

  const { width, height } = options;
  const padding = options.padding ?? 24;
  const fallbackSpan = options.fallbackSpanMeters ?? 120;

  const usableWidth = Math.max(1, width - padding * 2);
  const usableHeight = Math.max(1, height - padding * 2);

  const metric = ring.map((p) => toLocalMeters(p, origin));

  const xs = metric.map((p) => p.x);
  const ys = metric.map((p) => p.y);
  const spanX = Math.max(...xs) - Math.min(...xs);
  const spanY = Math.max(...ys) - Math.min(...ys);

  // One scale for both axes, so the shape keeps its real proportions — a
  // separate x and y scale would stretch a long thin plot into a square and
  // make a walked boundary look nothing like the ground.
  const scale = Math.min(
    usableWidth / Math.max(spanX, fallbackSpan),
    usableHeight / Math.max(spanY, fallbackSpan),
  );

  const centerX = width / 2;
  const centerY = height / 2;

  return {
    // `y` is negated here: the maths above is north-up, the screen is not.
    points: metric.map((p) => ({
      x: centerX + p.x * scale,
      y: centerY - p.y * scale,
    })),
    center: { x: centerX, y: centerY },
    metersPerPixel: 1 / scale,
    areaSqMeters: shoelaceSqMeters(metric),
    areaAcres: shoelaceSqMeters(metric) / SQM_PER_ACRE,
    areaHectares: shoelaceSqMeters(metric) / SQM_PER_HECTARE,
    perimeterMeters: perimeterMeters(metric),
  };
}

/**
 * A round number of metres for a scale bar, and its width in pixels.
 *
 * Picks from a 1 / 2 / 5 sequence so the bar reads "50 m" rather than
 * "63.7 m" — a scale bar nobody can read at a glance is decoration.
 */
export function scaleBar(
  metersPerPixel: number,
  maxPixels: number,
): { meters: number; pixels: number } | null {
  if (!Number.isFinite(metersPerPixel) || metersPerPixel <= 0) return null;
  if (!Number.isFinite(maxPixels) || maxPixels <= 0) return null;

  const maxMeters = metersPerPixel * maxPixels;
  if (maxMeters <= 0) return null;

  const magnitude = 10 ** Math.floor(Math.log10(maxMeters));
  const candidates = [1, 2, 5, 10].map((m) => m * magnitude);
  // The largest round value that still fits.
  const meters = [...candidates].reverse().find((m) => m <= maxMeters);
  if (!meters) return null;

  return { meters, pixels: meters / metersPerPixel };
}

/** `6.851234, 8.391234` — fixed precision, so the text does not jitter. */
export function formatCoordinate(point: LatLng | null | undefined): string {
  if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) {
    return '—';
  }
  return `${point.lat.toFixed(6)}, ${point.lng.toFixed(6)}`;
}

/** Metres below a kilometre, kilometres above it. */
export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters <= 0) return '—';
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(2)} km`;
}
