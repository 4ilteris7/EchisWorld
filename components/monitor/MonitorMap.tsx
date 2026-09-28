"use client";

import {
  type CSSProperties,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  createEchisOsmStyle,
  OSM_COUNTRY_BOUNDARY_LAYER_ID,
} from "@/components/map/engine/createEchisOsmStyle";

// MapLibre v6 uses a separate ESM worker. Next.js does not emit the worker and
// its shared sibling automatically, even in webpack mode, so build hooks copy
// both matching assets to this stable same-origin location.
maplibregl.setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

const COUNTRY_SOURCE = "monitor-countries";
const COUNTRY_HIT = "monitor-country-hit";
const INTEL_SOURCE = "monitor-intelligence";
const INTEL_DENSITY = "monitor-intelligence-density";
const INTEL_CLUSTER = "monitor-intelligence-cluster";
const INTEL_CLUSTER_COUNT = "monitor-intelligence-cluster-count";
const INTEL_POINT = "monitor-intelligence-point";
const INTEL_POINT_COUNT = "monitor-intelligence-point-count";
const INTEL_LABEL = "monitor-intelligence-label";
const INTEL_SELECTED = "monitor-intelligence-selected";
const AUTO_ROTATE_IDLE_MS = 30_000;
const AUTO_ROTATE_FRAME_MS = 33;
const AUTO_ROTATE_DEGREES_PER_SECOND = 1.35;
const COUNTRY_BORDER_IDLE_COLOR = "rgba(205, 201, 197, 0.46)";
const COUNTRY_BORDER_SELECTED_COLOR = "#ff405f";

const DEFAULT_VIEW = {
  center: [22, 13] as [number, number],
  zoom: 2.68,
  bearing: 0,
  pitch: 0,
};

type ViewportPadding = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export type MonitorProjection = "globe" | "mercator";
export type MonitorMapEngineState = "loading" | "ready" | "error";

export type MonitorMapMarker = {
  id: string;
  lng: number;
  lat: number;
  label: string;
  detail: string;
  reportCount: number;
  level: "low" | "medium" | "high" | "critical";
  category: "global" | "cyber" | "defense" | "policy";
};

export type MonitorGeography = {
  id: string;
  name: string;
  lng: number;
  lat: number;
  bbox?: [number, number, number, number];
  boundaryCode?: string;
};

export interface MonitorMapHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  reset: () => void;
  focus: (lng: number, lat: number, zoom?: number) => void;
  resize: () => void;
  getView: () => { lng: number; lat: number; zoom: number } | null;
}

type MonitorMapProps = {
  active: boolean;
  reportNetworkOpen: boolean;
  markers: MonitorMapMarker[];
  selectedMarkerId: string | null;
  selectedGeography: MonitorGeography | null;
  projection: MonitorProjection;
  showLabels: boolean;
  showBoundaries: boolean;
  showReportDensity: boolean;
  viewportPadding?: ViewportPadding;
  onMarkerSelect: (marker: MonitorMapMarker | null) => void;
  onGeographyChange: (geography: MonitorGeography | null) => void;
  onMapBackgroundClick?: () => void;
  onViewportInteraction?: () => void;
  onAutoRotateStart?: () => void;
  onEngineStateChange?: (state: MonitorMapEngineState) => void;
};

function createMapStyle(): maplibregl.StyleSpecification {
  return createEchisOsmStyle({
    landFill: "#111214",
    landOverlay: "#191719",
    waterFill: "#050607",
    waterwayFill: "rgba(151, 55, 70, 0.22)",
    borderCountry: COUNTRY_BORDER_IDLE_COLOR,
    borderAdmin: "rgba(128, 46, 58, 0.24)",
    labelHalo: "rgba(6, 6, 7, 0.92)",
    showBoundaries: true,
    showAdminBoundaries: true,
  });
}

function applyAtmosphere(map: maplibregl.Map): void {
  try {
    map.setSky({
      "sky-color": "#030405",
      "sky-horizon-blend": 0,
      "horizon-color": "#030405",
      "horizon-fog-blend": 0,
      "fog-color": "#030405",
      "fog-ground-blend": 0,
      // Keep MapLibre's globe silhouette neutral. A separate grey optical
      // shell used to sit above the OSM tiles and made parts of the rim look
      // like missing cartography, especially while the globe was rotating.
      "atmosphere-blend": 0,
    });
  } catch {
    // Older/limited WebGL implementations can render the map without sky.
  }
}

function setLayerVisibility(
  map: maplibregl.Map,
  matcher: (layer: maplibregl.LayerSpecification) => boolean,
  visible: boolean,
): void {
  for (const layer of map.getStyle()?.layers ?? []) {
    if (!matcher(layer)) continue;
    try {
      map.setLayoutProperty(layer.id, "visibility", visible ? "visible" : "none");
    } catch {
      // A style can change between getStyle and this update during teardown.
    }
  }
}

