'use strict';

/**
 * Satellite basemap for the farm map.
 *
 * WHY THIS IS A SERVER-SIDE PROXY AND NOT A KEY IN THE APP
 *
 * The obvious implementation is to put a static-maps key in the mobile app
 * and let it build the image URL itself. That cannot be done safely:
 *
 *   - Google's Maps Static API does not support Android/iOS application
 *     restrictions. The only restrictions available are HTTP referrer and IP
 *     address, neither of which a phone can satisfy. A key shipped in the
 *     bundle is therefore an UNRESTRICTED key, and an app bundle is a public
 *     file — anyone can pull it out and spend the account's billing on it.
 *   - Mapbox public tokens are scopable but still readable in the bundle, and
 *     a leaked one still has to be rotated through an app release.
 *
 * So the key lives in the backend environment and the app asks the backend
 * for the picture. The key never leaves the server, it can be rotated without
 * an app release, requests are already authenticated by the agent's session,
 * and the usage is attributable to a user.
 *
 * WHY STATIC IMAGES AND NOT A MAP SDK
 *
 * `react-native-maps` and `expo-maps` are native modules. Adding one requires
 * a new development build before the app will start at all, and on Android it
 * needs its own Google Maps key wired into the native manifest. A static
 * image needs neither: it is an `<Image>` with a URL, it works in the
 * existing build, and for this screen's job — look at one farm's boundary on
 * imagery — a fixed picture is all a map SDK would have given us anyway.
 *
 * WHAT THE PROVIDERS DO
 *
 * Both can draw the boundary and the marker server-side, so the returned PNG
 * already has the farm outlined on it. The app still draws its own vector
 * overlay on top (the numbered vertices, the measurements), because those
 * have to stay crisp while zooming and must survive the imagery being
 * unavailable.
 */

const config = require('../../config');

const PROVIDERS = {
  google: {
    /** https://developers.google.com/maps/documentation/maps-static */
    maxDimension: 640,
    build: buildGoogleUrl,
  },
  mapbox: {
    /** https://docs.mapbox.com/api/maps/static-images/ */
    maxDimension: 1280,
    build: buildMapboxUrl,
  },
};

