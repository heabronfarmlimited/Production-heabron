import {
  formatCoordinate,
  formatDistance,
  normalizeRing,
  projectRing,
  ringCenter,
  scaleBar,
  toLocalMeters,
  type LatLng,
} from '../mapProjection';

/**
 * The farm map's geometry.
 *
 * The acreage shown beside the shape must agree with the acreage the server
 * stored against the farm, so the projection uses the same local-plane method
 * as `backend/src/utils/geo.js`. These tests pin that agreement, and the
 * degenerate inputs a real capture produces — one tap, two taps, a GPS that
 * has not moved.
 */

/** A square of a given side, in metres, around a point in Benue State. */
function square(sideMeters: number, origin: LatLng = { lat: 6.8512, lng: 8.3912 }): LatLng[] {
  const metersPerDegreeLat = 111320;
  const metersPerDegreeLng = 111320 * Math.cos((origin.lat * Math.PI) / 180);
  const dLat = sideMeters / metersPerDegreeLat;
  const dLng = sideMeters / metersPerDegreeLng;
  return [
    { lat: origin.lat, lng: origin.lng },
    { lat: origin.lat, lng: origin.lng + dLng },
    { lat: origin.lat + dLat, lng: origin.lng + dLng },
    { lat: origin.lat + dLat, lng: origin.lng },
  ];
}

describe('normalizeRing', () => {
  it('keeps usable points in order', () => {
    const ring = normalizeRing([
      { lat: 1, lng: 2 },
      { lat: 3, lng: 4 },
    ]);
    expect(ring).toEqual([
      { lat: 1, lng: 2 },
      { lat: 3, lng: 4 },
    ]);
  });

  it('drops nulls and out-of-range coordinates rather than throwing', () => {
    // A stored polygon can carry a bad row from an old import; one bad point
    // must not blank the whole map.
    const ring = normalizeRing([
      null,
      { lat: 1, lng: 2 },
      undefined,
      { lat: 999, lng: 2 },
      { lat: 1, lng: -500 },
    ]);
    expect(ring).toEqual([{ lat: 1, lng: 2 }]);
  });

  it('drops a point whose coordinates are not numbers', () => {
    const ring = normalizeRing([
      { lat: Number.NaN, lng: 2 },
      { lat: 1, lng: 2 },
    ]);
    expect(ring).toHaveLength(1);
  });
});

describe('ringCenter', () => {
  it('averages the points', () => {
    expect(ringCenter([{ lat: 0, lng: 0 }, { lat: 2, lng: 4 }])).toEqual({ lat: 1, lng: 2 });
  });

  it('is null for an empty ring', () => {
    expect(ringCenter([])).toBeNull();
  });
});

describe('toLocalMeters', () => {
  it('puts the origin at zero', () => {
    const origin = { lat: 6.8512, lng: 8.3912 };
    const p = toLocalMeters(origin, origin);
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.y).toBeCloseTo(0, 6);
  });

  it('measures north as positive y and east as positive x', () => {
    // The screen flips y later; the maths stays north-up so the area and
    // perimeter are not computed on an inverted axis.
    const origin = { lat: 6.8512, lng: 8.3912 };
    const north = toLocalMeters({ lat: origin.lat + 0.001, lng: origin.lng }, origin);
    const east = toLocalMeters({ lat: origin.lat, lng: origin.lng + 0.001 }, origin);
    expect(north.y).toBeGreaterThan(0);
    expect(north.x).toBeCloseTo(0, 6);
    expect(east.x).toBeGreaterThan(0);
    expect(east.y).toBeCloseTo(0, 6);
  });

  it('converts a tenth of a degree of latitude to about 11 km', () => {
    const origin = { lat: 0, lng: 0 };
    const p = toLocalMeters({ lat: 0.1, lng: 0 }, origin);
    expect(p.y / 1000).toBeCloseTo(11.13, 1);
  });
});

describe('projectRing — area', () => {
  it('measures a 100 m square as one hectare', () => {
    const projected = projectRing(square(100), { width: 300, height: 300 });
    expect(projected).not.toBeNull();
    expect(projected?.areaSqMeters ?? 0).toBeCloseTo(10000, -2);
    expect(projected?.areaHectares ?? 0).toBeCloseTo(1, 2);
  });

  it('agrees with the server on acres for a 100 m square', () => {
    // 10,000 m² / 4046.8564224 = 2.4710538...; the figure beside the shape
    // must match the figure stored against the farm.
    const projected = projectRing(square(100), { width: 300, height: 300 });
    expect(projected?.areaAcres ?? 0).toBeCloseTo(2.4710538, 3);
  });

  it('measures the perimeter of a 100 m square as 400 m', () => {
    const projected = projectRing(square(100), { width: 300, height: 300 });
    expect(projected?.perimeterMeters ?? 0).toBeCloseTo(400, 0);
  });

  it('reports no area for a partially captured boundary', () => {
    const [a, b] = square(100);
    const projected = projectRing([a as LatLng, b as LatLng], { width: 300, height: 300 });
    expect(projected?.areaSqMeters).toBe(0);
    // Two points are one edge walked, not a closed shape — counting the
    // return leg would report 200 m for a 100 m walk.
    expect(projected?.perimeterMeters ?? 0).toBeCloseTo(100, 0);
  });
});

