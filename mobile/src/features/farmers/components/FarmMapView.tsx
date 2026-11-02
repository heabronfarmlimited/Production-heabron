/**
 * The farm map — satellite imagery, marker and polygon, full screen.
 *
 * Two layers:
 *
 *   - The BASEMAP is satellite imagery, fetched from this platform's own
 *     backend (`/agent/map/satellite`), which holds the provider key and
 *     returns a picture. The key is not in this app and cannot be: a Maps
 *     Static API key supports only HTTP-referrer and IP restrictions, so one
 *     shipped in the bundle would be unrestricted and readable by anyone who
 *     opens the APK. It is also optional — see below.
 *
 *   - The OVERLAY is drawn here with `react-native-svg`: the boundary to
 *     scale, its vertices in capture order, the centre marker, the area and
 *     perimeter, a scale bar and a north arrow. All of it comes from the
 *     recorded coordinates. It stays crisp while zooming, where a raster
 *     basemap does not, and it survives the imagery being unavailable.
 *
 * The overlay is drawn whether or not imagery loads, so a deployment with no
 * map key — or an agent in a dead spot — still gets a complete, usable view
 * of the farm rather than an error. That is why the metre grid exists: with
 * no basemap it is the only thing conveying scale while panning.
 */
import { Image } from 'expo-image';
import { useMemo, useRef, useState } from 'react';
import {
  PanResponder,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import Svg, { Circle, G, Line, Polygon, Polyline, Text as SvgText } from 'react-native-svg';

import { colors } from '../../../core/theme/colors';
import { h, r, spMin } from '../../../core/theme/responsive';
import { fontWeights, textTheme } from '../../../core/theme/typography';
import {
  formatDistance,
  normalizeRing,
  projectRing,
  ringCenter,
  scaleBar,
  type LatLng,
} from '../../../core/utils/mapProjection';
import { basemapSource, useMapCapability } from '../hooks/useSatelliteBasemap';

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 8;
const GRID_TARGET_PX = 64;

export interface FarmMapViewProps {
  /** The walked boundary, in capture order. */
  polygon: readonly LatLng[];
  /** The farm's recorded point, when it has one. Drawn as the marker. */
  marker?: LatLng | null;
  /** Shown over the shape, e.g. "Farm 2". */
  label?: string | null;
  /**
   * Set false on screens where imagery is not wanted — the live capture
   * screen, where the point of the view is the shape being walked and a
   * billable image request per dropped point would be waste.
   */
  satellite?: boolean;
  style?: object;
}

export function FarmMapView({
  polygon,
  marker,
  label,
  satellite = true,
  style,
}: FarmMapViewProps) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  // Pan start is held in a ref: reading it from state inside the responder
  // would capture a stale value and the shape would jump on every drag.
  const panStart = useRef({ x: 0, y: 0 });

  const { capability } = useMapCapability();
  const [imageryFailed, setImageryFailed] = useState(false);

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize({ width, height });
  };

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          panStart.current = offset;
        },
        onPanResponderMove: (_event, gesture) => {
          setOffset({
            x: panStart.current.x + gesture.dx,
            y: panStart.current.y + gesture.dy,
          });
        },
      }),
    [offset],
  );

  // The ring is projected to fit, then zoom and pan are applied as a transform
  // so the geometry is computed once per layout rather than per frame.
  const projected = useMemo(() => {
    const ring = marker && polygon.length === 0 ? [marker] : polygon;
    return projectRing(ring, {
      width: size.width,
      height: size.height,
      // Proportional, not a fixed 36: on a 320dp phone a fixed inset took
      // nearly a quarter of the width and squeezed the farm into the middle
      // third of the screen. Capped so it does not grow silly on a tablet.
      padding: Math.min(36, Math.max(12, Math.min(size.width, size.height) * 0.08)),
    });
  }, [polygon, marker, size.width, size.height]);

  /**
   * The imagery request.
   *
   * Centred on the ring's own centre so the picture and the overlay line up,
   * and keyed on the QUANTISED zoom rather than the live one — each distinct
   * request is separately billable and separately cached, so a continuous
   * pinch must not fire one per frame.
   */
  const basemap = useMemo(() => {
    if (!satellite || imageryFailed) return null;
    const ring = normalizeRing(marker && polygon.length === 0 ? [marker] : [...polygon]);
    const center = ringCenter(ring);
    return basemapSource(
      { center, polygon: ring, width: size.width, height: size.height, zoom },
      capability,
    );
  }, [satellite, imageryFailed, marker, polygon, size.width, size.height, zoom, capability]);

  const metersPerPixel = projected ? projected.metersPerPixel / zoom : 0;
  const bar = scaleBar(metersPerPixel, Math.min(160, size.width * 0.45));
  const grid = useMemo(() => {
    if (!projected || metersPerPixel <= 0) return null;
    const metres = roundedGridMetres(metersPerPixel * GRID_TARGET_PX);
    return { metres, pixels: metres / metersPerPixel };
  }, [projected, metersPerPixel]);

  const points = projected?.points ?? [];
  const pointList = points.map((p) => `${p.x},${p.y}`).join(' ');
  const closed = points.length >= 3;

  return (
    <View style={[styles.container, style]} onLayout={onLayout} {...responder.panHandlers}>
      {basemap ? (
        <Image
          source={basemap}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          // Cached on disk: the same farm reopened, or revisited after a
          // restart, costs no second request to a billable provider.
          cachePolicy="memory-disk"
          // No spinner and no flash of grey. The overlay is already a
          // complete view, so the imagery fades in behind it when it
          // arrives rather than blocking the screen on arrival.
          transition={220}
          // A 503 means this deployment has no map key, a 5xx means the
          // provider refused; either way the geometry view is the answer and
          // asking again would only burn the agent's data.
          onError={() => setImageryFailed(true)}
          accessibilityIgnoresInvertColors
        />
      ) : null}

      {size.width > 0 && size.height > 0 ? (
        <Svg width={size.width} height={size.height}>
          <G x={offset.x} y={offset.y}>
            <G
              // Zoom about the centre of the view, not the origin, or the
              // shape slides off screen as it scales.
              x={size.width / 2}
              y={size.height / 2}
              scale={zoom}
            >
              <G x={-size.width / 2} y={-size.height / 2}>
                {grid && !basemap ? (
                  <GridLines
                    width={size.width}
                    height={size.height}
                    spacing={grid.pixels}
                  />
                ) : null}

                {closed ? (
                  <Polygon
                    points={pointList}
                    fill="rgba(46, 139, 87, 0.18)"
                    stroke={colors.primary}
                    strokeWidth={2 / zoom}
                  />
                ) : points.length === 2 ? (
                  // A single walked edge: shown as a line, because a
                  // two-point polygon renders as nothing at all.
                  <Polyline
                    points={pointList}
                    fill="none"
                    stroke={colors.primary}
                    strokeWidth={2 / zoom}
                    strokeDasharray={`${6 / zoom},${4 / zoom}`}
                  />
                ) : null}

                {points.map((p, index) => (
                  <G key={`${p.x}-${p.y}-${index}`}>
                    <Circle
                      cx={p.x}
                      cy={p.y}
                      r={5 / zoom}
                      fill={colors.white}
                      stroke={colors.primary}
                      strokeWidth={2 / zoom}
                    />
                    {/* Capture order, so a mis-walked corner is findable. */}
                    <SvgText
                      x={p.x + 9 / zoom}
                      y={p.y - 7 / zoom}
                      fontSize={10 / zoom}
                      fill={colors.secondaryTextColor}
                    >
                      {String(index + 1)}
                    </SvgText>
                  </G>
                ))}

                {marker ? <MarkerPin center={projected?.center} zoom={zoom} /> : null}
              </G>
            </G>
          </G>
        </Svg>
      ) : null}

      {/* ── Overlays, outside the transform so they stay put ───────── */}
      <View style={styles.northArrow} pointerEvents="none">
        <Text style={styles.northText}>N</Text>
        <View style={styles.northNeedle} />
      </View>

      {label ? (
        <View style={styles.labelChip} pointerEvents="none">
          <Text style={styles.labelText} numberOfLines={1}>
            {label}
          </Text>
        </View>
      ) : null}

      <View style={styles.readout} pointerEvents="none">
        <Text style={styles.readoutValue}>
          {projected && projected.areaAcres > 0
            ? `${projected.areaAcres.toFixed(2)} acres`
            : 'Boundary not closed'}
        </Text>
        <Text style={styles.readoutMeta}>
          {projected && projected.perimeterMeters > 0
            ? `${formatDistance(projected.perimeterMeters)} around · ${points.length} point${points.length === 1 ? '' : 's'}`
            : `${points.length} point${points.length === 1 ? '' : 's'} captured`}
        </Text>
        {!basemap ? (
          <Text style={styles.readoutNote}>
            {satellite
              ? 'Shape and measurements are from the recorded GPS points. Satellite imagery is unavailable.'
              : 'Shape and measurements are from the recorded GPS points.'}
          </Text>
        ) : null}
      </View>

      {bar ? (
        <View style={styles.scaleBar} pointerEvents="none">
          <View style={[styles.scaleBarLine, { width: bar.pixels }]} />
          <Text style={styles.scaleBarText}>{formatDistance(bar.meters)}</Text>
        </View>
      ) : null}

      <View style={styles.zoomControls}>
        <ZoomButton
          label="+"
          onPress={() => setZoom((z) => Math.min(MAX_ZOOM, z * 1.5))}
          testID="map-zoom-in"
        />
        <View style={{ height: h(8) }} />
        <ZoomButton
          label="−"
          onPress={() => setZoom((z) => Math.max(MIN_ZOOM, z / 1.5))}
          testID="map-zoom-out"
        />
        <View style={{ height: h(8) }} />
        <ZoomButton
          label="⟲"
          onPress={() => {
            setZoom(1);
            setOffset({ x: 0, y: 0 });
          }}
          testID="map-reset"
        />
      </View>
    </View>
  );
}

