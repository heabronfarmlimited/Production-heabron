'use strict';

/**
 * Heabron CoopScore — satellite basemap verification
 * --------------------------------------------------
 * Run with:  node scripts/verify-satellite.js
 *
 * The bugs in static-map code are all in the URL: a swapped lat/lng (Google
 * takes lat,lng and Mapbox takes lng,lat — in the same screen's worth of
 * code), a missing `maptype` so the imagery comes back as a road map, an
 * unencoded GeoJSON overlay, or a key that ends up in a log. None of those
 * fail loudly; they just return the wrong picture, or quietly leak.
 *
 * So the URL building is a pure function and this exercises it directly. The
 * fetch itself is not tested here — it is a `fetch` of a provider that needs
 * a real key and real network, and mocking it would only test the mock.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const CONFIG_PATH = path.join(__dirname, '..', 'src', 'config', 'index.js');
const SATELLITE_PATH = path.join(__dirname, '..', 'src', 'services', 'satellite', 'index.js');

/** Loads the service with a given map config, bypassing the module cache. */
function withConfig(map) {
  delete require.cache[require.resolve(CONFIG_PATH)];
  delete require.cache[require.resolve(SATELLITE_PATH)];
  const config = require(CONFIG_PATH);
  config.map = map;
  return require(SATELLITE_PATH);
}

const KEY = 'test-key-123';
const BENUE = { lat: 6.851234, lng: 8.391234 };
const RING = [
  { lat: 6.8512, lng: 8.3912 },
  { lat: 6.8512, lng: 8.3922 },
  { lat: 6.8522, lng: 8.3922 },
  { lat: 6.8522, lng: 8.3912 },
];

// ────────────────────────────────────────────── configuration

test('unconfigured is reported, not guessed at', () => {
  const svc = withConfig({ provider: null, apiKey: null });
  assert.equal(svc.isConfigured(), false);
  assert.equal(svc.buildStaticMapUrl(BENUE).error, 'not_configured');
});

test('a provider with no key is still unconfigured', () => {
  const svc = withConfig({ provider: 'google', apiKey: null });
  assert.equal(svc.isConfigured(), false);
});

test('an unknown provider name is refused rather than defaulted', () => {
  // Defaulting a typo'd MAP_PROVIDER to Google would spend the account's
  // quota on a provider the operator did not choose.
  const svc = withConfig({ provider: 'googel', apiKey: KEY });
  assert.equal(svc.isConfigured(), false);
  assert.equal(svc.buildStaticMapUrl(BENUE).error, 'unknown_provider');
});

// ────────────────────────────────────────────────── Google

test('google: satellite imagery, not a road map', () => {
  // Without `maptype=satellite` the API returns a street map, which is the
  // single most likely way this screen ends up looking wrong.
  const svc = withConfig({ provider: 'google', apiKey: KEY });
  const { url } = svc.buildStaticMapUrl(BENUE);
  assert.match(url, /maptype=satellite/);
});

test('google: centre is lat,lng in that order', () => {
  const svc = withConfig({ provider: 'google', apiKey: KEY });
  const { url } = svc.buildStaticMapUrl(BENUE);
  assert.match(url, /center=6\.851234%2C8\.391234/);
});

test('google: the boundary is drawn on the image', () => {
  const svc = withConfig({ provider: 'google', apiKey: KEY });
  const { url } = svc.buildStaticMapUrl({ ...BENUE, polygon: RING });
  const decoded = decodeURIComponent(url);
  assert.match(decoded, /path=color:0x2E8B57ff/);
  assert.match(decoded, /6\.851200,8\.391200/);
});

test('google: fewer than three points draws no path', () => {
  // Two points are a line, not a boundary; Google fills a 2-point path as a
  // degenerate shape and the result is a stray streak across the image.
  const svc = withConfig({ provider: 'google', apiKey: KEY });
  const { url } = svc.buildStaticMapUrl({ ...BENUE, polygon: RING.slice(0, 2) });
  assert.equal(url.includes('path='), false);
});

test('google: dimensions are clamped to what the API allows', () => {
  // The free Static Maps size limit is 640x640 per dimension; asking for
  // more is a 400, and the app can legitimately ask for a tall phone screen.
  const svc = withConfig({ provider: 'google', apiKey: KEY });
  const { url } = svc.buildStaticMapUrl({ ...BENUE, width: 2000, height: 4000 });
  assert.match(url, /size=640x640/);
});

// ────────────────────────────────────────────────── Mapbox

test('mapbox: centre is lng,lat — the opposite order to google', () => {
  // The two APIs disagree about coordinate order, in code a screen apart.
  // Getting this wrong puts the farm in the Indian Ocean.
  const svc = withConfig({ provider: 'mapbox', apiKey: KEY });
  const { url } = svc.buildStaticMapUrl(BENUE);
  assert.match(url, /8\.391234,6\.851234,17/);
});

test('mapbox: uses the satellite style', () => {
  const svc = withConfig({ provider: 'mapbox', apiKey: KEY });
  const { url } = svc.buildStaticMapUrl(BENUE);
  assert.match(url, /styles\/v1\/mapbox\/satellite-v9\/static/);
});

