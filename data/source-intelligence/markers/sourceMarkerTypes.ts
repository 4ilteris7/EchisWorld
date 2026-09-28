import type {
  GeoBasis,
  IntelligenceEventCandidate,
  SourceBasis,
} from "../sourceIntelligenceTypes";

export type MarkerFeatureLike = {
  id: string;
  lng: number;
  lat: number;
  category?: string;
  severity?: string;
  timestamp?: string;
};

export type SourceMarkerCandidate = {
  id: string;
  eventId: string;
  itemIds: string[];

  title: string;
  summary?: string;

  latitude: number;
  longitude: number;
  locationLabel: string;

  markerType:
    | "official_statement"
    | "diplomatic_activity"
    | "conflict"
    | "peace_process"
    | "crisis"
    | "sanctions"
    | "international_org";

  severity: "monitoring" | "important" | "high_interest";

  sourceBasis: SourceBasis;
  tags: string[];

  publishedAt?: string;
  lastUpdatedAt?: string;

  geoBasis: GeoBasis;
};

export interface SourceMarkerFeature extends MarkerFeatureLike {
  locationName: string;
  candidate: SourceMarkerCandidate;
  items: IntelligenceEventCandidate[];
}
