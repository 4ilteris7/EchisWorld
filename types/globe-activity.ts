import type { CollectionMethod, SourceBasis } from "@/data/source-intelligence/sourceIntelligenceTypes";

export const GLOBE_ACTIVITY_SNAPSHOT_VERSION = 1 as const;

export type GlobeActivitySnapshotState =
  | "loading"
  | "fresh"
  | "partial"
  | "stale"
  | "unavailable";

export type GlobeActivityLevel = "high" | "medium" | "low";
export type GlobeActivityGeoConfidence = "high" | "medium";

export type GlobeActivityPoint = {
  id: string;
  lng: number;
  lat: number;
  locationLabel: string;
  headline: string;
  sourceName: string;
  sourceUrl?: string;
  sourceBasis: SourceBasis;
  collectionMethod: CollectionMethod;
  publishedAt?: string;
  observedAt: string;
  itemCount: number;
  sourceCount: number;
  level: GlobeActivityLevel;
  geoConfidence: GlobeActivityGeoConfidence;
};

export type GlobeActivitySnapshot = {
  schemaVersion: typeof GLOBE_ACTIVITY_SNAPSHOT_VERSION;
  sourceMode: "visitor_pipeline" | "scheduled_collector";
  state: GlobeActivitySnapshotState;
  generatedAt: string | null;
  expiresAt: string | null;
  windowHours: number;
  totalItemCount: number;
  geolocatedItemCount: number;
  points: GlobeActivityPoint[];
};
