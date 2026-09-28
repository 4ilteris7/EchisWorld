import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { feature } from "topojson-client";

const require = createRequire(import.meta.url);
// Country interaction geometry is deliberately kept at 110m resolution. The
// visible borders come from OSM vector tiles; this lightweight source only
// powers hit-testing and camera bounds.
const atlasPath = require.resolve("world-atlas/countries-110m.json");
const outputUrl = new URL("../public/data/home-globe.geojson", import.meta.url);

const COORDINATE_PRECISION = 3;

function roundCoordinate(value) {
  return Number(value.toFixed(COORDINATE_PRECISION));
}

function roundCoordinates(coordinates) {
  if (typeof coordinates[0] === "number") {
    return [roundCoordinate(coordinates[0]), roundCoordinate(coordinates[1])];
  }
  return coordinates.map(roundCoordinates);
}

function compactGeometry(geometry) {
  if (!geometry) return null;
  if (geometry.type === "GeometryCollection") {
    return {
      type: "GeometryCollection",
      geometries: geometry.geometries.map(compactGeometry),
    };
  }
  return {
    type: geometry.type,
    coordinates: roundCoordinates(geometry.coordinates),
  };
}

function geometryBounds(geometry) {
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  const visit = (coordinates) => {
    if (typeof coordinates?.[0] === "number") {
      bounds[0] = Math.min(bounds[0], coordinates[0]);
      bounds[1] = Math.min(bounds[1], coordinates[1]);
      bounds[2] = Math.max(bounds[2], coordinates[0]);
      bounds[3] = Math.max(bounds[3], coordinates[1]);
      return;
    }
    coordinates?.forEach(visit);
  };
  visit(geometry?.coordinates);
  return bounds.map(roundCoordinate);
}

const topology = JSON.parse(await readFile(atlasPath, "utf8"));
const countries = feature(topology, topology.objects.countries);

const landFeatures = countries.features.map((country) => {
  const [west, south, east, north] = geometryBounds(country.geometry);
  return {
    type: "Feature",
    properties: {
      kind: "land",
      id: String(country.id ?? country.properties?.name ?? "country"),
      name: country.properties?.name ?? "Unknown country",
      west,
      south,
      east,
      north,
      centerLng: roundCoordinate((west + east) / 2),
      centerLat: roundCoordinate((south + north) / 2),
    },
    geometry: compactGeometry(country.geometry),
  };
});

const homeGlobeGeoJson = {
  type: "FeatureCollection",
  features: landFeatures,
};

const serialized = JSON.stringify(homeGlobeGeoJson);
await writeFile(outputUrl, serialized);

const outputPath = fileURLToPath(outputUrl);
const byteLength = Buffer.byteLength(serialized);
console.log(`Generated ${outputPath} (${byteLength} bytes)`);
