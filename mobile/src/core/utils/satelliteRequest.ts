/**
 * Building the satellite basemap request.
 *
 * Separated from the hook that fetches the capability flag so it imports no
 * API client: `core/api/client` resolves the base URL at module load and
 * throws when it is unset, which made this untestable while the two lived
 * together. The URL shape is also exactly where this kind of code goes wrong
 * — a missing token, an unclamped size, a pinch firing one billable request
 * per frame — so it is worth testing on its own.
 *
 * The image comes from this platform's own backend rather than from Google or
 * Mapbox directly, because a Maps Static API key cannot be restricted to a
 * mobile application (only by HTTP referrer or IP, neither of which a phone
 * can satisfy). A key shipped in the bundle would be an unrestricted key in a
 * public file. See `backend/src/services/satellite`.
 */
import { endpoints } from '../api/endpoints';
import { BASE_URL } from '../config/env';
import { authStorage } from '../storage/authStorage';

/** One vertex of a boundary — `{lat, lng}`, as the API sends it. */
export interface MapPoint {
  lat: number;
  lng: number;
}

export interface MapCapability {
  satelliteAvailable: boolean;
  provider: string | null;
  maxDimension: number;
}

/** `lat,lng;lat,lng` — shorter and more readable in a log than encoded JSON. */
function encodePolygon(polygon: readonly MapPoint[], limit = 100): string {
  if (polygon.length === 0) return '';
  // Thinned here as well as on the server: the URL is the thing with the
  // length limit, and sending 800 points for the server to throw away is
  // the agent's mobile data being spent on nothing.
  const step = polygon.length > limit ? Math.ceil(polygon.length / limit) : 1;
  const points: string[] = [];
  for (let i = 0; i < polygon.length; i += step) {
    const p = polygon[i];
    if (p) points.push(`${p.lat.toFixed(6)},${p.lng.toFixed(6)}`);
  }
  const last = polygon[polygon.length - 1];
  const lastEncoded = last ? `${last.lat.toFixed(6)},${last.lng.toFixed(6)}` : null;
  if (lastEncoded && points[points.length - 1] !== lastEncoded) points.push(lastEncoded);
  return points.join(';');
}

export interface BasemapRequest {
  center: MapPoint | null;
  polygon: readonly MapPoint[];
  width: number;
  height: number;
  /** Screen zoom, used to pick an imagery zoom level. */
  zoom?: number;
}

export interface BasemapSource {
  uri: string;
  headers: Record<string, string>;
}

/**
 * The `<Image source>` for the basemap, or null when there is nothing to show.
 *
 * Returns headers as well as a URI because the proxy sits behind the agent's
 * session — an unauthenticated image request would be the one way to spend
 * the account's map quota without logging in.
 */
export function basemapSource(
  request: BasemapRequest,
  capability: MapCapability | null,
): BasemapSource | null {
  if (!capability?.satelliteAvailable) return null;
  const { center } = request;
  if (!center || !Number.isFinite(center.lat) || !Number.isFinite(center.lng)) return null;
  if (request.width <= 0 || request.height <= 0) return null;

  const token = authStorage.getToken();
  if (!token) return null;

  const max = capability.maxDimension;
  const params = new URLSearchParams({
    lat: center.lat.toFixed(6),
    lng: center.lng.toFixed(6),
    zoom: String(imageryZoom(request.zoom ?? 1)),
    width: String(Math.min(max, Math.max(64, Math.round(request.width)))),
    height: String(Math.min(max, Math.max(64, Math.round(request.height)))),
    scale: '2',
  });

  const polygon = encodePolygon(request.polygon);
  if (polygon) params.append('polygon', polygon);

  return {
    uri: `${BASE_URL}${endpoints.mapSatellite}?${params.toString()}`,
    headers: { Authorization: `Bearer ${token}` },
  };
}

/**
 * Screen zoom -> imagery zoom level.
 *
 * Quantised to whole levels, and deliberately coarse: each distinct value is
 * a separate billable request and a separate cache entry, so a continuous
 * pinch must not fire one per frame. 17 shows a couple of hectares across a
 * phone screen, which suits a smallholder plot; 21 is as far as satellite
 * imagery goes before it blurs.
 */
export function imageryZoom(screenZoom: number): number {
  const base = 17;
  if (!Number.isFinite(screenZoom) || screenZoom <= 0) return base;
  const steps = Math.round(Math.log2(screenZoom));
  return Math.min(21, Math.max(14, base + steps));
}