// The Natural Earth interaction source identifies countries with ISO-3166
// numeric codes, while OpenMapTiles stores ISO alpha-3 values in adm0_l/r.
// This bridge keeps the selection on the exact vector-tile geometry used by
// the visible OSM boundary underneath it.
const ATLAS_COUNTRY_CODE_BY_ID = new Map<string, string>(
  "004:AFG,008:ALB,010:ATA,012:DZA,024:AGO,031:AZE,032:ARG,036:AUS,040:AUT,044:BHS,050:BGD,051:ARM,056:BEL,064:BTN,068:BOL,070:BIH,072:BWA,076:BRA,084:BLZ,090:SLB,096:BRN,100:BGR,104:MMR,108:BDI,112:BLR,116:KHM,120:CMR,124:CAN,140:CAF,144:LKA,148:TCD,152:CHL,156:CHN,158:TWN,170:COL,178:COG,180:COD,188:CRI,191:HRV,192:CUB,196:CYP,203:CZE,204:BEN,208:DNK,214:DOM,218:ECU,222:SLV,226:GNQ,231:ETH,232:ERI,233:EST,238:FLK,242:FJI,246:FIN,250:FRA,260:ATF,262:DJI,266:GAB,268:GEO,270:GMB,275:PSE,276:DEU,288:GHA,300:GRC,304:GRL,320:GTM,324:GIN,328:GUY,332:HTI,340:HND,348:HUN,352:ISL,356:IND,360:IDN,364:IRN,368:IRQ,372:IRL,376:ISR,380:ITA,384:CIV,388:JAM,392:JPN,398:KAZ,400:JOR,404:KEN,408:PRK,410:KOR,414:KWT,417:KGZ,418:LAO,422:LBN,426:LSO,428:LVA,430:LBR,434:LBY,440:LTU,442:LUX,450:MDG,454:MWI,458:MYS,466:MLI,478:MRT,484:MEX,496:MNG,498:MDA,499:MNE,504:MAR,508:MOZ,512:OMN,516:NAM,524:NPL,528:NLD,540:NCL,548:VUT,554:NZL,558:NIC,562:NER,566:NGA,578:NOR,586:PAK,591:PAN,598:PNG,600:PRY,604:PER,608:PHL,616:POL,620:PRT,624:GNB,626:TLS,630:PRI,634:QAT,642:ROU,643:RUS,646:RWA,682:SAU,686:SEN,688:SRB,694:SLE,703:SVK,704:VNM,705:SVN,706:SOM,710:ZAF,716:ZWE,724:ESP,728:SSD,729:SDN,732:ESH,740:SUR,748:SWZ,752:SWE,756:CHE,760:SYR,762:TJK,764:THA,768:TGO,780:TTO,784:ARE,788:TUN,792:TUR,795:TKM,800:UGA,804:UKR,807:MKD,818:EGY,826:GBR,834:TZA,840:USA,854:BFA,858:URY,860:UZB,862:VEN,887:YEM,894:ZMB"
    .split(",")
    .map((entry) => entry.split(":") as [string, string]),
);

const ATLAS_COUNTRY_CODE_BY_NAME: Record<string, string> = {
  Kosovo: "XKK",
  "N. Cyprus": "CYP",
  Somaliland: "SOM",
};

function atlasCountryBoundaryCode(id: string, name: string): string | null {
  const numericId = /^\d+$/.test(id) ? id.padStart(3, "0") : null;
  return (numericId ? ATLAS_COUNTRY_CODE_BY_ID.get(numericId) : null)
    ?? ATLAS_COUNTRY_CODE_BY_NAME[name]
    ?? null;
}

function applySelectedCountryBoundaryStyle(
  map: maplibregl.Map,
  boundaryCode: string | null,
): void {
  if (!map.getLayer(OSM_COUNTRY_BOUNDARY_LAYER_ID)) return;
  if (!boundaryCode) {
    map.setPaintProperty(
      OSM_COUNTRY_BOUNDARY_LAYER_ID,
      "line-color",
      COUNTRY_BORDER_IDLE_COLOR,
    );
    map.setPaintProperty(OSM_COUNTRY_BOUNDARY_LAYER_ID, "line-width", 0.8);
    map.setPaintProperty(OSM_COUNTRY_BOUNDARY_LAYER_ID, "line-opacity", 0.9);
    return;
  }

  const selectedFeature: maplibregl.ExpressionSpecification = [
    "any",
    ["==", ["get", "adm0_l"], boundaryCode],
    ["==", ["get", "adm0_r"], boundaryCode],
  ];
  map.setPaintProperty(OSM_COUNTRY_BOUNDARY_LAYER_ID, "line-color", [
    "case",
    selectedFeature,
    COUNTRY_BORDER_SELECTED_COLOR,
    COUNTRY_BORDER_IDLE_COLOR,
  ]);
  map.setPaintProperty(OSM_COUNTRY_BOUNDARY_LAYER_ID, "line-width", [
    "interpolate",
    ["linear"],
    ["zoom"],
    1,
    ["case", selectedFeature, 1.15, 0.8],
    8,
    ["case", selectedFeature, 2, 0.8],
  ]);
  map.setPaintProperty(OSM_COUNTRY_BOUNDARY_LAYER_ID, "line-opacity", [
    "case",
    selectedFeature,
    1,
    0.9,
  ]);
}

