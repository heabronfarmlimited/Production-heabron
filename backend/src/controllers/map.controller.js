'use strict';

/**
 * Satellite basemap proxy.
 *
 * `GET /agent/map/satellite` returns a PNG of the farm's surroundings with its
 * boundary drawn on it. The app puts its own vector overlay on top.
 *
 * The provider API key stays in this process — see `services/satellite` for
 * why it cannot live in the app bundle. The route is mounted behind the same
 * auth as everything else, so an unauthenticated request cannot spend the
 * account's map quota.
 */

const { buildStaticMapUrl, isConfigured, redactUrl } = require('../services/satellite');
const config = require('../config');
const { badRequest, fail, ok } = require('../utils/response');
const logger = require('../utils/logger');

/** Upstream is given a hard ceiling: a hung request must not hold a lambda. */
const UPSTREAM_TIMEOUT_MS = 8000;
const MAX_BYTES = 6 * 1024 * 1024;

/**
 * Parses the polygon from the query string.
 *
 * Sent as `lat,lng;lat,lng;…` rather than JSON: a GET is the only shape that
 * can be cached by a CDN and consumed by an `<Image>`, and a URL-encoded JSON
 * blob in a query parameter is both longer and harder to read in a log.
 */
function parsePolygon(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return [];
  return raw
    .split(';')
    .map((pair) => {
      const [lat, lng] = pair.split(',');
      return { lat: Number(lat), lng: Number(lng) };
    })
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));
}

async function satellite(req, res) {
  if (!isConfigured()) {
    /**
     * 503 with a machine-readable code, not a 404 and not a placeholder
     * image. The app checks for this once and then stops asking for imagery
     * for the rest of the session, falling back to the geometry-only map —
     * which is a complete, usable view, not an error state. Returning a grey
     * placeholder PNG instead would make an unconfigured deployment look like
     * a broken one.
     */
    return fail(
      res,
      503,
      'MAP_NOT_CONFIGURED',
      'Satellite imagery is not configured on this server. The farm map will show the recorded boundary without a basemap.',
      { configure: ['MAP_PROVIDER', 'MAP_STATIC_API_KEY'] }
    );
  }

  const built = buildStaticMapUrl({
    lat: req.query.lat,
    lng: req.query.lng,
    zoom: req.query.zoom,
    width: req.query.width,
    height: req.query.height,
    scale: req.query.scale,
    polygon: parsePolygon(req.query.polygon),
  });

  if (built.error === 'bad_center') {
    return badRequest(res, 'A valid lat and lng are required', {
      lat: req.query.lat,
      lng: req.query.lng,
    });
  }
  if (built.error) {
    logger.error({ reason: built.error }, 'static map url could not be built');
    return fail(res, 503, 'MAP_NOT_CONFIGURED', 'Satellite imagery is not available.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    const upstream = await fetch(built.url, { signal: controller.signal });

    if (!upstream.ok) {
      // The body often explains the real problem — a key restriction, the
      // Static Maps API not enabled, billing not set up — and it is worth
      // having in the log. The URL is redacted because it carries the key.
      const detail = await upstream.text().catch(() => '');
      logger.error(
        {
          status: upstream.status,
          provider: built.provider,
          url: redactUrl(built.url),
          detail: detail.slice(0, 500),
        },
        'satellite provider rejected the request'
      );
      return fail(
        res,
        502,
        'MAP_UPSTREAM_ERROR',
        'The map provider could not return imagery for that location.'
      );
    }

    const contentType = upstream.headers.get('content-type') || 'image/png';
    if (!contentType.startsWith('image/')) {
      // A provider error page served with 200. Passing it through would put
      // text where the app expects a picture.
      logger.error(
        { contentType, provider: built.provider },
        'satellite provider returned a non-image body'
      );
      return fail(res, 502, 'MAP_UPSTREAM_ERROR', 'The map provider returned an unexpected response.');
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());
    if (buffer.length > MAX_BYTES) {
      return fail(res, 502, 'MAP_UPSTREAM_ERROR', 'The map provider returned an image that is too large.');
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', String(buffer.length));
    // Farm imagery does not change week to week and every repeat request is
    // billable, so this is cached hard. `private` because the URL carries the
    // farm's coordinates: a shared cache keyed on it would hold one farmer's
    // location for anyone behind the same proxy.
    res.setHeader(
      'Cache-Control',
      `private, max-age=${config.map.cacheSeconds}, immutable`
    );
    return res.status(200).end(buffer);
  } catch (err) {
    const aborted = err?.name === 'AbortError';
    logger.error(
      { err: err?.message, aborted, provider: built.provider },
      'satellite fetch failed'
    );
    return fail(
      res,
      aborted ? 504 : 502,
      'MAP_UPSTREAM_ERROR',
      aborted
        ? 'The map provider took too long to respond.'
        : 'Could not reach the map provider.'
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * `GET /agent/map/config` — whether imagery is available.
 *
 * The app asks once at startup instead of discovering it from a failed image
 * load. An `<Image>` that 503s shows nothing and reports nothing, so without
 * this the app would either flash an empty basemap on every farm or have to
 * treat every image failure as "not configured" — including a genuine
 * network blip.
 */
function mapConfigEndpoint(req, res) {
  return ok(res, {
    satellite_available: isConfigured(),
    provider: isConfigured() ? config.map.provider : null,
    // So the app can size its requests to what the provider will return.
    max_dimension: config.map.provider === 'mapbox' ? 1280 : 640,
  });
}

module.exports = { satellite, mapConfig: mapConfigEndpoint };
