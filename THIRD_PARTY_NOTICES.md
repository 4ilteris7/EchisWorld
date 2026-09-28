# Third-party data and services

EchisWorld consumes public-source services and includes generated or transformed data from third-party projects. This document records the principal sources used by the repository; it is not a substitute for the upstream license text.

## Map and geographic data

- **OpenStreetMap:** geocoding results and applicable map data are attributed to OpenStreetMap contributors and are available under the Open Database License (ODbL). See <https://www.openstreetmap.org/copyright>.
- **OpenFreeMap / OpenMapTiles:** the Monitor loads OpenStreetMap-derived vector tiles and glyphs from OpenFreeMap using the OpenMapTiles schema. Runtime attribution remains visible through MapLibre's attribution control. See <https://openfreemap.org/> and <https://openmaptiles.org/>.
- **Natural Earth:** country and administrative-boundary geometry is generated from Natural Earth data. Natural Earth map data is public domain. See <https://github.com/nvkelso/natural-earth-vector/blob/master/LICENSE.md>.
- **geoBoundaries:** optional administrative-boundary search data is loaded separately and identified by the application as CC BY 4.0. See <https://www.geoboundaries.org/>.
