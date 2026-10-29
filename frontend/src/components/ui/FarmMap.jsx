import { MapPin, ExternalLink } from 'lucide-react';

/**
 * Shows the exact farm location using an OpenStreetMap embed — no API key
 * required. Centres on the farm's GPS coordinates with a marker pin and a link
 * to open the full map. In production this can be swapped for a Mapbox/Google
 * tile that also draws the plot boundary polygon.
 */
export function FarmMap({ lat: rawLat, lng: rawLng, label, height = 150 }) {
  // FIXED — gps_lat/gps_lng come back from Postgres NUMERIC as strings. The old
  // guard (`Number.isNaN(lat)`) is false for any string, so a bad value got
  // through and `lat.toFixed(5)` below threw. Coerce once, validate the range.
  const lat = Number(rawLat);
  const lng = Number(rawLng);
  const valid =
    rawLat != null && rawLng != null && rawLat !== '' && rawLng !== '' &&
    Number.isFinite(lat) && Number.isFinite(lng) &&
    Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
  if (!valid) return null;

  const d = 0.01; // bounding box padding (~1km)
  const bbox = `${lng - d}%2C${lat - d}%2C${lng + d}%2C${lat + d}`;
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat}%2C${lng}`;
  const full = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=15/${lat}/${lng}`;

  return (
    <div>
      <iframe
        title="Farm location"
        src={src}
        style={{ width: '100%', height, border: 0, display: 'block' }}
        loading="lazy"
      />
      <div className="flex items-center justify-between px-3 py-2 text-[11px] text-smoke bg-white border-t border-whisper">
        <span className="inline-flex items-center gap-1">
          <MapPin className="size-3 text-forest-500" />
          {label || `${lat.toFixed(5)}, ${lng.toFixed(5)}`}
        </span>
        <a href={full} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-forest-600 hover:underline">
          Open map <ExternalLink className="size-3" />
        </a>
      </div>
    </div>
  );
}

export default FarmMap;
