/**
 * Public GeoJSON feeds, served to the globe through `/api/geofeed/<id>`.
 *
 * This module is shared: the browser reads it to register one layer per feed,
 * and the Vite server reads it to know which upstream each id may fetch. That
 * is why it imports neither Cesium nor Node — and why the proxy only ever
 * fetches URLs written here or in config/geojson_layers.json, never one a
 * request names.
 *
 * Adding a feed is one entry. A feed whose upstream already speaks GeoJSON
 * needs only `upstream` and `label`; anything else adds a `toGeoJson` adapter.
 * Keyed feeds name the env var that holds the key; without it the proxy
 * answers 503 {error:'no_key'} and the layer chip reads UNAVAILABLE instead of
 * showing an empty globe.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;

/** Hard ceiling on features per feed — the bundled datacenter layer (≈4.4k) is the proven load. */
export const GEO_FEED_MAX_FEATURES = 5000;

export const GEO_FEED_USER_AGENT = 'gods-eye-view (+https://github.com/uhrichsam4/gods-eye-view)';

/**
 * @typedef {object} GeoFeedKey
 * @property {string} env        Env var holding the key.
 * @property {string} [param]    Query parameter the key goes in.
 * @property {string} [header]   Request header the key goes in.
 * @property {string} [fallback] Public key used when the env var is empty (e.g. NREL's DEMO_KEY).
 * @property {string} signup     Where to get a free key.
 */

/**
 * @typedef {object} GeoFeed
 * @property {string} id
 * @property {string} name
 * @property {string} group      Layer-panel group id (see layerGroups.js).
 * @property {string} icon
 * @property {string} color
 * @property {string} source     Chip credit line.
 * @property {number} refreshMs  Server cache TTL and client reload cadence.
 * @property {string} upstream
 * @property {GeoFeedKey} [key]
 * @property {Record<string,string>} [headers]
 * @property {(body: any) => {type:'FeatureCollection', features: Array<object>}} [toGeoJson]
 * @property {(props: object) => string} [label]
 * @property {number} [maxFeatures]
 */