function ZoomButton({
  label,
  onPress,
  testID,
}: {
  label: string;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Text
      accessibilityRole="button"
      accessibilityLabel={testID}
      style={styles.zoomButton}
      onPress={onPress}
      testID={testID}
    >
      {label}
    </Text>
  );
}

function GridLines({
  width,
  height,
  spacing,
}: {
  width: number;
  height: number;
  spacing: number;
}) {
  if (!Number.isFinite(spacing) || spacing <= 2) return null;

  const vertical: number[] = [];
  const horizontal: number[] = [];
  // Drawn beyond the viewport so panning does not reveal an edge.
  for (let x = -width; x < width * 2; x += spacing) vertical.push(x);
  for (let y = -height; y < height * 2; y += spacing) horizontal.push(y);

  return (
    <G>
      {vertical.map((x) => (
        <Line
          key={`v${x}`}
          x1={x}
          y1={-height}
          x2={x}
          y2={height * 2}
          stroke="rgba(107, 114, 128, 0.18)"
          strokeWidth={1}
        />
      ))}
      {horizontal.map((y) => (
        <Line
          key={`h${y}`}
          x1={-width}
          y1={y}
          x2={width * 2}
          y2={y}
          stroke="rgba(107, 114, 128, 0.18)"
          strokeWidth={1}
        />
      ))}
    </G>
  );
}

