/**
 * Farm set arithmetic.
 *
 * A farmer may hold several farms (v2 "Add Another Farm"). Before this module
 * every read in the API did `farmer.farm_profiles?.[0]` — an arbitrary row out
 * of an unordered set. That is wrong in three different ways at once:
 *
 *   - The farmer's land size (the denominator of the production score) was one
 *     plot's acreage rather than all of them, so a two-farm farmer scored as
 *     though the second farm's output came off the first farm's land.
 *   - Which row `[0]` returned could change between requests, because
 *     PostgREST does not promise an order on an embedded select.
 *   - A cooperative's land total summed those arbitrary rows.
 *
 * Every aggregation now goes through here, so there is one definition of
 * "this farmer's land" and it is the same in the score, the report, the
 * dashboard and the app.
 *
 * All functions are pure and take the embedded `farm_profiles` value in
 * whatever shape PostgREST returned it: an array, a single object (when the
 * relationship was read as to-one), null, or undefined.
 */

/** Normalise the embedded value to an array, in a stable display order. */
function toFarmList(embedded) {
  const list = Array.isArray(embedded) ? embedded : embedded ? [embedded] : [];
  // Primary first, then oldest first. `created_at` can be absent on a
  // partial select, in which case id keeps the order deterministic rather
  // than leaving it to PostgREST.
  return [...list].filter(Boolean).sort((a, b) => {
    if (!!a.is_primary !== !!b.is_primary) return a.is_primary ? -1 : 1;
    const at = a.created_at || '';
    const bt = b.created_at || '';
    if (at !== bt) return at < bt ? -1 : 1;
    return String(a.id || '') < String(b.id || '') ? -1 : 1;
  });
}

/**
 * The acreage a single farm contributes.
 *
 * `farm_size_acres` is what the agent entered or what the polygon derived;
 * `computed_area_acres` is only set when a boundary was walked. The entered
 * figure wins when present because an agent can correct it after mapping
 * (a polygon may include a path or a neighbour's strip), and
 * applyPolygonDerivations already copies the computed area into
 * farm_size_acres when the agent left it blank. So preferring the computed
 * one here would silently override a correction.
 */
function farmAcres(farm) {
  const entered = Number(farm?.farm_size_acres);
  if (Number.isFinite(entered) && entered > 0) return entered;
  const computed = Number(farm?.computed_area_acres);
  if (Number.isFinite(computed) && computed > 0) return computed;
  return 0;
}

/** Round to 2dp without float dust (0.1 + 0.2 style). */
function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Collapse a farmer's farms into the figures every caller needs.
 *
 * `totalAcres` is the one used for scoring. It is 0 — not null — when the
 * farmer has no farm at all, and callers must treat 0 as "cannot score on
 * land yet" rather than dividing by it.
 */
function summarizeFarms(embedded) {
  const farms = toFarmList(embedded);
  const primary = farms.find((f) => f.is_primary) || farms[0] || null;

  let totalAcres = 0;
  let mappedAcres = 0;
  let mappedCount = 0;
  const crops = [];

  for (const farm of farms) {
    const acres = farmAcres(farm);
    totalAcres += acres;
    if (farm.gps_mapped) {
      mappedCount += 1;
      mappedAcres += acres;
    }
    if (farm.crop_type) crops.push(farm.crop_type);
    for (const crop of farm.secondary_crops || []) crops.push(crop);
  }

  return {
    farms,
    primary,
    farmCount: farms.length,
    totalAcres: round2(totalAcres),
    mappedAcres: round2(mappedAcres),
    mappedCount,
    /** True only when every farm has a walked boundary. */
    fullyMapped: farms.length > 0 && mappedCount === farms.length,
    /** Distinct crops across all farms, primary crop first. */
    crops: [...new Set(crops)],
    /** The farmer's main crop: the primary farm's crop_type. */
    primaryCrop: primary?.crop_type || null,
  };
}

/**
 * Display label for a farm within its set.
 *
 * Position is 1-based over the same order `toFarmList` produces, so the label
 * an agent sees matches the order of the cards on screen.
 */
function farmLabel(farm, index) {
  const explicit = typeof farm?.farm_label === 'string' ? farm.farm_label.trim() : '';
  return explicit || `Farm ${index + 1}`;
}

/** Shape one farm for an API response, label included. */
function shapeFarm(farm, index) {
  if (!farm) return null;
  return {
    id: farm.id,
    label: farmLabel(farm, index),
    farm_label: farm.farm_label ?? null,
    is_primary: !!farm.is_primary,
    farm_size_acres: farm.farm_size_acres,
    computed_area_acres: farm.computed_area_acres,
    acres: farmAcres(farm),
    gps_lat: farm.gps_lat,
    gps_lng: farm.gps_lng,
    gps_polygon: farm.gps_polygon,
    gps_mapped: !!farm.gps_mapped,
    plot_count: farm.plot_count,
    soil_type: farm.soil_type,
    irrigation_access: farm.irrigation_access,
    water_source: farm.water_source,
    crop_type: farm.crop_type,
    secondary_crops: farm.secondary_crops || [],
    land_ownership: farm.land_ownership,
    years_experience: farm.years_experience,
    farm_photo_urls: farm.farm_photo_urls || [],
    land_document_url: farm.land_document_url,
    land_document_type: farm.land_document_type,
    created_at: farm.created_at,
    updated_at: farm.updated_at,
  };
}

/** Shape a whole farm set for an API response. */
function shapeFarms(embedded) {
  return toFarmList(embedded).map((farm, i) => shapeFarm(farm, i));
}

/**
 * A cooperative's land total.
 *
 * The v2 flow removed the "estimated land size" question; the total is summed
 * from the farms of linked farmers instead. `farmers` is a list of rows each
 * carrying an embedded `farm_profiles`.
 *
 * "Eligible" in the specification means a farmer who counts toward the
 * cooperative — one that still belongs to it and has at least one farm.
 * Farmers with no farm contribute nothing but are reported separately, since
 * "40 members, 31 with farms" is the number an agent needs to chase.
 */
function cooperativeLandTotal(farmers) {
  const list = Array.isArray(farmers) ? farmers : [];
  let totalAcres = 0;
  let farmCount = 0;
  let membersWithFarms = 0;

  for (const farmer of list) {
    const summary = summarizeFarms(farmer?.farm_profiles);
    if (summary.farmCount === 0) continue;
    membersWithFarms += 1;
    farmCount += summary.farmCount;
    totalAcres += summary.totalAcres;
  }

  return {
    total_land_acres: round2(totalAcres),
    farm_count: farmCount,
    members_with_farms: membersWithFarms,
    members_without_farms: Math.max(0, list.length - membersWithFarms),
  };
}

module.exports = {
  toFarmList,
  farmAcres,
  summarizeFarms,
  farmLabel,
  shapeFarm,
  shapeFarms,
  cooperativeLandTotal,
};
