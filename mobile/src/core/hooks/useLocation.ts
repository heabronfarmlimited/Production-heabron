/**
 * GPS capture — replaces the `fetchLocation()` block that was copy-pasted into
 * AddFarmerController, EditFarmerController, CreateCooperativeController and
 * EditCooperativeController (geolocator).
 *
 * The four Dart copies produced these messages, preserved verbatim:
 *   'Location services are disabled.'
 *   'Location permissions are denied'
 *   'Location permissions are permanently denied, we cannot request permissions.'
 */
import * as Location from 'expo-location';
import { useCallback, useState } from 'react';

import { LIMITS } from '../api/domainConstants';
import { showError } from '../utils/toast';

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export function useLocation() {
  const [loading, setLoading] = useState(false);

  const fetchLocation = useCallback(async (): Promise<Coordinates | null> => {
    setLoading(true);
    try {
      const servicesEnabled = await Location.hasServicesEnabledAsync();
      if (!servicesEnabled) {
        showError('Location services are disabled.');
        return null;
      }

      const existing = await Location.getForegroundPermissionsAsync();
      let status = existing.status;

      if (status !== 'granted') {
        if (!existing.canAskAgain) {
          showError(
            'Location permissions are permanently denied, we cannot request permissions.',
          );
          return null;
        }
        const requested = await Location.requestForegroundPermissionsAsync();
        status = requested.status;
      }

      if (status !== 'granted') {
        showError('Location permissions are denied');
        return null;
      }

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      return {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      };
    } catch {
      showError('Could not determine your location. Please try again.');
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  return { fetchLocation, loading };
}

/**
 * Walks a farm boundary, collecting points for `POST /agent/farmers/:id/map-farm`.
 *
 * The endpoint and its repository method exist in the Flutter app but were
 * never wired to any screen, so farm acreage could only ever be typed by hand.
 * The validator requires at least 3 points
 * (`gpsPolygon: array().items({lat, lng}).min(3).required()`), after which the
 * server computes the area and centroid.
 */
export function useBoundaryCapture() {
  const [points, setPoints] = useState<Coordinates[]>([]);
  const { fetchLocation, loading } = useLocation();

  const addPoint = useCallback(async () => {
    const coords = await fetchLocation();
    if (coords) setPoints((prev) => [...prev, coords]);
    return coords;
  }, [fetchLocation]);

  const removeLast = useCallback(() => {
    setPoints((prev) => prev.slice(0, -1));
  }, []);

  return {
    /** Device-shaped points, for display. */
    points,
    /**
     * The same points in the shape `POST /agent/farmers/:id/map-farm` expects.
     *
     * `expo-location` returns `{ latitude, longitude }` while the validator
     * takes `gpsPolygon: [{ lat, lng }]`, so the conversion lives here rather
     * than being repeated (and mis-typed) at each call site.
     */
    polygon: points.map((p) => ({ lat: p.latitude, lng: p.longitude })),
    addPoint,
    removeLast,
    reset: () => setPoints([]),
    loading,
    /** The server rejects fewer than 3 points. */
    canSubmit: points.length >= LIMITS.minPolygonPoints,
    minPoints: LIMITS.minPolygonPoints,
  };
}

/** Clamps to the validator's bounds: lat ±90, lng ±180. */
export function isValidCoordinate(lat?: number | null, lng?: number | null): boolean {
  if (lat == null || lng == null) return false;
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= LIMITS.latitude.min &&
    lat <= LIMITS.latitude.max &&
    lng >= LIMITS.longitude.min &&
    lng <= LIMITS.longitude.max
  );
}
