import { createLocalGeoJsonLayer } from './localGeojson.js';
import { createFirmsHeatmapLayer } from './firmsHeatmap.js';
import submarineCablesLayer from './telegeographySubmarineCables.js';
import { GEO_FEEDS, normalizeCustomFeeds } from './geoFeedCatalog.js';
import customLayerConfig from '../../config/geojson_layers.json';

// Use Vite's ?url import to properly resolve these assets in dev and build
import datacentersUrl from './local_data/datacenters/datacenters.geojsonl?url';
import damsUrl from './local_data/dams/dams.geojsonl?url';

/**
 * Registry of local GeoJSON datasets.
 * These are lazily loaded natively into Cesium when enabled.
 */
const datacenters = createLocalGeoJsonLayer({
  id: 'local-datacenters',
  url: datacentersUrl,
  name: 'Datacenters',
  color: '#00ffff', // Cyan
  icon: '▣',
  source: 'Local',
  labels: true,
  labelMax: 700,
  labelGridPx: 138,
});

const dams = createLocalGeoJsonLayer({
  id: 'local-dams',
  url: damsUrl,
  name: 'Dams',
  color: '#0088ff', // Blue
  icon: '▰',
  source: 'USACE',
  labels: true,
  labelMax: 900,
  labelGridPx: 132,
});

// Live NASA FIRMS fires (VIIRS ×3 NRT via the /api/firms proxy). The id keeps
// the historical `local-` prefix for persistence + voice-tool-enum compat,
// but the data is NOT bundled anymore — it needs FIRMS_MAP_KEY server-side.
const fires = createFirmsHeatmapLayer({
  id: 'local-firms',
  name: 'FIRMS Active Fires',
  icon: '▲',
  source: 'NASA FIRMS · LIVE',
});

// Live public feeds, fetched through /api/geofeed/<id> (see geoFeedCatalog.js).
// Custom URLs from config/geojson_layers.json ride the same proxy; the server
// reads the same file, so only URLs listed there can ever be fetched.
const { feeds: customFeeds } = normalizeCustomFeeds(customLayerConfig);
const feedLayers = [...GEO_FEEDS, ...customFeeds].map((feed) => createLocalGeoJsonLayer({
  id: feed.id,
  url: `/api/geofeed/${encodeURIComponent(feed.id)}`,
  name: feed.name,
  color: feed.color,
  icon: feed.icon,
  source: feed.source,
  refreshMs: feed.refreshMs,
  labels: true,
}));

// Drop-in files: any .geojson / .geojsonl in local_data/user_layers/ becomes a
// layer named after the file, bundled with the build like datacenters/dams.
const userFiles = import.meta.glob('./local_data/user_layers/*.{geojson,geojsonl}', {
  query: '?url',
  import: 'default',
  eager: true,
});
const userLayers = Object.entries(userFiles)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([file, fileUrl]) => {
    const stem = file.split('/').pop().replace(/\.(geojsonl?)$/i, '');
    return createLocalGeoJsonLayer({
      id: `user-${stem.toLowerCase().replace(/[^a-z0-9-]+/g, '-')}`,
      url: fileUrl,
      name: stem.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      color: '#bf5af2',
      icon: '◆',
      source: 'Your file',
    });
  });

export default [
  datacenters,
  dams,
  submarineCablesLayer,
  fires,
  ...feedLayers,
  ...userLayers,
];
