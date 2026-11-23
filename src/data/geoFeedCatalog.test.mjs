import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GEO_FEEDS,
  GEO_FEED_MAX_FEATURES,
  normalizeCustomFeeds,
  normalizeFeedBody,
  upstreamRequest,
} from './geoFeedCatalog.js';
import { createGeoFeedHandler } from './geoFeedProxy.js';
import { LAYER_GROUPS } from './layerGroups.js';

const feed = (id) => GEO_FEEDS.find((f) => f.id === id);
const point = (lon, lat, properties = {}) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon, lat] }, properties });

test('every built-in feed has a unique id, an https upstream, and a panel group', () => {
  const ids = GEO_FEEDS.map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length);
  const grouped = new Set(LAYER_GROUPS.flatMap((g) => g.layers));
  for (const f of GEO_FEEDS) {
    assert.match(f.id, /^feed-[a-z0-9-]+$/);
    assert.equal(new URL(f.upstream).protocol, 'https:', f.id);
    assert.ok(f.refreshMs >= 60_000, `${f.id} refreshes at most once a minute`);
    assert.ok(grouped.has(f.id), `${f.id} is filed in a layer group`);
  }
});

test('normalize drops geometry-less features, caps the count, and names every feature', () => {
  const nws = feed('feed-nws-alerts');
  const out = normalizeFeedBody(nws, {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', geometry: null, properties: { event: 'Zone-only Advisory' } },
      { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }, properties: { event: 'Tornado Warning' } },
    ],
  });
  assert.equal(out.features.length, 1);
  assert.equal(out.features[0].properties.name, 'Tornado Warning');

  const many = { type: 'FeatureCollection', features: Array.from({ length: GEO_FEED_MAX_FEATURES + 5 }, (_, i) => point(0, 0, { name: `p${i}` })) };
  const capped = normalizeFeedBody(feed('feed-volcanoes'), many);
  assert.equal(capped.features.length, GEO_FEED_MAX_FEATURES);
  assert.equal(capped.truncated, true);

  assert.throws(() => normalizeFeedBody(feed('feed-volcanoes'), { error: 'nope' }), /not a GeoJSON FeatureCollection/);
});

test('an upstream name property is never overwritten by the label', () => {
  const out = normalizeFeedBody({ ...feed('feed-eonet') }, { type: 'FeatureCollection', features: [point(1, 2, { name: 'Kept', title: 'Other' })] });
  assert.equal(out.features[0].properties.name, 'Kept');
});

test('the NHC adapter turns active storms into named points', () => {
  const out = normalizeFeedBody(feed('feed-nhc-storms'), {
    activeStorms: [
      { name: 'Milton', classification: 'HU', latitudeNumeric: 23.1, longitudeNumeric: -88.4, intensity: '145', pressure: '920', movementDir: 80, movementSpeed: 9 },
      { name: 'Broken', latitudeNumeric: null, longitudeNumeric: null },
    ],
  });
  assert.equal(out.features.length, 1);
  assert.deepEqual(out.features[0].geometry.coordinates, [-88.4, 23.1]);
  assert.equal(out.features[0].properties.name, 'HU Milton');
  assert.equal(normalizeFeedBody(feed('feed-nhc-storms'), { activeStorms: [] }).features.length, 0);
});

test('the iNaturalist adapter parses "lat,lon" strings', () => {
  const out = normalizeFeedBody(feed('feed-inaturalist'), {
    results: [{ id: 7, observed_on: '2026-11-24', location: '-37.6999,145.1124', taxon: { name: 'Heteronympha merope', preferred_common_name: 'Common Brown' } }],
  });
  assert.deepEqual(out.features[0].geometry.coordinates, [145.1124, -37.6999]);
  assert.equal(out.features[0].properties.name, 'Common Brown');
  assert.equal(out.features[0].properties.url, 'https://www.inaturalist.org/observations/7');
});

test('the JPL fireball adapter applies hemisphere letters as signs', () => {
  const out = normalizeFeedBody(feed('feed-fireballs'), {
    fields: ['date', 'energy', 'impact-e', 'lat', 'lat-dir', 'lon', 'lon-dir', 'alt', 'vel'],
    data: [
      ['2026-10-04 03:14:45', '5.4', '0.18', '41.8', 'S', '173.1', 'W', '26.9', '13.8'],
      ['2026-09-01 00:00:00', '1', '0.05', null, null, null, null, null, null],
    ],
  });
  assert.equal(out.features.length, 1, 'rows without a location are dropped');
  assert.deepEqual(out.features[0].geometry.coordinates, [-173.1, -41.8]);
  assert.equal(out.features[0].properties.name, 'Fireball 2026-10-04 · 0.18 kt');
});

test('the WAQI adapter surfaces an API error instead of an empty layer', () => {
  assert.throws(() => normalizeFeedBody(feed('feed-waqi'), { status: 'error', data: 'Invalid key' }), /WAQI Invalid key/);
  const out = normalizeFeedBody(feed('feed-waqi'), { status: 'ok', data: [{ uid: 1, lat: 40, lon: -80, aqi: '42', station: { name: 'Wheeling' } }] });
  assert.equal(out.features[0].properties.name, 'Wheeling · AQI 42');
});