/** @type {ReadonlyArray<GeoFeed>} */
export const GEO_FEEDS = Object.freeze([
  {
    id: 'feed-gdacs',
    name: 'GDACS Disaster Alerts',
    group: 'earth',
    icon: '⚠',
    color: '#ff6a00',
    source: 'GDACS · UN/EC · LIVE',
    refreshMs: 15 * MIN,
    upstream: 'https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH?eventlist=EQ;TC;FL;VO;DR;WF&alertlevel=Orange;Red',
    label: (p) => p.name || p.eventname,
  },
  {
    id: 'feed-eonet',
    name: 'NASA EONET Natural Events',
    group: 'earth',
    icon: '◉',
    color: '#ffb347',
    source: 'NASA EONET · LIVE',
    refreshMs: 30 * MIN,
    upstream: 'https://eonet.gsfc.nasa.gov/api/v3/events/geojson?status=open&days=60',
    label: (p) => p.title,
  },
  {
    id: 'feed-volcanoes',
    name: 'Holocene Volcanoes',
    group: 'earth',
    icon: '▲',
    color: '#ff3b30',
    source: 'Smithsonian GVP',
    refreshMs: 24 * HOUR,
    upstream: 'https://webservices.volcano.si.edu/geoserver/GVP-VOTW/ows?service=WFS&version=2.0.0&request=GetFeature&typeName=GVP-VOTW:Smithsonian_VOTW_Holocene_Volcanoes&outputFormat=application/json',
    label: (p) => p.Volcano_Name,
  },
  {
    id: 'feed-wildfire-perimeters',
    name: 'US Wildfire Perimeters',
    group: 'earth',
    icon: '▧',
    color: '#ff2d55',
    source: 'NIFC WFIGS · LIVE',
    refreshMs: 30 * MIN,
    // Simplified server-side: the raw perimeters are ~8.6 MB, these ~200 KB.
    upstream: 'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query?where=1%3D1&outFields=poly_IncidentName,attr_IncidentSize,attr_PercentContained&geometryPrecision=4&maxAllowableOffset=0.002&f=geojson',
    label: (p) => (p.poly_IncidentName ? `${p.poly_IncidentName} Fire` : ''),
  },
  {
    id: 'feed-spc-outlook',
    name: 'Severe Storm Outlook (US)',
    group: 'earth',
    icon: '⛈',
    color: '#c1e9c1',
    source: 'NOAA SPC · Day 1',
    refreshMs: 30 * MIN,
    upstream: 'https://www.spc.noaa.gov/products/outlook/day1otlk_cat.nolyr.geojson',
    label: (p) => p.LABEL2,
  },
  {
    id: 'feed-nws-alerts',
    name: 'NWS Weather Warnings (US)',
    group: 'earth',
    icon: '⚡',
    color: '#ffd60a',
    source: 'NOAA NWS · LIVE',
    refreshMs: 5 * MIN,
    // Most alerts are zone-coded with null geometry; only drawn polygons survive.
    upstream: 'https://api.weather.gov/alerts/active?status=actual',
    label: (p) => p.event,
  },
  {
    id: 'feed-nhc-storms',
    name: 'Active Tropical Cyclones',
    group: 'earth',
    icon: '🌀',
    color: '#5ac8fa',
    source: 'NOAA NHC · LIVE',
    refreshMs: 30 * MIN,
    upstream: 'https://www.nhc.noaa.gov/CurrentStorms.json',
    toGeoJson: (body) => pointCollection(body?.activeStorms, (s) => ({
      lat: s.latitudeNumeric,
      lon: s.longitudeNumeric,
      properties: {
        name: [s.classification, s.name].filter(Boolean).join(' '),
        intensityKt: s.intensity,
        pressureMb: s.pressure,
        movement: s.movementDir != null ? `${s.movementDir}° @ ${s.movementSpeed} kt` : null,
        lastUpdate: s.lastUpdate,
      },
    })),
  },
  {
    id: 'feed-inaturalist',
    name: 'Wildlife Sightings',
    group: 'life',
    icon: '🐾',
    color: '#34c759',
    source: 'iNaturalist · research grade',
    refreshMs: 30 * MIN,
    upstream: 'https://api.inaturalist.org/v2/observations?quality_grade=research&per_page=200&order_by=observed_on&geo=true&fields=id,observed_on,location,taxon.name,taxon.preferred_common_name,taxon.iconic_taxon_name',
    toGeoJson: (body) => pointCollection(body?.results, (o) => {
      const [lat, lon] = String(o.location || '').split(',').map((v) => v.trim());
      return {
        id: o.id,
        lat,
        lon,
        properties: {
          name: o.taxon?.preferred_common_name || o.taxon?.name,
          scientificName: o.taxon?.name,
          group: o.taxon?.iconic_taxon_name,
          observedOn: o.observed_on,
          url: o.id ? `https://www.inaturalist.org/observations/${o.id}` : null,
        },
      };
    }),
  },
  {
    id: 'feed-fireballs',
    name: 'Fireballs',
    group: 'space',
    icon: '☄',
    color: '#ff9f0a',
    source: 'NASA JPL CNEOS',
    refreshMs: 6 * HOUR,
    upstream: 'https://ssd-api.jpl.nasa.gov/fireball.api?req-loc=true&limit=500',
    toGeoJson: fireballsToGeoJson,
  },
  {
    id: 'feed-openaq',
    name: 'Air Quality Monitors',
    group: 'health',
    icon: '◌',
    color: '#64d2ff',
    source: 'OpenAQ',
    refreshMs: 6 * HOUR,
    upstream: 'https://api.openaq.org/v3/locations?limit=1000&monitor=true',
    key: { env: 'OPENAQ_API_KEY', header: 'X-API-Key', signup: 'https://explore.openaq.org/register' },
    toGeoJson: (body) => pointCollection(body?.results, (l) => ({
      id: l.id,
      lat: l.coordinates?.latitude,
      lon: l.coordinates?.longitude,
      properties: {
        name: l.name || l.locality,
        country: l.country?.name,
        provider: l.provider?.name,
        parameters: (l.sensors || []).map((s) => s.parameter?.displayName || s.parameter?.name).filter(Boolean).join(', '),
        lastSeen: l.datetimeLast?.utc,
      },
    })),
  },
  {
    id: 'feed-waqi',
    name: 'Air Quality Index',
    group: 'health',
    icon: '◍',
    color: '#30d158',
    source: 'WAQI · LIVE',
    refreshMs: 30 * MIN,
    upstream: 'https://api.waqi.info/map/bounds?latlng=-85,-180,85,180&networks=all',
    key: { env: 'WAQI_TOKEN', param: 'token', signup: 'https://aqicn.org/data-platform/token/' },
    toGeoJson: (body) => {
      if (body?.status !== 'ok') throw new Error(`WAQI ${body?.data || body?.status || 'error'}`);
      return pointCollection(body.data, (s) => ({
        id: s.uid,
        lat: s.lat,
        lon: s.lon,
        properties: {
          name: `${s.station?.name || 'Station'} · AQI ${s.aqi}`,
          aqi: s.aqi,
          updated: s.station?.time,
        },
      }));
    },
  },
  {
    id: 'feed-nrel-ev',
    name: 'EV Fast Chargers (US)',
    group: 'city',
    icon: '⚡',
    color: '#0a84ff',
    source: 'NREL AFDC',
    refreshMs: 24 * HOUR,
    upstream: 'https://developer.nrel.gov/api/alt-fuel-stations/v1.geojson?fuel_type=ELEC&ev_charging_level=dc_fast&status=E&limit=all',
    // DEMO_KEY works out of the box at ~30 requests/hour; the 24 h cache keeps far under that.
    key: { env: 'NREL_API_KEY', param: 'api_key', fallback: 'DEMO_KEY', signup: 'https://developer.nrel.gov/signup/' },
    label: (p) => p.station_name,
  },
]);