test('mapbox: the overlay is encoded, and its ring is closed', () => {
  // An unencoded GeoJSON blob breaks the URL at the first brace. And Mapbox
  // requires the first coordinate repeated at the end — without it the
  // polygon is rejected and no image comes back at all.
  const svc = withConfig({ provider: 'mapbox', apiKey: KEY });
  const { url } = svc.buildStaticMapUrl({ ...BENUE, polygon: RING });
  assert.equal(url.includes('{'), false, 'raw braces in the URL');

  const match = /geojson\(([^)]+)\)/.exec(url);
  assert.ok(match, 'no geojson overlay');
  const geo = JSON.parse(decodeURIComponent(match[1]));
  const ring = geo.geometry.coordinates[0];
  assert.deepEqual(ring[0], ring[ring.length - 1], 'ring is not closed');
  // GeoJSON is [lng, lat].
  assert.equal(ring[0][0], 8.3912);
  assert.equal(ring[0][1], 6.8512);
});

test('mapbox: a retina image asks for @2x', () => {
  const svc = withConfig({ provider: 'mapbox', apiKey: KEY });
  const { url } = svc.buildStaticMapUrl({ ...BENUE, scale: 2 });
  assert.match(url, /@2x\?/);
});

// ───────────────────────────────────────────── shared behaviour

test('a bad centre is refused by both providers', () => {
  for (const provider of ['google', 'mapbox']) {
    const svc = withConfig({ provider, apiKey: KEY });
    for (const bad of [{}, { lat: 91, lng: 0 }, { lat: 0, lng: 200 }, { lat: 'x', lng: 'y' }]) {
      assert.equal(svc.buildStaticMapUrl(bad).error, 'bad_center', `${provider} ${JSON.stringify(bad)}`);
    }
  }
});

test('zoom is clamped to where imagery exists', () => {
  const svc = withConfig({ provider: 'google', apiKey: KEY });
  assert.match(svc.buildStaticMapUrl({ ...BENUE, zoom: 99 }).url, /zoom=21/);
  assert.match(svc.buildStaticMapUrl({ ...BENUE, zoom: -5 }).url, /zoom=1/);
  // The default suits a smallholder plot rather than a whole LGA.
  assert.match(svc.buildStaticMapUrl(BENUE).url, /zoom=17/);
});

test('garbage points are dropped instead of corrupting the overlay', () => {
  const svc = withConfig({ provider: 'google', apiKey: KEY });
  const { url } = svc.buildStaticMapUrl({
    ...BENUE,
    polygon: [...RING, null, { lat: 'x', lng: 1 }, { lat: 999, lng: 1 }],
  });
  const decoded = decodeURIComponent(url);
  assert.equal(decoded.includes('999'), false);
  assert.equal(decoded.includes('NaN'), false);
});

test('a long boundary is thinned rather than rejected', () => {
  // A carefully walked farm can carry hundreds of points and both providers
  // cap the URL length. Returning an error for the best-mapped farms would
  // be the wrong trade.
  const svc = withConfig({ provider: 'google', apiKey: KEY });
  const many = Array.from({ length: 800 }, (_, i) => ({
    lat: 6.85 + i * 0.000001,
    lng: 8.39 + i * 0.000001,
  }));
  const { url } = svc.buildStaticMapUrl({ ...BENUE, polygon: many });
  assert.ok(url.length < 8000, `url is ${url.length} characters`);
  assert.match(url, /path=/);
});

test('thinning keeps the first and last points, so the outline closes', () => {
  const svc = withConfig({ provider: 'google', apiKey: KEY });
  const ring = Array.from({ length: 500 }, (_, i) => ({ lat: i, lng: i }));
  const thinned = svc.thinRing(ring, 50);
  assert.deepEqual(thinned[0], ring[0]);
  assert.deepEqual(thinned[thinned.length - 1], ring[ring.length - 1]);
  assert.ok(thinned.length <= 51);
});

test('thinning leaves a short ring untouched', () => {
  const svc = withConfig({ provider: 'google', apiKey: KEY });
  assert.deepEqual(svc.thinRing(RING, 100), RING);
  assert.deepEqual(svc.thinRing(null, 100), []);
});

// ───────────────────────────────────────────────── key safety

test('the key never survives redaction, for either provider', () => {
  // One `logger.error({ url })` on a failed fetch would otherwise write the
  // API key into the log stream — the exact thing the server-side proxy
  // exists to prevent.
  for (const provider of ['google', 'mapbox']) {
    const svc = withConfig({ provider, apiKey: 'SUPER-SECRET-KEY' });
    const { url } = svc.buildStaticMapUrl({ ...BENUE, polygon: RING });
    assert.match(url, /SUPER-SECRET-KEY/, 'the key should be in the real url');
    const redacted = svc.redactUrl(url);
    assert.equal(
      redacted.includes('SUPER-SECRET-KEY'),
      false,
      `${provider}: the key survived redaction`
    );
    assert.match(redacted, /REDACTED/);
  }
});

test('redaction survives a non-string', () => {
  const svc = withConfig({ provider: 'google', apiKey: KEY });
  assert.equal(svc.redactUrl(null), null);
  assert.equal(svc.redactUrl(undefined), undefined);
});
