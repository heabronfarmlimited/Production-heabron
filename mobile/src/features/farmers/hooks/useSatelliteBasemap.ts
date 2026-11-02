/**
 * The satellite basemap behind the farm map.
 *
 * The image comes from this platform's own backend, not from Google or Mapbox
 * directly, and that is deliberate: a Maps Static API key cannot be
 * restricted to a mobile application (Google supports only HTTP-referrer and
 * IP restrictions, neither of which a phone can satisfy), so a key shipped in
 * the bundle would be an unrestricted key sitting in a public file. The
 * backend holds the key and returns the picture; see
 * `backend/src/services/satellite`.
 *
 * Imagery is OPTIONAL. When no key is configured the farm map still shows the
 * boundary, the marker and the measurements from the recorded GPS points —
 * which is a complete view, not a degraded one. So this hook asks the server
 * once whether imagery exists and then stops bothering it.
 */
import { useQuery } from '@tanstack/react-query';

import { api } from '../../../core/api/client';
import { endpoints } from '../../../core/api/endpoints';
import type { MapCapability } from '../../../core/utils/satelliteRequest';

export { basemapSource, imageryZoom } from '../../../core/utils/satelliteRequest';
export type {
  BasemapRequest,
  BasemapSource,
  MapCapability,
} from '../../../core/utils/satelliteRequest';

/**
 * Provider pixel ceilings. Asking for more than the provider allows is a 400,
 * and a phone screen is taller than Google's 640 limit.
 */
const DEFAULT_MAX_DIMENSION = 640;

function parseMapCapability(raw: unknown): MapCapability {
  const r = (raw ?? {}) as Record<string, unknown>;
  const max = Number(r.max_dimension ?? r.maxDimension);
  return {
    satelliteAvailable: r.satellite_available === true || r.satelliteAvailable === true,
    provider: typeof r.provider === 'string' ? r.provider : null,
    maxDimension: Number.isFinite(max) && max > 0 ? max : DEFAULT_MAX_DIMENSION,
  };
}

/**
 * Whether this deployment can serve imagery.
 *
 * Cached for the session: the answer is a server configuration, not data, and
 * an `<Image>` that fails tells us nothing — it reports no status, so without
 * asking first the app could not tell "no key configured" from "the agent
 * just walked into a dead spot".
 */
export function useMapCapability() {
  const query = useQuery<MapCapability>({
    queryKey: ['map', 'capability'],
    queryFn: async () => parseMapCapability(await api.get<unknown>(endpoints.mapConfig)),
    staleTime: Infinity,
    gcTime: Infinity,
    // One attempt. A retry loop against an endpoint that answers "not
    // configured" wastes an agent's data for no possible gain.
    retry: false,
  });

  return {
    capability: query.data ?? null,
    // Treated as unavailable until the server says otherwise, so the map
    // never flashes an empty basemap frame on the way to the real answer.
    satelliteAvailable: query.data?.satelliteAvailable === true,
    isLoading: query.isLoading,
  };
}