test('keys go in the header or query the feed names, with fallbacks and refusals', () => {
  assert.equal(upstreamRequest(feed('feed-openaq'), {}), null, 'no key, no fallback → refuse');
  const openaq = upstreamRequest(feed('feed-openaq'), { OPENAQ_API_KEY: ' abc ' });
  assert.equal(openaq.headers['X-API-Key'], 'abc');
  assert.ok(!openaq.url.includes('abc'), 'a header key never lands in the URL');

  assert.match(upstreamRequest(feed('feed-waqi'), { WAQI_TOKEN: 'tok' }).url, /[?&]token=tok/);
  assert.match(upstreamRequest(feed('feed-nrel-ev'), {}).url, /[?&]api_key=DEMO_KEY/);
  assert.match(upstreamRequest(feed('feed-nrel-ev'), { NREL_API_KEY: 'mine' }).url, /[?&]api_key=mine/);
  assert.equal(upstreamRequest(feed('feed-gdacs'), {}).url, feed('feed-gdacs').upstream);
});

test('custom feeds are namespaced, https-only, and deduplicated', () => {
  const { feeds, rejected } = normalizeCustomFeeds({
    layers: [
      { id: 'My Quakes!', url: 'https://example.org/q.geojson', labelProperty: 'title', refreshMinutes: 5 },
      { id: 'my-quakes', url: 'https://example.org/dup.geojson' },
      { id: 'plain', url: 'http://example.org/insecure.geojson' },
      { url: 'https://example.org/anon.geojson' },
    ],
  });
  assert.equal(feeds.length, 1);
  assert.equal(feeds[0].id, 'feed-custom-my-quakes');
  assert.equal(feeds[0].refreshMs, 5 * 60_000);
  assert.equal(feeds[0].label({ title: 'M5' }), 'M5');
  assert.equal(rejected.length, 3);
  assert.deepEqual(normalizeCustomFeeds(null), { feeds: [], rejected: [] });
});

function fakeRes() {
  return {
    status: 0,
    headers: {},
    body: '',
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body) { this.body = body; },
  };
}

async function call(handler, url) {
  const res = fakeRes();
  await handler({ method: 'GET', url }, res);
  return res;
}

test('the proxy refuses unknown ids and keyless keyed feeds without touching upstream', async () => {
  let fetches = 0;
  const handler = createGeoFeedHandler({ configPath: '/nonexistent.json', env: {}, fetchImpl: async () => { fetches += 1; } });
  assert.equal((await call(handler, '/feed-nope')).status, 404);
  const keyless = await call(handler, '/feed-openaq');
  assert.equal(keyless.status, 503);
  assert.equal(JSON.parse(keyless.body).env, 'OPENAQ_API_KEY');
  assert.equal(fetches, 0);
});

test('the proxy index reports which feeds still need a key', async () => {
  const handler = createGeoFeedHandler({ configPath: '/nonexistent.json', env: { WAQI_TOKEN: 'x' }, fetchImpl: async () => {} });
  const index = JSON.parse((await call(handler, '/')).body);
  const byId = Object.fromEntries(index.map((row) => [row.id, row]));
  assert.equal(byId['feed-openaq'].hasKey, false);
  assert.equal(byId['feed-waqi'].hasKey, true);
  assert.equal(byId['feed-nrel-ev'].needsKey, false, 'DEMO_KEY covers it');
  assert.equal(byId['feed-gdacs'].needsKey, false);
});

test('the proxy caches for the feed TTL and serves stale data when upstream fails', async () => {
  let clock = 1_000_000;
  let fetches = 0;
  let fail = false;
  const handler = createGeoFeedHandler({
    configPath: '/nonexistent.json',
    env: {},
    now: () => clock,
    fetchImpl: async () => {
      fetches += 1;
      if (fail) return { ok: false, status: 500, headers: new Map(), text: async () => 'boom' };
      return { ok: true, status: 200, headers: new Map(), text: async () => JSON.stringify({ type: 'FeatureCollection', features: [point(1, 2, { Volcano_Name: 'Etna' })] }) };
    },
  });
  const first = await call(handler, '/feed-volcanoes');
  assert.equal(first.status, 200);
  assert.equal(first.headers['X-GEV-Cache'], 'MISS');
  assert.equal(JSON.parse(first.body).features[0].properties.name, 'Etna');

  assert.equal((await call(handler, '/feed-volcanoes')).headers['X-GEV-Cache'], 'HIT');
  assert.equal(fetches, 1);

  clock += feed('feed-volcanoes').refreshMs + 1;
  fail = true;
  const stale = await call(handler, '/feed-volcanoes');
  assert.equal(stale.status, 200);
  assert.equal(stale.headers['X-GEV-Cache'], 'STALE-ERROR');
  assert.equal(fetches, 2);

  const cold = await call(handler, '/feed-gdacs');
  assert.equal(cold.status, 502, 'no cache to fall back on → an honest error');
});

test('concurrent requests for one feed share a single upstream fetch', async () => {
  let fetches = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const handler = createGeoFeedHandler({
    configPath: '/nonexistent.json',
    env: {},
    fetchImpl: async () => {
      fetches += 1;
      await gate;
      return { ok: true, status: 200, headers: new Map(), text: async () => JSON.stringify({ type: 'FeatureCollection', features: [] }) };
    },
  });
  const pending = [call(handler, '/feed-eonet'), call(handler, '/feed-eonet')];
  release();
  const [a, b] = await Promise.all(pending);
  assert.equal(fetches, 1);
  assert.deepEqual([a.headers['X-GEV-Cache'], b.headers['X-GEV-Cache']].sort(), ['INFLIGHT', 'MISS']);
});