/**
 * Validate entries from config/geojson_layers.json into feed definitions.
 * Bad entries are dropped with a reason rather than failing the whole list.
 *
 * @param {unknown} raw
 * @returns {{feeds: Array<GeoFeed>, rejected: Array<string>}}
 */
export function normalizeCustomFeeds(raw) {
  const list = Array.isArray(raw?.layers) ? raw.layers : Array.isArray(raw) ? raw : [];
  const feeds = [];
  const rejected = [];
  const taken = new Set(GEO_FEEDS.map((f) => f.id));
  for (const entry of list) {
    const slug = String(entry?.id || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
    const id = slug ? `feed-custom-${slug}` : '';
    let url = null;
    try { url = new URL(String(entry?.url || '')); } catch { /* rejected below */ }
    if (!id) { rejected.push('entry without an id'); continue; }
    if (taken.has(id)) { rejected.push(`${id}: duplicate id`); continue; }
    if (!url || url.protocol !== 'https:') { rejected.push(`${id}: url must be https`); continue; }
    taken.add(id);
    const labelKey = typeof entry.labelProperty === 'string' ? entry.labelProperty : null;
    feeds.push({
      id,
      name: String(entry.name || slug),
      group: 'other',
      icon: String(entry.icon || '◆'),
      color: /^#[0-9a-f]{3,8}$/i.test(entry.color || '') ? entry.color : '#bf5af2',
      source: String(entry.source || url.hostname),
      refreshMs: Math.max(MIN, Number(entry.refreshMinutes) * MIN || 60 * MIN),
      upstream: url.href,
      key: entry.keyEnv ? {
        env: String(entry.keyEnv),
        param: entry.keyParam ? String(entry.keyParam) : undefined,
        header: entry.keyHeader ? String(entry.keyHeader) : undefined,
        signup: String(entry.keySignup || ''),
      } : undefined,
      label: labelKey ? (p) => p[labelKey] : undefined,
    });
  }
  return { feeds, rejected };
}

/**
 * Turn an upstream body into the FeatureCollection the globe draws: run the
 * feed's adapter, drop geometry-less features, cap the count, and make sure
 * every feature has a `name` the label engine can read.
 *
 * @param {GeoFeed} feed
 * @param {unknown} body - Parsed upstream JSON.
 * @returns {{type:'FeatureCollection', features: Array<object>, truncated: boolean}}
 */
export function normalizeFeedBody(feed, body) {
  const collection = feed.toGeoJson ? feed.toGeoJson(body) : body;
  if (collection?.type !== 'FeatureCollection' || !Array.isArray(collection.features)) {
    throw new Error('upstream is not a GeoJSON FeatureCollection');
  }
  const max = Math.min(feed.maxFeatures || GEO_FEED_MAX_FEATURES, GEO_FEED_MAX_FEATURES);
  const drawable = collection.features.filter((f) => f && f.type === 'Feature' && f.geometry);
  const features = drawable.slice(0, max).map((f) => {
    const properties = { ...(f.properties || {}) };
    const label = feed.label ? feed.label(properties) : null;
    if (label && !properties.name) properties.name = String(label);
    return { type: 'Feature', id: f.id, geometry: f.geometry, properties };
  });
  return { type: 'FeatureCollection', features, truncated: drawable.length > max };
}

/**
 * Build the upstream request for a feed. Returns null when the feed needs a
 * key that is not configured (and has no public fallback).
 *
 * @param {GeoFeed} feed
 * @param {Record<string, string|undefined>} env
 * @returns {{url: string, headers: Record<string,string>}|null}
 */
export function upstreamRequest(feed, env) {
  const url = new URL(feed.upstream);
  const headers = { 'User-Agent': GEO_FEED_USER_AGENT, Accept: 'application/geo+json, application/json', ...(feed.headers || {}) };
  if (feed.key) {
    const value = String(env[feed.key.env] || '').trim() || feed.key.fallback || '';
    if (!value) return null;
    if (feed.key.header) headers[feed.key.header] = value;
    else url.searchParams.set(feed.key.param || 'api_key', value);
  }
  return { url: url.href, headers };
}

/**
 * @param {unknown} rows
 * @param {(row: any) => {id?: any, lat: unknown, lon: unknown, properties: object}} project
 */
function pointCollection(rows, project) {
  const features = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const p = project(row);
    const lat = coordinate(p.lat);
    const lon = coordinate(p.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    features.push({
      type: 'Feature',
      id: p.id,
      geometry: { type: 'Point', coordinates: [lon, lat] },
      properties: p.properties,
    });
  }
  return { type: 'FeatureCollection', features };
}

/** Number(null) and Number('') are 0 — a real place in the Gulf of Guinea — so absent stays NaN. */
function coordinate(value) {
  if (value === null || value === undefined || value === '') return Number.NaN;
  return Number(value);
}

/** JPL returns rows of strings keyed by a `fields` header, with hemisphere letters instead of signs. */
function fireballsToGeoJson(body) {
  const fields = Array.isArray(body?.fields) ? body.fields : [];
  const at = (row, name) => row[fields.indexOf(name)];
  return pointCollection(body?.data, (row) => {
    const lat = coordinate(at(row, 'lat')) * (at(row, 'lat-dir') === 'S' ? -1 : 1);
    const lon = coordinate(at(row, 'lon')) * (at(row, 'lon-dir') === 'W' ? -1 : 1);
    const date = at(row, 'date');
    const kt = at(row, 'impact-e');
    return {
      id: date,
      lat,
      lon,
      properties: {
        name: `Fireball ${String(date || '').slice(0, 10)}${kt ? ` · ${kt} kt` : ''}`,
        date,
        impactEnergyKt: kt != null ? Number(kt) : null,
        radiatedEnergy1e10J: at(row, 'energy') != null ? Number(at(row, 'energy')) : null,
        altitudeKm: at(row, 'alt') != null ? Number(at(row, 'alt')) : null,
        velocityKmS: at(row, 'vel') != null ? Number(at(row, 'vel')) : null,
      },
    };
  });
}
