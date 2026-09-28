import type { StyleSpecification } from "maplibre-gl";

export const OSM_VECTOR_SOURCE_ID = "openfreemap-osm";
export const OSM_COUNTRY_BOUNDARY_LAYER_ID = "boundary_country";

const OSM_VECTOR_TILEJSON_URL = "https://tiles.openfreemap.org/planet";
const OSM_ATTRIBUTION =
  '<a href="https://openfreemap.org/" target="_blank" rel="noopener noreferrer">OpenFreeMap</a> ' +
  '<a href="https://www.openmaptiles.org/" target="_blank" rel="noopener noreferrer">&copy; OpenMapTiles</a> ' +
  'Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>';
// Sub-national lines sit below national borders in the visual hierarchy.
const OSM_ADMIN_BOUNDARY = "rgba(111, 7, 16, 0.28)";
const OSM_LABEL_MAJOR = "rgba(206, 210, 218, 0.74)";
const OSM_LABEL_MINOR = "rgba(150, 158, 170, 0.46)";
const OSM_LABEL_WATER = "rgba(140, 150, 166, 0.50)";

export type EchisOsmStylePalette = {
  landFill: string;
  landOverlay: string;
  waterFill: string;
  waterwayFill: string;
  borderCountry: string;
  labelHalo: string;
  borderAdmin?: string;
  showBoundaries?: boolean;
  // Sub-national boundaries can be controlled independently when needed.
  showAdminBoundaries?: boolean;
};