function MarkerPin({
  center,
  zoom,
}: {
  center?: { x: number; y: number };
  zoom: number;
}) {
  if (!center) return null;
  return (
    <G>
      <Circle
        cx={center.x}
        cy={center.y}
        r={7 / zoom}
        fill={colors.primary}
        stroke={colors.white}
        strokeWidth={2.5 / zoom}
      />
      <Circle cx={center.x} cy={center.y} r={16 / zoom} fill="rgba(46, 139, 87, 0.18)" />
    </G>
  );
}

/** A 1 / 2 / 5 grid spacing, so the lines sit on readable distances. */
function roundedGridMetres(target: number): number {
  if (!Number.isFinite(target) || target <= 0) return 10;
  const magnitude = 10 ** Math.floor(Math.log10(target));
  for (const step of [1, 2, 5]) {
    if (target <= step * magnitude) return step * magnitude;
  }
  return 10 * magnitude;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F3F5F4',
    overflow: 'hidden',
  },
  northArrow: {
    position: 'absolute',
    top: r(14),
    right: r(14),
    alignItems: 'center',
  },
  northText: {
    ...textTheme.bodySmall,
    fontSize: spMin(11),
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
    color: colors.secondaryTextColor,
  },
  northNeedle: {
    width: 2,
    height: r(14),
    backgroundColor: colors.secondaryTextColor,
  },
  labelChip: {
    position: 'absolute',
    top: r(14),
    left: r(14),
    maxWidth: '55%',
    paddingHorizontal: r(10),
    paddingVertical: h(5),
    borderRadius: r(12),
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
  },
  labelText: {
    ...textTheme.bodySmall,
    fontSize: spMin(12),
    fontFamily: fontWeights.medium,
    fontWeight: '500',
    color: colors.black,
  },
  readout: {
    position: 'absolute',
    left: r(14),
    bottom: r(14),
    maxWidth: '62%',
    padding: r(10),
    borderRadius: r(10),
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
  },
  readoutValue: {
    ...textTheme.bodyMedium,
    fontSize: spMin(15),
    fontFamily: fontWeights.semiBold,
    fontWeight: '600',
    color: colors.black,
  },
  readoutMeta: {
    ...textTheme.bodySmall,
    fontSize: spMin(11),
    color: colors.secondaryTextColor,
  },
  readoutNote: {
    ...textTheme.bodySmall,
    fontSize: spMin(10),
    color: colors.secondaryTextColor,
    lineHeight: spMin(14),
    marginTop: h(4),
  },
  scaleBar: {
    position: 'absolute',
    right: r(14),
    bottom: r(16),
    alignItems: 'flex-end',
  },
  scaleBarLine: {
    height: 3,
    backgroundColor: colors.black,
    borderRadius: 2,
  },
  scaleBarText: {
    ...textTheme.bodySmall,
    fontSize: spMin(10),
    color: colors.black,
  },
  zoomControls: {
    position: 'absolute',
    right: r(14),
    top: '38%',
  },
  zoomButton: {
    width: r(36),
    height: r(36),
    borderRadius: r(18),
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    textAlign: 'center',
    lineHeight: r(36),
    fontSize: spMin(18),
    color: colors.black,
    overflow: 'hidden',
  },
});
