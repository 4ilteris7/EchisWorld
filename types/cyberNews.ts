export type CyberNewsContext = {
  /** Fallback country label from the RSS item itself (engine hits win in UI). */
  country: string;
  hackIncident: string;
  /** Fallback sector label from the RSS category (engine hits win in UI). */
  targetSector: string;
  contextSummary: string;
  firstSeen: string;
  lastUpdate: string;
};

export type CyberNewsItem = {
  id: string;
  headline: string;
  source: string;
  timeAgo: string;
  summary: string;
  categoryTag: string;
  url?: string;
  publishedAt?: string;
  isLive?: boolean;
  context: CyberNewsContext;
};
