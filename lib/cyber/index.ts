// Public barrel for the cyber signal analysis module.
// UI code should import from here.

export { analyzeCyberSignals } from "./analyzeCyberSignals";
export { detectGeoSignals } from "./regionDetection";
export { detectSectors } from "./sectorDetection";
export { REGIONS, regionLabel } from "./geoLexicon";
export { SECTOR_LABELS } from "./sectorLexicon";
export type {
  AnalyzeOptions,
  ActorHit,
  CountryHit,
  CyberSignalInput,
  CyberSignalResult,
  GeoRole,
  ItemAnnotation,
  RegionId,
  RegionMetric,
  SectorHit,
  SectorId,
  SectorMetric,
  SignalConfidence,
} from "./types";
