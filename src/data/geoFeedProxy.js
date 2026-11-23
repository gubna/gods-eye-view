/**
 * Server-side proxy for the public GeoJSON feeds (Node only; loaded by
 * vite.config.js, never by the browser).
 *
 * Routes:
 *   GET /api/geofeed          → [{id, name, needsKey, hasKey, keyEnv, signup}]
 *   GET /api/geofeed/<id>     → normalized FeatureCollection
 *
 * The id selects an upstream from geoFeedCatalog.js or config/geojson_layers.json;
 * nothing in the request can choose a URL. Keys are read from process.env per
 * request and attached here, so they never reach the browser. A missing key is
 * 503 {error:'no_key'}; an upstream failure serves the last good body
 * (X-GEV-Cache: STALE-ERROR) before it gives up with 502.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  GEO_FEEDS,
  normalizeCustomFeeds,
  normalizeFeedBody,
  upstreamRequest,
} from './geoFeedCatalog.js';

const MAX_UPSTREAM_BYTES = 40 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 30_000;

/**
 * @param {{configPath?: string, env?: Record<string,string|undefined>, fetchImpl?: typeof fetch, now?: () => number}} [options]
 */
export function createGeoFeedHandler({
  configPath = path.join(process.cwd(), 'config', 'geojson_layers.json'),
  env = process.env,
  fetchImpl = fetch,
  now = Date.now,
} = {}) {
  const feeds = new Map(GEO_FEEDS.map((feed) => [feed.id, feed]));
  for (const feed of loadCustomFeeds(configPath)) feeds.set(feed.id, feed);

  /** @type {Map<string, {at: number, body: string}>} */
  const cache = new Map();
  /** @type {Map<string, Promise<{at: number, body: string}>>} */
  const inflight = new Map();

  async function refresh(feed, request) {
    const upstream = await fetchImpl(request.url, {
      headers: request.headers,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
    const declared = Number(upstream.headers?.get?.('content-length'));
    if (declared > MAX_UPSTREAM_BYTES) throw Object.assign(new Error('upstream too large'), { status: 502 });
    const text = await upstream.text();
    if (!upstream.ok) {
      throw Object.assign(new Error(`upstream HTTP ${upstream.status}`), { status: 502 });
    }
    if (text.length > MAX_UPSTREAM_BYTES) throw Object.assign(new Error('upstream too large'), { status: 502 });
    const collection = normalizeFeedBody(feed, JSON.parse(text));
    const entry = { at: now(), body: JSON.stringify(collection) };
    cache.set(feed.id, entry);
    return entry;
  }

  function send(res, status, body, cacheState) {
    res.writeHead(status, {
      'Content-Type': status === 200 ? 'application/geo+json' : 'application/json',
      'Cache-Control': status === 200 ? 'public, max-age=60' : 'no-store',
      'X-GEV-Cache': cacheState,
    });
    res.end(body);
  }

  return async function handle(req, res) {
    if (req.method !== 'GET') {
      send(res, 405, JSON.stringify({ error: 'method_not_allowed' }), 'NONE');
      return;
    }
    const id = decodeURIComponent(String(req.url || '/').split('?')[0].replace(/^\/+|\/+$/g, ''));

    if (!id) {
      const index = [...feeds.values()].map((feed) => ({
        id: feed.id,
        name: feed.name,
        needsKey: Boolean(feed.key && !feed.key.fallback),
        hasKey: !feed.key || Boolean(String(env[feed.key.env] || '').trim()),
        keyEnv: feed.key?.env || null,
        signup: feed.key?.signup || null,
      }));
      send(res, 200, JSON.stringify(index), 'NONE');
      return;
    }

    const feed = feeds.get(id);
    if (!feed) {
      send(res, 404, JSON.stringify({ error: 'unknown_feed', id }), 'NONE');
      return;
    }
    const request = upstreamRequest(feed, env);
    if (!request) {
      send(res, 503, JSON.stringify({ error: 'no_key', env: feed.key.env, signup: feed.key.signup || null }), 'NONE');
      return;
    }

    const cached = cache.get(id);
    if (cached && now() - cached.at < feed.refreshMs) {
      send(res, 200, cached.body, 'HIT');
      return;
    }
    let shared = true;
    let pending = inflight.get(id);
    if (!pending) {
      shared = false;
      pending = refresh(feed, request).finally(() => inflight.delete(id));
      inflight.set(id, pending);
    }
    try {
      const fresh = await pending;
      send(res, 200, fresh.body, shared ? 'INFLIGHT' : 'MISS');
    } catch (error) {
      if (cached) {
        if (!shared) console.warn(`[geofeed] ${id} refresh failed (${error?.message || error}) — serving stale`);
        send(res, 200, cached.body, 'STALE-ERROR');
        return;
      }
      if (!shared) console.warn(`[geofeed] ${id} unavailable: ${error?.message || error}`);
      send(res, error?.status || 502, JSON.stringify({ error: 'upstream_unavailable', message: String(error?.message || error) }), 'NONE');
    }
  };
}

/** @returns {import('vite').Plugin} */
export function geoFeedProxy() {
  let handler = null;
  const install = (middlewares) => {
    middlewares.use('/api/geofeed', (req, res) => {
      handler ||= createGeoFeedHandler();
      void handler(req, res);
    });
  };
  return {
    name: 'geofeed-proxy',
    configureServer(server) {
      install(server.middlewares);
    },
    configurePreviewServer(server) {
      install(server.middlewares);
    },
  };
}

function loadCustomFeeds(configPath) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') console.warn(`[geofeed] ignoring ${configPath}: ${error?.message || error}`);
    return [];
  }
  const { feeds, rejected } = normalizeCustomFeeds(raw);
  for (const reason of rejected) console.warn(`[geofeed] skipped custom layer — ${reason}`);
  return feeds;
}