/** Clamp, because every provider bills by pixel and rejects silly sizes. */
function clamp(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/**
 * A polygon trimmed to what a static-image URL can carry.
 *
 * A walked boundary can hold hundreds of points, and both providers cap the
 * URL length — Google at 16,384 characters. Rather than return an error for a
 * carefully walked farm, the ring is thinned by taking every Nth point, which
 * keeps the shape recognisable at the size of the picture. The app's own
 * vector overlay still draws every point, so nothing is lost where it
 * matters.
 */
function thinRing(ring, maxPoints) {
  if (!Array.isArray(ring) || ring.length <= maxPoints) return ring || [];
  const step = Math.ceil(ring.length / maxPoints);
  const out = [];
  for (let i = 0; i < ring.length; i += step) out.push(ring[i]);
  // The last point matters: dropping it leaves a visible notch in the
  // outline where the ring closes.
  const last = ring[ring.length - 1];
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

const coord = (p) => `${Number(p.lat).toFixed(6)},${Number(p.lng).toFixed(6)}`;

function buildGoogleUrl({ lat, lng, zoom, width, height, scale, polygon, key }) {
  const params = new URLSearchParams({
    center: `${lat.toFixed(6)},${lng.toFixed(6)}`,
    zoom: String(zoom),
    size: `${width}x${height}`,
    scale: String(scale),
    maptype: 'satellite',
    format: 'png',
    key,
  });

  // `path` draws the boundary. Google closes the ring itself when the fill
  // colour is set, so the first point is not repeated.
  if (polygon.length >= 3) {
    const points = thinRing(polygon, 100).map(coord).join('|');
    params.append('path', `color:0x2E8B57ff|weight:3|fillcolor:0x2E8B5733|${points}`);
  }

  return `https://maps.googleapis.com/maps/api/staticmap?${params.toString()}`;
}

function buildMapboxUrl({ lat, lng, zoom, width, height, scale, polygon, key }) {
  // Mapbox puts the overlay in the path, as GeoJSON, before the position.
  let overlay = '';
  if (polygon.length >= 3) {
    const ring = thinRing(polygon, 80).map((p) => [Number(p.lng), Number(p.lat)]);
    // GeoJSON wants a closed ring: first point repeated at the end.
    const first = ring[0];
    const closed = [...ring, first];
    const geojson = {
      type: 'Feature',
      properties: {
        stroke: '#2E8B57',
        'stroke-width': 3,
        fill: '#2E8B57',
        'fill-opacity': 0.2,
      },
      geometry: { type: 'Polygon', coordinates: [closed] },
    };
    overlay = `geojson(${encodeURIComponent(JSON.stringify(geojson))})/`;
  }

  const retina = scale > 1 ? '@2x' : '';
  return (
    'https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/' +
    `${overlay}${lng.toFixed(6)},${lat.toFixed(6)},${zoom}/` +
    `${width}x${height}${retina}?access_token=${encodeURIComponent(key)}`
  );
}

/** What `config.map` resolves to, so callers do not re-read env. */
function mapConfig() {
  return config.map || {};
}

/** True when a provider and a key are both configured. */
function isConfigured() {
  const { provider, apiKey } = mapConfig();
  return Boolean(provider && apiKey && PROVIDERS[provider]);
}

/**
 * Builds the upstream image URL for one request.
 *
 * Pure apart from reading config, and separate from the fetching so the URL
 * shape can be tested — which is where the bugs in this kind of code live
 * (a swapped lat/lng, a missing maptype, an unencoded overlay). Returns
 * `{ url, provider }`, or `{ error }` when the inputs or the configuration
 * will not produce a picture.
 */
function buildStaticMapUrl(input = {}) {
  const { provider, apiKey } = mapConfig();

  if (!provider || !apiKey) {
    return { error: 'not_configured' };
  }
  const spec = PROVIDERS[provider];
  if (!spec) {
    return { error: 'unknown_provider' };
  }

  const lat = Number(input.lat);
  const lng = Number(input.lng);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) return { error: 'bad_center' };
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) return { error: 'bad_center' };

  // Zoom 17 shows roughly a couple of hectares across a phone screen, which
  // is the right default for a smallholder plot. 21 is as far in as satellite
  // imagery goes before it starts blurring.
  const zoom = clamp(input.zoom, 1, 21, 17);
  const width = clamp(input.width, 64, spec.maxDimension, 640);
  const height = clamp(input.height, 64, spec.maxDimension, 640);
  // Retina only: a 1x image on a phone screen looks soft, and 2x is the most
  // either provider will return.
  const scale = clamp(input.scale, 1, 2, 2);

  const polygon = Array.isArray(input.polygon)
    ? input.polygon.filter(
        (p) =>
          p &&
          Number.isFinite(Number(p.lat)) &&
          Number.isFinite(Number(p.lng)) &&
          Math.abs(Number(p.lat)) <= 90 &&
          Math.abs(Number(p.lng)) <= 180
      )
    : [];

  return {
    provider,
    url: spec.build({ lat, lng, zoom, width, height, scale, polygon, key: apiKey }),
  };
}

/**
 * Strips the key from a URL before it can reach a log or an error body.
 *
 * Without this, one `logger.error({ url })` on a failed fetch would write the
 * API key into the log stream, which is the thing this whole module exists to
 * avoid.
 */
function redactUrl(url) {
  if (typeof url !== 'string') return url;
  return url
    .replace(/([?&]key=)[^&]+/i, '$1REDACTED')
    .replace(/([?&]access_token=)[^&]+/i, '$1REDACTED');
}

module.exports = {
  PROVIDERS,
  buildStaticMapUrl,
  isConfigured,
  redactUrl,
  thinRing,
};
