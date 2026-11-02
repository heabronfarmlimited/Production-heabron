import { authStorage } from '../../storage/authStorage';
import { basemapSource, imageryZoom } from '../satelliteRequest';

/**
 * The basemap request.
 *
 * Every distinct URL here is a separate billable request to Google or Mapbox
 * and a separate cache entry, so the two things that matter are: it must
 * carry the agent's token (the proxy is authenticated, and an anonymous
 * request would be the one way to spend the account's map quota without
 * logging in), and it must not change on every frame of a pinch.
 */

jest.mock('../../storage/authStorage', () => ({
  authStorage: { getToken: jest.fn(() => 'test-token') },
}));

/**
 * `core/config/env` resolves the API base URL at module load and THROWS when
 * it is unset, so every module that imports it is unloadable under Jest
 * without this. Mocked rather than worked around: the base URL is an
 * environment concern and the thing under test is the URL this builds from
 * it.
 */
jest.mock('../../config/env', () => ({
  BASE_URL: 'https://api.example.test/api',
  TIMEOUTS: { default: 15000 },
}));

const getToken = authStorage.getToken as jest.Mock;

const available = { satelliteAvailable: true, provider: 'google', maxDimension: 640 };
const center = { lat: 6.851234, lng: 8.391234 };
const request = {
  center,
  polygon: [
    { lat: 6.8512, lng: 8.3912 },
    { lat: 6.8512, lng: 8.3922 },
    { lat: 6.8522, lng: 8.3922 },
  ],
  width: 390,
  height: 500,
};

beforeEach(() => {
  getToken.mockReturnValue('test-token');
});

describe('basemapSource', () => {
  it('builds a request through this platform, not the provider', () => {
    // The provider key is not in this app and cannot be: a Maps Static key
    // supports only referrer and IP restrictions, so one in the bundle would
    // be unrestricted and readable from the APK.
    const source = basemapSource(request, available);
    expect(source?.uri).toContain('/agent/map/satellite');
    expect(source?.uri).not.toMatch(/googleapis|mapbox/);
  });

  it('carries the session token, since the proxy is authenticated', () => {
    expect(basemapSource(request, available)?.headers.Authorization).toBe(
      'Bearer test-token',
    );
  });

  it('sends the centre and the boundary', () => {
    const uri = basemapSource(request, available)?.uri ?? '';
    expect(uri).toContain('lat=6.851234');
    expect(uri).toContain('lng=8.391234');
    expect(decodeURIComponent(uri)).toContain('6.851200,8.391200');
  });

  it('is null when the server has no imagery configured', () => {
    // Not an error state: the farm map draws the boundary and measurements
    // from the recorded points, which is a complete view.
    expect(
      basemapSource(request, { satelliteAvailable: false, provider: null, maxDimension: 640 }),
    ).toBeNull();
    expect(basemapSource(request, null)).toBeNull();
  });

  it('is null before the capability answer arrives', () => {
    // So the map never flashes an empty basemap frame on the way to the
    // real answer.
    expect(basemapSource(request, null)).toBeNull();
  });

  it('is null without a token, rather than sending an anonymous request', () => {
    getToken.mockReturnValue(null);
    expect(basemapSource(request, available)).toBeNull();
  });

  it('is null with no centre to request', () => {
    expect(basemapSource({ ...request, center: null }, available)).toBeNull();
    expect(
      basemapSource({ ...request, center: { lat: Number.NaN, lng: 1 } }, available),
    ).toBeNull();
  });

  it('is null before the view has been laid out', () => {
    // The first render reports a zero size; requesting a 0x0 image would be
    // a wasted billable call.
    expect(basemapSource({ ...request, width: 0, height: 0 }, available)).toBeNull();
  });

  it('clamps the size to what the provider will return', () => {
    // Google's Static Maps limit is 640 per dimension and a phone screen is
    // taller than that; asking for more is a 400.
    const uri = basemapSource({ ...request, width: 1200, height: 2400 }, available)?.uri ?? '';
    expect(uri).toContain('width=640');
    expect(uri).toContain('height=640');
  });

  it('allows Mapbox its larger ceiling', () => {
    const uri =
      basemapSource(
        { ...request, width: 1200, height: 1200 },
        { satelliteAvailable: true, provider: 'mapbox', maxDimension: 1280 },
      )?.uri ?? '';
    expect(uri).toContain('width=1200');
  });

  it('thins a long boundary instead of sending hundreds of points', () => {
    // The agent's mobile data, spent on points the server would discard.
    const many = Array.from({ length: 900 }, (_, i) => ({
      lat: 6.85 + i * 0.000001,
      lng: 8.39 + i * 0.000001,
    }));
    const uri = basemapSource({ ...request, polygon: many }, available)?.uri ?? '';
    const polygon = new URL(uri).searchParams.get('polygon') ?? '';
    expect(polygon.split(';').length).toBeLessThanOrEqual(101);
  });

  it('keeps the last point when thinning, so the outline closes', () => {
    const many = Array.from({ length: 900 }, (_, i) => ({ lat: 6.85 + i * 0.00001, lng: 8.39 }));
    const uri = basemapSource({ ...request, polygon: many }, available)?.uri ?? '';
    const polygon = new URL(uri).searchParams.get('polygon') ?? '';
    const last = many[many.length - 1];
    expect(polygon.endsWith(`${last!.lat.toFixed(6)},${last!.lng.toFixed(6)}`)).toBe(true);
  });

  it('omits the polygon for a farm with only a point', () => {
    const uri = basemapSource({ ...request, polygon: [] }, available)?.uri ?? '';
    expect(uri).not.toContain('polygon=');
  });

  it('asks for a retina image, because 1x looks soft on a phone', () => {
    expect(basemapSource(request, available)?.uri).toContain('scale=2');
  });
});

describe('imageryZoom', () => {
  it('defaults to a level that frames a smallholder plot', () => {
    expect(imageryZoom(1)).toBe(17);
  });

  it('steps one imagery level per doubling of screen zoom', () => {
    expect(imageryZoom(2)).toBe(18);
    expect(imageryZoom(4)).toBe(19);
    expect(imageryZoom(0.5)).toBe(16);
  });

  it('quantises, so a continuous pinch does not fire a request per frame', () => {
    // Each distinct value is a separate billable request. These are all one
    // level apart in screen zoom and must collapse to one imagery level.
    const zooms = [1.05, 1.1, 1.2, 1.3, 1.4];
    const levels = new Set(zooms.map(imageryZoom));
    expect(levels.size).toBe(1);
  });

  it('stays inside the range where imagery exists', () => {
    expect(imageryZoom(10000)).toBe(21);
    expect(imageryZoom(0.0001)).toBe(14);
  });

  it('survives nonsense', () => {
    expect(imageryZoom(Number.NaN)).toBe(17);
    expect(imageryZoom(0)).toBe(17);
    expect(imageryZoom(-3)).toBe(17);
  });
});