function focusGeography(map: maplibregl.Map, geography: MonitorGeography): void {
  const easing = (value: number) => 1 - Math.pow(1 - value, 3);
  const bbox = geography.bbox;
  if (bbox && bbox.every(Number.isFinite) && bbox[2] - bbox[0] < 160) {
    map.fitBounds(
      [[bbox[0], bbox[1]], [bbox[2], bbox[3]]],
      {
        padding: { top: 92, right: 112, bottom: 92, left: 112 },
        maxZoom: 5.35,
        duration: 1_450,
        easing,
        essential: true,
      },
    );
    return;
  }

  map.easeTo({
    center: [geography.lng, geography.lat],
    zoom: 4.45,
    bearing: 0,
    pitch: 0,
    duration: 1_350,
    easing,
    essential: true,
  });
}

function addCountryLayers(map: maplibregl.Map): void {
  if (!map.getSource(COUNTRY_SOURCE)) {
    map.addSource(COUNTRY_SOURCE, {
      type: "geojson",
      data: "/data/home-globe.geojson",
      maxzoom: 12,
      tolerance: 0.18,
      generateId: false,
    });
  }
  const firstSymbol = map.getStyle()?.layers?.find((layer) => layer.type === "symbol")?.id;
  const before = firstSymbol && map.getLayer(firstSymbol) ? firstSymbol : undefined;
  const add = (layer: maplibregl.LayerSpecification) => {
    if (!map.getLayer(layer.id)) map.addLayer(layer, before);
  };

  add({
    id: COUNTRY_HIT,
    type: "fill",
    source: COUNTRY_SOURCE,
    filter: ["==", ["get", "kind"], "land"],
    paint: { "fill-color": "#000000", "fill-opacity": 0 },
  });
}

function markerFeatureCollection(
  markers: MonitorMapMarker[],
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: markers.map((marker) => ({
      type: "Feature",
      id: marker.id,
      properties: {
        id: marker.id,
        label: marker.label,
        detail: marker.detail,
        reportCount: Math.max(1, marker.reportCount),
        level: marker.level,
        category: marker.category,
      },
      geometry: { type: "Point", coordinates: [marker.lng, marker.lat] },
    })),
  };
}

