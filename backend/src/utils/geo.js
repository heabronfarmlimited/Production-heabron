'use strict';

/**
 * Farm location / mapping helpers.
 *
 * The mobile app lets a field agent walk or tap a farm's boundary, producing
 * an ordered ring of { lat, lng } points (gps_polygon). From that ring we
 * derive the farm size (area) and a representative centre point — so an agent
 * never has to type the acreage, and the platform can show a mapped location.
 *
 * Area uses the spherical-excess-free planar approximation that is accurate to
 * a fraction of a percent for the small fields we deal with (a few acres):
 * project lat/lng to local metres around the polygon centroid, then apply the
 * shoelace formula. No external GIS dependency required.
 */

const EARTH_RADIUS_M = 6378137; // WGS-84 equatorial radius
const SQM_PER_HECTARE = 10000;
const SQM_PER_ACRE = 4046.8564224;

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

/** Normalise a polygon input into an array of {lat,lng} numbers, or null. */
function normalizePolygon(polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3) return null;
  const ring = [];
  for (const p of polygon) {
    if (p == null) return null;
    // accept {lat,lng}, {latitude,longitude}, or [lng,lat] / [lat,lng]
    let lat;
    let lng;
    if (Array.isArray(p)) {
      // GeoJSON convention is [lng, lat]; tolerate both by range-checking.
      const [a, b] = p;
      if (Math.abs(a) <= 90 && Math.abs(b) > 90) {
        lat = a;
        lng = b;
      } else {
        lng = a;
        lat = b;
      }
    } else {
      lat = p.lat != null ? p.lat : p.latitude;
      lng = p.lng != null ? p.lng : p.longitude;
    }
    lat = Number(lat);
    lng = Number(lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    ring.push({ lat, lng });
  }
  return ring;
}

/** Area of a {lat,lng} ring in square metres (planar shoelace, local projection). */
function polygonAreaSqMeters(ring) {
  if (!ring || ring.length < 3) return 0;
  const lat0 = toRad(ring.reduce((s, p) => s + p.lat, 0) / ring.length);
  const cosLat0 = Math.cos(lat0);
  // project each point to metres relative to the first point
  const pts = ring.map((p) => ({
    x: toRad(p.lng) * EARTH_RADIUS_M * cosLat0,
    y: toRad(p.lat) * EARTH_RADIUS_M,
  }));
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    area += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area) / 2;
}

/** Simple average centroid of a ring. */
function polygonCentroid(ring) {
  if (!ring || ring.length === 0) return null;
  const lat = ring.reduce((s, p) => s + p.lat, 0) / ring.length;
  const lng = ring.reduce((s, p) => s + p.lng, 0) / ring.length;
  return { lat: Number(lat.toFixed(8)), lng: Number(lng.toFixed(8)) };
}

/**
 * Given a polygon, return { areaSqM, hectares, acres, centroid } or null.
 */
function measureFarm(polygon) {
  const ring = normalizePolygon(polygon);
  if (!ring) return null;
  const areaSqM = polygonAreaSqMeters(ring);
  return {
    ring,
    areaSqM: Number(areaSqM.toFixed(2)),
    hectares: Number((areaSqM / SQM_PER_HECTARE).toFixed(4)),
    acres: Number((areaSqM / SQM_PER_ACRE).toFixed(4)),
    centroid: polygonCentroid(ring),
  };
}

module.exports = {
  normalizePolygon,
  polygonAreaSqMeters,
  polygonCentroid,
  measureFarm,
  SQM_PER_ACRE,
  SQM_PER_HECTARE,
};