export function createEchisOsmStyle({
  landFill,
  landOverlay,
  waterFill,
  waterwayFill,
  borderCountry,
  labelHalo,
  borderAdmin = OSM_ADMIN_BOUNDARY,
  showBoundaries = true,
  showAdminBoundaries = showBoundaries,
}: EchisOsmStylePalette): StyleSpecification {
  const adminVisibility = showAdminBoundaries ? "visible" : "none";
  const sourceLayer = (name: string) => ({
    source: OSM_VECTOR_SOURCE_ID,
    "source-layer": name,
  });

  return {
    version: 8,
    name: "EchisWorld Obsidian OSM",
    glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
    sources: {
      [OSM_VECTOR_SOURCE_ID]: {
        type: "vector",
        url: OSM_VECTOR_TILEJSON_URL,
        attribution: OSM_ATTRIBUTION,
      },
    },
    layers: [
      {
        id: "background",
        type: "background",
        paint: { "background-color": landFill },
      },
      {
        id: "landcover_glacier",
        type: "fill",
        ...sourceLayer("landcover"),
        filter: ["==", ["get", "class"], "ice"],
        paint: { "fill-color": landOverlay, "fill-opacity": 0.22 },
      },
      {
        id: "landuse_overlay",
        type: "fill",
        ...sourceLayer("landuse"),
        paint: {
          "fill-color": landOverlay,
          "fill-opacity": ["interpolate", ["linear"], ["zoom"], 4, 0.16, 11, 0.22, 16, 0.25],
        },
      },
      {
        id: "park_overlay",
        type: "fill",
        ...sourceLayer("park"),
        paint: {
          "fill-color": landOverlay,
          "fill-opacity": ["interpolate", ["linear"], ["zoom"], 4, 0.12, 11, 0.2, 16, 0.22],
        },
      },
      {
        id: "water",
        type: "fill",
        ...sourceLayer("water"),
        paint: { "fill-color": waterFill, "fill-opacity": 1 },
      },
      {
        id: "waterway",
        type: "line",
        ...sourceLayer("waterway"),
        paint: {
          "line-color": waterwayFill,
          "line-width": ["interpolate", ["linear"], ["zoom"], 4, 0.25, 9, 0.9],
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 4, 0.18, 7, 0.34, 10, 0.45],
        },
      },
      {
        id: "boundary_regional_admin",
        type: "line",
        ...sourceLayer("boundary"),
        layout: { visibility: adminVisibility },
        filter: [
          "all",
          [">=", ["to-number", ["get", "admin_level"], 99], 3],
          ["<=", ["to-number", ["get", "admin_level"], 99], 6],
          ["!=", ["get", "maritime"], 1],
          ["!=", ["get", "maritime"], "1"],
          ["!=", ["get", "maritime"], true],
          ["!=", ["get", "maritime"], "true"],
        ],
        paint: {
          "line-color": borderAdmin,
          "line-width": ["interpolate", ["linear"], ["zoom"], 2.4, 0.35, 5.5, 0.6, 9, 0.95],
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 2.4, 0.4, 6, 0.52, 9, 0.58],
          // Dashed internal borders remain subordinate to national outlines.
          "line-dasharray": [2.6, 1.8],
        },
      },
      {
        id: "boundary_local_admin",
        type: "line",
        ...sourceLayer("boundary"),
        layout: { visibility: adminVisibility },
        filter: [
          "all",
          [">=", ["to-number", ["get", "admin_level"], 99], 7],
          ["!=", ["get", "maritime"], 1],
          ["!=", ["get", "maritime"], "1"],
          ["!=", ["get", "maritime"], true],
          ["!=", ["get", "maritime"], "true"],
        ],
        paint: {
          "line-color": borderAdmin,
          "line-width": ["interpolate", ["linear"], ["zoom"], 4.2, 0.28, 8, 0.55, 11, 0.75],
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 5.5, 0, 8, 0.3, 11, 0.42],
          // Match the regional admin hierarchy at closer zoom levels.
          "line-dasharray": [2.2, 1.8],
        },
      },
      {
        id: OSM_COUNTRY_BOUNDARY_LAYER_ID,
        type: "line",
        ...sourceLayer("boundary"),
        layout: { visibility: showBoundaries ? "visible" : "none" },
        filter: [
          "all",
          // Some vector sources encode admin_level as a string.
          ["==", ["to-number", ["get", "admin_level"], 99], 2],
          ["!=", ["get", "maritime"], 1],
          ["!=", ["get", "maritime"], "1"],
          ["!=", ["get", "maritime"], true],
          ["!=", ["get", "maritime"], "true"],
        ],
        paint: {
          "line-color": borderCountry,
          "line-width": 0.8,
          "line-opacity": 0.9,
        },
      },
      {
        id: "building_fill",
        type: "fill",
        ...sourceLayer("building"),
        paint: {
          "fill-color": "#211e20",
          "fill-outline-color": "rgba(145, 72, 84, 0.16)",
          "fill-opacity": ["interpolate", ["linear"], ["zoom"], 13, 0, 14.5, 0.5, 16, 0.62],
        },
      },
      {
        id: "rail",
        type: "line",
        ...sourceLayer("transportation"),
        filter: ["==", ["get", "class"], "rail"],
        paint: {
          "line-color": "rgba(139, 130, 132, 0.28)",
          "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.3, 14, 1.1],
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 8, 0.08, 11, 0.2, 14, 0.3],
          "line-dasharray": [1.2, 1.8],
        },
      },
      {
        id: "road_minor",
        type: "line",
        ...sourceLayer("transportation"),
        filter: [
          "match",
          ["get", "class"],
          ["minor", "service", "track", "path"],
          true,
          false,
        ],
        paint: {
          "line-color": "rgba(111, 7, 16, 0.16)",
          "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.25, 13, 0.8],
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 8, 0, 11, 0.18, 14, 0.3],
        },
      },
      {
        id: "road_secondary",
        type: "line",
        ...sourceLayer("transportation"),
        filter: [
          "match",
          ["get", "class"],
          ["secondary", "tertiary"],
          true,
          false,
        ],
        paint: {
          "line-color": "rgba(135, 70, 79, 0.22)",
          "line-width": ["interpolate", ["linear"], ["zoom"], 7.5, 0.25, 13, 1.05, 17, 2.2],
          "line-opacity": ["interpolate", ["linear"], ["zoom"], 7.5, 0.16, 10, 0.3, 13, 0.42],
        },
      },
      {
        id: "road_major_casing",
        type: "line",
        ...sourceLayer("transportation"),
        filter: [
          "match",
          ["get", "class"],
          ["motorway", "trunk", "primary"],
          true,
          false,
        ],
        paint: {
          "line-color": "rgba(5, 6, 7, 0.66)",
          "line-width": ["interpolate", ["linear"], ["zoom"], 6.5, 0.7, 13, 2.2, 17, 4.8],
          "line-opacity": 0.64,
        },
      },
      {
        id: "road_major",
        type: "line",
        ...sourceLayer("transportation"),
        filter: [
          "match",
          ["get", "class"],
          ["motorway", "trunk", "primary"],
          true,
          false,
        ],
        paint: {
          "line-color": "rgba(165, 47, 65, 0.38)",
          "line-width": ["interpolate", ["linear"], ["zoom"], 7, 0.34, 13, 1.35, 17, 3.2],
          "line-opacity": 0.52,
        },
      },
      {
        id: "water_name",
        type: "symbol",
        ...sourceLayer("water_name"),
        layout: {
          "text-field": [
            "coalesce",
            ["get", "name_en"],
            ["get", "name:en"],
            ["get", "name"],
          ],
          "text-font": ["Noto Sans Italic"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 2, 8.5, 6, 11],
          "symbol-placement": "point",
          "text-letter-spacing": 0.03,
          "text-padding": 6,
        },
        paint: {
          "text-color": OSM_LABEL_WATER,
          "text-halo-color": labelHalo,
          "text-halo-width": 0.8,
          "text-opacity": 0.48,
        },
      },
      {
        id: "transportation_name_label",
        type: "symbol",
        ...sourceLayer("transportation_name"),
        filter: [
          "match",
          ["get", "class"],
          ["motorway", "trunk", "primary", "secondary"],
          true,
          false,
        ],
        layout: {
          "symbol-placement": "line",
          "text-field": ["coalesce", ["get", "ref"], ["get", "name"]],
          "text-font": ["Noto Sans Regular"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 10, 8, 15, 10.5],
          "text-letter-spacing": 0.04,
          "text-padding": 22,
        },
        paint: {
          "text-color": "rgba(176, 147, 151, 0.56)",
          "text-halo-color": labelHalo,
          "text-halo-width": 1,
        },
      },
      {
        id: "poi_label",
        type: "symbol",
        ...sourceLayer("poi"),
        layout: {
          "text-field": ["coalesce", ["get", "name_en"], ["get", "name:en"], ["get", "name"]],
          "text-font": ["Noto Sans Regular"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 13.2, 8, 17, 10],
          "text-max-width": 8,
          "text-padding": 18,
          "text-optional": true,
        },
        paint: {
          "text-color": "rgba(151, 145, 145, 0.48)",
          "text-halo-color": labelHalo,
          "text-halo-width": 0.85,
          "text-opacity": 0.58,
        },
      },
      {
        id: "place_country_label",
        type: "symbol",
        ...sourceLayer("place"),
        filter: ["==", ["get", "class"], "country"],
        layout: {
          "text-field": [
            "coalesce",
            ["get", "name_en"],
            ["get", "name:en"],
            ["get", "name"],
          ],
          "text-font": ["Noto Sans Regular"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 1.5, 11.5, 5, 15],
          "text-transform": "uppercase",
          "text-letter-spacing": 0.11,
          "text-max-width": 7,
          "text-padding": 8,
        },
        paint: {
          "text-color": OSM_LABEL_MAJOR,
          "text-halo-color": labelHalo,
          "text-halo-width": 1,
          "text-opacity": 0.86,
        },
      },
      {
        id: "place_region_label",
        type: "symbol",
        ...sourceLayer("place"),
        filter: ["==", ["get", "class"], "state"],
        layout: {
          "text-field": [
            "coalesce",
            ["get", "name_en"],
            ["get", "name:en"],
            ["get", "name"],
          ],
          "text-font": ["Noto Sans Regular"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 4.6, 9, 8, 11.5],
          "text-transform": "uppercase",
          "text-letter-spacing": 0.08,
          "text-max-width": 6.5,
          "text-padding": 10,
        },
        paint: {
          "text-color": OSM_LABEL_MINOR,
          "text-halo-color": labelHalo,
          "text-halo-width": 0.95,
          "text-opacity": 0.6,
        },
      },
      {
        id: "place_capital_label",
        type: "symbol",
        ...sourceLayer("place"),
        filter: [
          "all",
          ["==", ["get", "class"], "city"],
          ["==", ["to-number", ["get", "capital"], 0], 2],
        ],
        layout: {
          "text-field": [
            "coalesce",
            ["get", "name_en"],
            ["get", "name:en"],
            ["get", "name"],
          ],
          "text-font": ["Noto Sans Regular"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 3, 10.8, 7, 13.2],
          "text-max-width": 7.5,
          "text-padding": 12,
          "symbol-sort-key": ["to-number", ["get", "rank"], 99],
        },
        paint: {
          "text-color": OSM_LABEL_MAJOR,
          "text-halo-color": labelHalo,
          "text-halo-width": 1,
          "text-opacity": 0.8,
        },
      },
      {
        id: "place_major_city_label",
        type: "symbol",
        ...sourceLayer("place"),
        filter: [
          "all",
          ["==", ["get", "class"], "city"],
          ["!=", ["to-number", ["get", "capital"], 0], 2],
          ["<=", ["to-number", ["get", "rank"], 99], 4],
        ],
        layout: {
          "text-field": [
            "coalesce",
            ["get", "name_en"],
            ["get", "name:en"],
            ["get", "name"],
          ],
          "text-font": ["Noto Sans Regular"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 3.9, 9.8, 8, 12.4],
          "text-max-width": 7.5,
          "text-padding": 14,
          "symbol-sort-key": ["to-number", ["get", "rank"], 99],
        },
        paint: {
          "text-color": OSM_LABEL_MAJOR,
          "text-halo-color": labelHalo,
          "text-halo-width": 1,
          "text-opacity": 0.72,
        },
      },
      {
        id: "place_regional_city_label",
        type: "symbol",
        ...sourceLayer("place"),
        filter: [
          "all",
          [
            "any",
            [
              "all",
              ["==", ["get", "class"], "city"],
              [">", ["to-number", ["get", "rank"], 99], 4],
            ],
            [
              "all",
              ["==", ["get", "class"], "town"],
              ["<=", ["to-number", ["get", "rank"], 99], 6],
            ],
          ],
        ],
        layout: {
          "text-field": [
            "coalesce",
            ["get", "name_en"],
            ["get", "name:en"],
            ["get", "name"],
          ],
          "text-font": ["Noto Sans Regular"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 4.9, 8.8, 9, 11.7],
          "text-max-width": 7,
          "text-padding": 14,
          "symbol-sort-key": ["to-number", ["get", "rank"], 99],
        },
        paint: {
          "text-color": OSM_LABEL_MINOR,
          "text-halo-color": labelHalo,
          "text-halo-width": 0.9,
          "text-opacity": 0.64,
        },
      },
      {
        id: "place_town_label",
        type: "symbol",
        ...sourceLayer("place"),
        filter: [
          "all",
          ["==", ["get", "class"], "town"],
          [">", ["to-number", ["get", "rank"], 99], 6],
        ],
        layout: {
          "text-field": [
            "coalesce",
            ["get", "name_en"],
            ["get", "name:en"],
            ["get", "name"],
          ],
          "text-font": ["Noto Sans Regular"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 6.6, 8.5, 10, 10.9],
          "text-max-width": 7,
          "text-padding": 16,
          "symbol-sort-key": ["to-number", ["get", "rank"], 99],
        },
        paint: {
          "text-color": OSM_LABEL_MINOR,
          "text-halo-color": labelHalo,
          "text-halo-width": 0.85,
          "text-opacity": 0.56,
        },
      },
      {
        id: "place_minor_label",
        type: "symbol",
        ...sourceLayer("place"),
        filter: [
          "all",
          [
            "match",
            ["get", "class"],
            ["village", "suburb"],
            true,
            false,
          ],
        ],
        layout: {
          "text-field": [
            "coalesce",
            ["get", "name_en"],
            ["get", "name:en"],
            ["get", "name"],
          ],
          "text-font": ["Noto Sans Regular"],
          "text-size": ["interpolate", ["linear"], ["zoom"], 8.2, 8, 11, 10.4],
          "text-max-width": 6.5,
          "text-padding": 18,
          "symbol-sort-key": ["to-number", ["get", "rank"], 99],
        },
        paint: {
          "text-color": OSM_LABEL_MINOR,
          "text-halo-color": labelHalo,
          "text-halo-width": 0.8,
          "text-opacity": 0.46,
        },
      },
    ],
  };
}
