# Your own GeoJSON layers

Drop any `.geojson` (a FeatureCollection) or `.geojsonl` (one Feature per line)
file into this folder and it shows up in the DATA LAYERS panel under **OTHER**,
named after the file: `bike_routes.geojson` becomes **Bike Routes** with the id
`user-bike-routes`.

- Coordinates must be WGS84 longitude/latitude (EPSG:4326), as GeoJSON requires.
- Labels read each feature's `name` property.
- Files are bundled with the build, so restart `npm run dev` after adding one.
- Keep files modest: a few thousand features per file draws comfortably.

For a remote feed that should stay live instead of a file snapshot, add it to
`config/geojson_layers.json`.