describe('projectRing — fitting the viewport', () => {
  it('centres the shape', () => {
    const projected = projectRing(square(100), { width: 300, height: 500 });
    const xs = projected?.points.map((p) => p.x) ?? [];
    const ys = projected?.points.map((p) => p.y) ?? [];
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(150, 0);
    expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(250, 0);
  });

  it('keeps the shape inside the padding', () => {
    const projected = projectRing(square(100), { width: 300, height: 300, padding: 30 });
    for (const p of projected?.points ?? []) {
      expect(p.x).toBeGreaterThanOrEqual(29);
      expect(p.x).toBeLessThanOrEqual(271);
      expect(p.y).toBeGreaterThanOrEqual(29);
      expect(p.y).toBeLessThanOrEqual(271);
    }
  });

  it('uses one scale for both axes, so a long plot is not stretched square', () => {
    // 200 m by 50 m. If x and y were scaled separately this would render as a
    // square and look nothing like the ground.
    const origin = { lat: 6.8512, lng: 8.3912 };
    const mLat = 200 / 111320;
    const mLng = 50 / (111320 * Math.cos((origin.lat * Math.PI) / 180));
    const projected = projectRing(
      [
        origin,
        { lat: origin.lat, lng: origin.lng + mLng },
        { lat: origin.lat + mLat, lng: origin.lng + mLng },
        { lat: origin.lat + mLat, lng: origin.lng },
      ],
      { width: 300, height: 300 },
    );
    const xs = projected?.points.map((p) => p.x) ?? [];
    const ys = projected?.points.map((p) => p.y) ?? [];
    const widthPx = Math.max(...xs) - Math.min(...xs);
    const heightPx = Math.max(...ys) - Math.min(...ys);
    expect(heightPx / widthPx).toBeCloseTo(4, 1);
  });

  it('places a single point at the centre instead of dividing by zero', () => {
    // What the map looks like after one tap, and whenever the GPS has not
    // moved between taps.
    const projected = projectRing([{ lat: 6.8512, lng: 8.3912 }], {
      width: 300,
      height: 300,
    });
    expect(projected?.points).toHaveLength(1);
    expect(projected?.points[0]?.x).toBeCloseTo(150, 0);
    expect(projected?.points[0]?.y).toBeCloseTo(150, 0);
    expect(Number.isFinite(projected?.metersPerPixel ?? Number.NaN)).toBe(true);
  });

  it('handles several points at the same place', () => {
    const same = { lat: 6.8512, lng: 8.3912 };
    const projected = projectRing([same, same, same], { width: 300, height: 300 });
    expect(Number.isFinite(projected?.metersPerPixel ?? Number.NaN)).toBe(true);
    expect(projected?.areaSqMeters).toBe(0);
  });

  it('is null when there is nothing to draw', () => {
    expect(projectRing([], { width: 300, height: 300 })).toBeNull();
    expect(projectRing([null, undefined], { width: 300, height: 300 })).toBeNull();
  });

  it('survives a zero-sized viewport', () => {
    // Happens on the first render before onLayout has reported a size.
    const projected = projectRing(square(100), { width: 0, height: 0 });
    for (const p of projected?.points ?? []) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
  });
});

describe('scaleBar', () => {
  it('picks the largest round number that fits', () => {
    // 1 m/px over a 200 px allowance: 200 m is round and fits exactly.
    expect(scaleBar(1, 200)).toEqual({ meters: 200, pixels: 200 });
    // 1 m/px over 150 px: 200 would overflow, so it steps down to 100.
    expect(scaleBar(1, 150)).toEqual({ meters: 100, pixels: 100 });
  });

  it('never returns a bar wider than its allowance', () => {
    // A bar drawn past the edge of its container is worse than none.
    for (const [mpp, max] of [[1, 150], [0.37, 180], [12.5, 240], [1000, 90]]) {
      const bar = scaleBar(mpp as number, max as number);
      if (bar) expect(bar.pixels).toBeLessThanOrEqual(max as number);
    }
  });

  it('works at small and large scales', () => {
    expect(scaleBar(0.05, 200)?.meters).toBe(10);
    expect(scaleBar(20, 200)?.meters).toBe(2000);
  });

  it('refuses nonsense rather than returning a bar nobody can read', () => {
    expect(scaleBar(0, 200)).toBeNull();
    expect(scaleBar(-1, 200)).toBeNull();
    expect(scaleBar(1, 0)).toBeNull();
    expect(scaleBar(Number.NaN, 200)).toBeNull();
  });
});

describe('formatting', () => {
  it('shows coordinates at fixed precision so the text does not jitter', () => {
    expect(formatCoordinate({ lat: 6.8512, lng: 8.3912 })).toBe('6.851200, 8.391200');
    expect(formatCoordinate(null)).toBe('—');
    expect(formatCoordinate({ lat: Number.NaN, lng: 1 })).toBe('—');
  });

  it('switches to kilometres above a kilometre', () => {
    expect(formatDistance(400)).toBe('400 m');
    expect(formatDistance(1500)).toBe('1.50 km');
    expect(formatDistance(0)).toBe('—');
    expect(formatDistance(Number.NaN)).toBe('—');
  });
});