function addIntelligenceLayers(map: maplibregl.Map): void {
  if (!map.getSource(INTEL_SOURCE)) {
    map.addSource(INTEL_SOURCE, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
      cluster: true,
      clusterMaxZoom: 6,
      clusterRadius: 54,
      clusterProperties: {
        reportCount: ["+", ["get", "reportCount"]],
      },
    });
  }
  if (!map.getLayer(INTEL_DENSITY)) {
    map.addLayer({
      id: INTEL_DENSITY,
      type: "heatmap",
      source: INTEL_SOURCE,
      maxzoom: 8,
      layout: { visibility: "none" },
      paint: {
        "heatmap-weight": [
          "interpolate",
          ["linear"],
          ["get", "reportCount"],
          1,
          0.15,
          50,
          1,
        ],
        "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0, 0.65, 6, 1.1],
        "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 0, 16, 6, 34],
        "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 0, 0.5, 7, 0.18],
        "heatmap-color": [
          "interpolate",
          ["linear"],
          ["heatmap-density"],
          0,
          "rgba(90,24,38,0)",
          0.32,
          "rgba(119,35,50,.28)",
          0.62,
          "rgba(180,48,70,.46)",
          1,
          "rgba(255,64,95,.68)",
        ],
      },
    });
  }
  if (!map.getLayer(INTEL_CLUSTER)) {
    map.addLayer({
      id: INTEL_CLUSTER,
      type: "circle",
      source: INTEL_SOURCE,
      filter: ["has", "point_count"],
      paint: {
        "circle-color": [
          "step",
          ["get", "reportCount"],
          "rgba(97,105,116,.84)",
          12,
          "rgba(151,100,73,.88)",
          40,
          "rgba(175,52,73,.9)",
        ],
        "circle-radius": ["step", ["get", "reportCount"], 12, 12, 16, 40, 21],
        "circle-stroke-color": "rgba(235,231,225,.62)",
        "circle-stroke-width": 1,
      },
    });
  }
  if (!map.getLayer(INTEL_CLUSTER_COUNT)) {
    map.addLayer({
      id: INTEL_CLUSTER_COUNT,
      type: "symbol",
      source: INTEL_SOURCE,
      filter: ["has", "point_count"],
      layout: {
        "text-field": ["to-string", ["get", "reportCount"]],
        "text-size": 10,
        "text-font": ["Noto Sans Bold"],
      },
      paint: {
        "text-color": "#f0ede8",
        "text-halo-color": "rgba(8,8,9,.72)",
        "text-halo-width": 1,
      },
    });
  }
  if (!map.getLayer(INTEL_SELECTED)) {
    map.addLayer({
      id: INTEL_SELECTED,
      type: "circle",
      source: INTEL_SOURCE,
      filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "id"], ""]],
      paint: {
        "circle-radius": ["step", ["get", "reportCount"], 12, 10, 14, 100, 16],
        "circle-color": "rgba(198,58,80,.12)",
        "circle-stroke-color": "#d04960",
        "circle-stroke-width": 1.5,
      },
    });
  }
  if (!map.getLayer(INTEL_POINT)) {
    map.addLayer({
      id: INTEL_POINT,
      type: "circle",
      source: INTEL_SOURCE,
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-radius": ["step", ["get", "reportCount"], 8, 10, 10.5, 100, 12],
        "circle-color": [
          "match",
          ["get", "level"],
          "critical",
          "#e15469",
          "high",
          "#d9905d",
          "medium",
          "#d5bd78",
          "#8ca1ae",
        ],
        "circle-stroke-color": "rgba(8,8,9,.9)",
        "circle-stroke-width": 1.2,
      },
    });
  }
  if (!map.getLayer(INTEL_POINT_COUNT)) {
    map.addLayer({
      id: INTEL_POINT_COUNT,
      type: "symbol",
      source: INTEL_SOURCE,
      filter: ["!", ["has", "point_count"]],
      layout: {
        "text-field": ["to-string", ["get", "reportCount"]],
        "text-font": ["Noto Sans Bold"],
        "text-size": 9,
        "text-allow-overlap": true,
        "text-ignore-placement": true,
      },
      paint: {
        "text-color": "#f4f0ea",
        "text-halo-color": "rgba(8,8,9,.72)",
        "text-halo-width": 0.8,
      },
    });
  }
  if (!map.getLayer(INTEL_LABEL)) {
    map.addLayer({
      id: INTEL_LABEL,
      type: "symbol",
      source: INTEL_SOURCE,
      filter: ["!", ["has", "point_count"]],
      layout: {
        "text-field": ["get", "label"],
        "text-font": ["Noto Sans Bold"],
        "text-size": 10,
        "text-offset": [0, 1.15],
        "text-anchor": "top",
        "text-max-width": 12,
        "text-optional": true,
      },
      paint: {
        "text-color": "#d7d3cd",
        "text-halo-color": "rgba(7,7,8,.95)",
        "text-halo-width": 1.2,
      },
    });
  }
}

function wrapLongitude(lng: number): number {
  return ((lng + 540) % 360) - 180;
}

function clampLatitude(lat: number): number {
  return Math.max(-85, Math.min(85, lat));
}

function distance(
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function isLikelyOutsideGlobe(
  map: maplibregl.Map,
  point: { x: number; y: number },
): boolean {
  const canvas = map.getCanvas();
  const center = map.getCenter();
  const centerPoint = map.project(center);
  const sampleCoordinates: Array<[number, number]> = [
    [wrapLongitude(center.lng + 90), center.lat],
    [wrapLongitude(center.lng - 90), center.lat],
    [center.lng, clampLatitude(center.lat + 80)],
    [center.lng, clampLatitude(center.lat - 80)],
  ];
  const radii = sampleCoordinates
    .map((coordinate) => distance(centerPoint, map.project(coordinate)))
    .filter((value) => Number.isFinite(value) && value > 24);
  const fallbackRadius = Math.min(canvas.clientWidth, canvas.clientHeight) * 0.42;
  const globeRadius = Math.max(fallbackRadius, ...radii);
  return distance(point, centerPoint) > globeRadius + 18;
}

export const MonitorMap = forwardRef<MonitorMapHandle, MonitorMapProps>(
  function MonitorMap(
    {
      active,
      reportNetworkOpen,
      markers,
      selectedMarkerId,
      selectedGeography,
      projection,
      showLabels,
      showBoundaries,
      showReportDensity,
      viewportPadding = { top: 0, right: 0, bottom: 0, left: 0 },
      onMarkerSelect,
      onGeographyChange,
      onMapBackgroundClick,
      onViewportInteraction,
      onAutoRotateStart,
      onEngineStateChange,
    },
    ref,
  ) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<maplibregl.Map | null>(null);
    const networkGestureDismissedRef = useRef(false);
    const autoRotateRef = useRef<{
      start: () => void;
      pauseForUser: () => void;
      setActive: (nextActive: boolean) => void;
    } | null>(null);
    const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
    const propsRef = useRef({
      active,
      reportNetworkOpen,
      markers,
      selectedMarkerId,
      onMarkerSelect,
      onGeographyChange,
      onMapBackgroundClick,
      onViewportInteraction,
      onAutoRotateStart,
      onEngineStateChange,
      projection,
      viewportPadding,
      showReportDensity,
    });
    propsRef.current = {
      active,
      reportNetworkOpen,
      markers,
      selectedMarkerId,
      onMarkerSelect,
      onGeographyChange,
      onMapBackgroundClick,
      onViewportInteraction,
      onAutoRotateStart,
      onEngineStateChange,
      projection,
      viewportPadding,
      showReportDensity,
    };

    useImperativeHandle(ref, () => ({
      zoomIn: () => {
        autoRotateRef.current?.pauseForUser();
        mapRef.current?.easeTo({
          zoom: Math.min(18, (mapRef.current?.getZoom() ?? 2) + 0.7),
          duration: 340,
          easing: (value) => 1 - Math.pow(1 - value, 3),
        });
      },
      zoomOut: () => {
        autoRotateRef.current?.pauseForUser();
        mapRef.current?.easeTo({
          zoom: Math.max(1.2, (mapRef.current?.getZoom() ?? 2) - 0.7),
          duration: 340,
          easing: (value) => 1 - Math.pow(1 - value, 3),
        });
      },
      reset: () => {
        autoRotateRef.current?.pauseForUser();
        mapRef.current?.easeTo({ ...DEFAULT_VIEW, duration: 800 });
      },
      focus: (lng, lat, zoom = 6.2) => {
        autoRotateRef.current?.pauseForUser();
        mapRef.current?.easeTo({
          center: [lng, lat],
          zoom,
          duration: 950,
          easing: (value) => 1 - Math.pow(1 - value, 3),
          essential: true,
        });
      },
      resize: () => mapRef.current?.resize(),
      getView: () => {
        const map = mapRef.current;
        if (!map) return null;
        const center = map.getCenter();
        return { lng: center.lng, lat: center.lat, zoom: map.getZoom() };
      },
    }), []);

    useEffect(() => {
      const container = containerRef.current;
      if (!container || mapRef.current) return;
      let disposed = false;
      propsRef.current.onEngineStateChange?.("loading");

      const map = new maplibregl.Map({
        container,
        style: createMapStyle(),
        ...DEFAULT_VIEW,
        minZoom: 1.15,
        maxZoom: 19,
        maxPitch: 0,
        canvasContextAttributes: {
          antialias: false,
          powerPreference: "high-performance",
          contextType: "webgl2",
        },
        attributionControl: false,
        dragRotate: false,
        touchZoomRotate: true,
        doubleClickZoom: false,
        pitchWithRotate: false,
        refreshExpiredTiles: false,
        renderWorldCopies: false,
        // Retain loaded parent tiles while their children arrive so rapid
        // zooming never exposes the bare background between tile levels.
        cancelPendingTileRequestsWhileZooming: false,
        fadeDuration: 0,
      });
      mapRef.current = map;
      map.touchZoomRotate.disableRotation();
      map.scrollZoom.setWheelZoomRate(1 / 600);
      map.scrollZoom.setZoomRate(1 / 130);
      map.addControl(
        new maplibregl.AttributionControl({ compact: true, customAttribution: "EchisWorld" }),
        "bottom-left",
      );

      let rotateFrame: number | null = null;
      let idleTimer: number | null = null;
      let rotateLastAt = 0;
      let rotateLastFrameAt = 0;
      let userInteracting = false;
      let initialReady = false;

      const stopAutoRotate = () => {
        rotateLastAt = 0;
        rotateLastFrameAt = 0;
        if (rotateFrame != null) {
          window.cancelAnimationFrame(rotateFrame);
          rotateFrame = null;
        }
      };
      const rotateStep = (timestamp: number) => {
        if (disposed) return;
        rotateFrame = window.requestAnimationFrame(rotateStep);
        if (
          !propsRef.current.active ||
          document.visibilityState === "hidden" ||
          propsRef.current.projection !== "globe"
        ) {
          rotateLastAt = timestamp;
          return;
        }
        if (timestamp - rotateLastFrameAt < AUTO_ROTATE_FRAME_MS) return;
        const elapsed = rotateLastAt > 0 ? Math.min((timestamp - rotateLastAt) / 1000, 0.08) : 0;
        rotateLastAt = timestamp;
        rotateLastFrameAt = timestamp;
        if (elapsed <= 0) return;
        const center = map.getCenter();
        const lng = ((center.lng + AUTO_ROTATE_DEGREES_PER_SECOND * elapsed + 540) % 360) - 180;
        map.jumpTo({ center: [lng, center.lat], bearing: 0, pitch: 0 });
      };
      const startAutoRotate = () => {
        if (
          disposed ||
          rotateFrame != null ||
          userInteracting ||
          !propsRef.current.active ||
          document.visibilityState === "hidden" ||
          propsRef.current.projection !== "globe"
        ) return;
        rotateLastAt = 0;
        rotateLastFrameAt = 0;
        propsRef.current.onAutoRotateStart?.();
        rotateFrame = window.requestAnimationFrame(rotateStep);
      };
      const clearIdleTimer = () => {
        if (idleTimer != null) {
          window.clearTimeout(idleTimer);
          idleTimer = null;
        }
      };
      const scheduleAutoRotate = () => {
        clearIdleTimer();
        if (!propsRef.current.active || document.visibilityState === "hidden") return;
        idleTimer = window.setTimeout(() => {
          idleTimer = null;
          if (!userInteracting) startAutoRotate();
        }, AUTO_ROTATE_IDLE_MS);
      };
      const beginUserInteraction = () => {
        userInteracting = true;
        clearIdleTimer();
        stopAutoRotate();
      };
      const dismissNetworkForViewportInteraction = () => {
        if (
          !propsRef.current.reportNetworkOpen ||
          networkGestureDismissedRef.current
        ) return;
        networkGestureDismissedRef.current = true;
        propsRef.current.onViewportInteraction?.();
      };
      const beginPointerInteraction = () => {
        beginUserInteraction();
      };
      const beginDragInteraction = () => {
        beginUserInteraction();
        dismissNetworkForViewportInteraction();
      };
      const beginTouchInteraction = () => {
        beginUserInteraction();
        dismissNetworkForViewportInteraction();
      };
      const endUserInteraction = () => {
        userInteracting = false;
        scheduleAutoRotate();
      };
      const pauseForUser = () => {
        stopAutoRotate();
        scheduleAutoRotate();
      };
      const setActive = (nextActive: boolean) => {
        clearIdleTimer();
        stopAutoRotate();
        userInteracting = false;
        if (!nextActive || document.visibilityState === "hidden") return;
        window.requestAnimationFrame(() => {
          if (disposed || !propsRef.current.active) return;
          map.resize();
          map.triggerRepaint();
          if (initialReady) scheduleAutoRotate();
        });
      };
      autoRotateRef.current = { start: startAutoRotate, pauseForUser, setActive };

      const markInitialReady = () => {
        if (disposed || initialReady) return;
        initialReady = true;
        setLoadState("ready");
        propsRef.current.onEngineStateChange?.("ready");
        if (propsRef.current.active) startAutoRotate();
      };

      const applyStyle = () => {
        if (disposed) return;
        try {
          map.setProjection({
            type: propsRef.current.projection === "globe"
              ? "globe"
              : "mercator",
          });
          applyAtmosphere(map);
          addCountryLayers(map);
          addIntelligenceLayers(map);
          map.once("idle", markInitialReady);
          map.triggerRepaint();
        } catch {
          setLoadState("error");
          propsRef.current.onEngineStateChange?.("error");
        }
      };

      const handleError = (event: maplibregl.ErrorEvent) => {
        const message = String(event?.error?.message ?? "");
        if (message) console.warn("[EchisWorld Monitor map]", event.error);
      };
      const handleAtmosphereDoubleClick = (event: maplibregl.MapMouseEvent) => {
        if (propsRef.current.projection !== "globe") return;
        if (!isLikelyOutsideGlobe(map, event.point)) return;
        event.preventDefault();
        userInteracting = false;
        clearIdleTimer();
        startAutoRotate();
      };
      const handleCountryClick = (event: maplibregl.MapLayerMouseEvent) => {
        pauseForUser();
        const overlayLayers = [INTEL_POINT, INTEL_CLUSTER].filter(
          (id) => map.getLayer(id),
        );
        if (
          overlayLayers.length > 0 &&
          map.queryRenderedFeatures(event.point, { layers: overlayLayers }).length > 0
        ) {
          return;
        }
        const feature = event.features?.[0];
        const name = String(feature?.properties?.name ?? "").trim();
        if (!name) return;
        const id = String(feature?.properties?.id ?? name);
        const boundaryCode = atlasCountryBoundaryCode(id, name);
        const west = Number(feature?.properties?.west);
        const south = Number(feature?.properties?.south);
        const east = Number(feature?.properties?.east);
        const north = Number(feature?.properties?.north);
        const centerLng = Number(feature?.properties?.centerLng);
        const centerLat = Number(feature?.properties?.centerLat);
        const hasBounds =
          [west, south, east, north].every(Number.isFinite) &&
          east > west &&
          east - west < 160;
        propsRef.current.onGeographyChange({
          id,
          name,
          lng: hasBounds && Number.isFinite(centerLng) ? centerLng : event.lngLat.lng,
          lat: hasBounds && Number.isFinite(centerLat) ? centerLat : event.lngLat.lat,
          bbox: hasBounds ? [west, south, east, north] : undefined,
          boundaryCode: boundaryCode ?? undefined,
        });
      };
      const handleIntelClick = (event: maplibregl.MapLayerMouseEvent) => {
        pauseForUser();
        const id = String(event.features?.[0]?.properties?.id ?? "");
        const marker = propsRef.current.markers.find((item) => item.id === id) ?? null;
        propsRef.current.onMarkerSelect(marker);
      };
      const handleClusterClick = async (event: maplibregl.MapLayerMouseEvent) => {
        pauseForUser();
        const feature = event.features?.[0];
        const clusterId = Number(feature?.properties?.cluster_id);
        if (!feature || !Number.isFinite(clusterId)) return;
        const source = map.getSource(INTEL_SOURCE) as maplibregl.GeoJSONSource | undefined;
        if (!source) return;
        propsRef.current.onMarkerSelect(null);
        propsRef.current.onGeographyChange(null);
        try {
          const zoom = await source.getClusterExpansionZoom(clusterId);
          const coordinates = (feature.geometry as GeoJSON.Point).coordinates;
          map.easeTo({ center: [coordinates[0], coordinates[1]], zoom, duration: 420 });
        } catch {
          // The cluster can disappear if the feed refreshes during the click.
        }
      };
      const handleMapClick = (event: maplibregl.MapMouseEvent) => {
        const interactiveLayers = [INTEL_POINT, INTEL_CLUSTER, COUNTRY_HIT].filter(
          (id) => map.getLayer(id),
        );
        if (
          interactiveLayers.length > 0 &&
          map.queryRenderedFeatures(event.point, { layers: interactiveLayers }).length > 0
        ) {
          return;
        }
        propsRef.current.onMapBackgroundClick?.();
      };
      const handleVisibilityChange = () => {
        if (document.visibilityState === "hidden") {
          clearIdleTimer();
          stopAutoRotate();
          return;
        }
        if (propsRef.current.active) setActive(true);
      };
      const setInteractiveCursor = () => {
        map.getCanvas().style.cursor = "pointer";
      };
      const clearInteractiveCursor = () => {
        map.getCanvas().style.cursor = "";
      };
      map.on("style.load", applyStyle);
      map.on("error", handleError);
      map.on("click", handleMapClick);
      map.on("dblclick", handleAtmosphereDoubleClick);
      map.on("click", COUNTRY_HIT, handleCountryClick);
      map.on("mouseenter", COUNTRY_HIT, setInteractiveCursor);
      map.on("mouseleave", COUNTRY_HIT, clearInteractiveCursor);
      map.on("click", INTEL_POINT, handleIntelClick);
      map.on("click", INTEL_CLUSTER, handleClusterClick);
      map.on("mouseenter", INTEL_POINT, setInteractiveCursor);
      map.on("mouseleave", INTEL_POINT, clearInteractiveCursor);
      map.on("mouseenter", INTEL_CLUSTER, setInteractiveCursor);
      map.on("mouseleave", INTEL_CLUSTER, clearInteractiveCursor);
      map.on("dragstart", beginDragInteraction);
      map.on("dragend", endUserInteraction);
      map.on("zoomstart", beginUserInteraction);
      map.on("zoomend", endUserInteraction);
      map.on("rotatestart", beginUserInteraction);
      map.on("rotateend", endUserInteraction);
      map.on("pitchstart", beginUserInteraction);
      map.on("pitchend", endUserInteraction);
      const canvas = map.getCanvas();
      canvas.addEventListener("pointerdown", beginPointerInteraction);
      window.addEventListener("pointerup", endUserInteraction);
      const handleWheel = (event: WheelEvent) => {
        pauseForUser();
        if (event.deltaY !== 0) dismissNetworkForViewportInteraction();
      };
      canvas.addEventListener("wheel", handleWheel, { passive: true });
      canvas.addEventListener("touchstart", beginTouchInteraction, { passive: true });
      canvas.addEventListener("touchend", endUserInteraction, { passive: true });
      document.addEventListener("visibilitychange", handleVisibilityChange);
      const timeout = window.setTimeout(() => {
        if (!disposed && !initialReady) {
          setLoadState("error");
          propsRef.current.onEngineStateChange?.("error");
        }
      }, 12_000);

      return () => {
        disposed = true;
        clearIdleTimer();
        stopAutoRotate();
        autoRotateRef.current = null;
        window.clearTimeout(timeout);
        canvas.removeEventListener("pointerdown", beginPointerInteraction);
        window.removeEventListener("pointerup", endUserInteraction);
        document.removeEventListener("visibilitychange", handleVisibilityChange);
        canvas.removeEventListener("wheel", handleWheel);
        canvas.removeEventListener("touchstart", beginTouchInteraction);
        canvas.removeEventListener("touchend", endUserInteraction);
        map.remove();
        mapRef.current = null;
      };
    }, []);

    useEffect(() => {
      autoRotateRef.current?.setActive(active);
    }, [active]);

    useEffect(() => {
      networkGestureDismissedRef.current = false;
    }, [reportNetworkOpen]);

    useEffect(() => {
      const map = mapRef.current;
      if (!map) return;
      autoRotateRef.current?.pauseForUser();
      let cancelled = false;
      let frame: number | null = null;
      let attempts = 0;
      const target = projection === "globe" ? "globe" : "mercator";

      const applyProjection = () => {
        if (cancelled) return;
        attempts += 1;
        if (!map.isStyleLoaded()) {
          if (attempts < 20) frame = window.requestAnimationFrame(applyProjection);
          return;
        }
        try {
          map.stop();
          if (map.getProjection().type !== target) {
            map.setProjection({ type: target });
          }
          applyAtmosphere(map);
          map.triggerRepaint();
        } catch {
          if (attempts < 20) frame = window.requestAnimationFrame(applyProjection);
        }
      };

      applyProjection();
      return () => {
        cancelled = true;
        if (frame != null) window.cancelAnimationFrame(frame);
      };
    }, [projection]);

    useEffect(() => {
      const map = mapRef.current;
      if (!map?.isStyleLoaded()) return;
      setLayerVisibility(map, (layer) => layer.type === "symbol" && /place|label|name|poi/i.test(layer.id), showLabels);
      setLayerVisibility(
        map,
        (layer) => layer.type === "line" && layer.id.startsWith("boundary_"),
        showBoundaries,
      );
      if (map.getLayer(INTEL_DENSITY)) {
        map.setLayoutProperty(
          INTEL_DENSITY,
          "visibility",
          showReportDensity ? "visible" : "none",
        );
      }
    }, [showLabels, showBoundaries, showReportDensity, loadState]);

    useEffect(() => {
      const map = mapRef.current;
      if (!map?.isStyleLoaded() || loadState !== "ready") return;
      const boundaryCode = selectedGeography
        ? selectedGeography.boundaryCode
          ?? atlasCountryBoundaryCode(selectedGeography.id, selectedGeography.name)
        : null;
      applySelectedCountryBoundaryStyle(map, boundaryCode);
      if (!selectedGeography) return;
      autoRotateRef.current?.pauseForUser();
      focusGeography(map, selectedGeography);
    }, [selectedGeography, loadState]);

    useEffect(() => {
      const map = mapRef.current;
      if (!map || loadState !== "ready") return;
      const source = map.getSource(INTEL_SOURCE) as maplibregl.GeoJSONSource | undefined;
      source?.setData(markerFeatureCollection(markers));
      if (map.getLayer(INTEL_SELECTED)) {
        map.setFilter(INTEL_SELECTED, [
          "all",
          ["!", ["has", "point_count"]],
          ["==", ["get", "id"], selectedMarkerId ?? ""],
        ]);
      }
    }, [loadState, markers, selectedMarkerId]);

    const mapShiftX = (viewportPadding.left - viewportPadding.right) / 2;

    return (
      <div
        className="monitor-map-root"
        data-ready={loadState === "ready" || undefined}
        aria-label="EchisWorld geographic workspace"
      >
        <div
          ref={containerRef}
          className="monitor-map-canvas"
          style={{
            "--monitor-map-shift-x": `${mapShiftX}px`,
          } as CSSProperties}
        />
        {loadState === "loading" && (
          <div className="monitor-map-state"><i />Initializing hybrid globe</div>
        )}
        {loadState === "error" && (
          <div className="monitor-map-state" data-error>Map unavailable</div>
        )}
      </div>
    );
  },
);
