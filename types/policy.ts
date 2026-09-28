// Policy / Dossier data model — a diplomatic & geopolitical intelligence feed.
//
// The shape is deliberately self-contained (separate from `OsintEvent`) so a
// real ingestion layer can drop in later without reshaping the screen:
//   - `sourceType` is the COLLECTION CHANNEL. RSS + API feeds both map to
//     `News`; Telegram channels map to `Telegram`. Additional channels
//     (e.g. OSINT / SOCMINT) were intentionally left out and can be added to
//     `PolicyChannel` + `POLICY_CHANNELS` + `POLICY_CHANNEL_COLOR` later.
//   - `region` will come from geotagging / NER on the report text or from the
//     feed's geo metadata.
//   - `sev` is the risk / severity classification.
//   - `minsAgo` is derived from the live item's `publishedAt` timestamp when
//     the worker payload is consumed. `policyView.ts` uses the derived value
//     for time-window filtering and volume buckets.

export type PolicyTopic =
  | "Diplomacy"
  | "Defense & Security"
  | "Economy & Sanctions"
  | "Intl. Organizations"
  | "Official Statements"
  | "Energy"
  | "Crisis & Conflict";

export type PolicyChannel = "News" | "Telegram";

export type PolicySeverity = "critical" | "high" | "medium" | "low";

export type PolicyReport = {
  id: string;
  topic: PolicyTopic;
  region: string;
  /** Collection channel: RSS + API feeds → "News"; Telegram channels → "Telegram". */
  sourceType: PolicyChannel;
  /** Display name, e.g. "Reuters" or "@frontline_intel". */
  source: string;
  /**
   * True when the outlet is publicly documented as state-owned / state-funded
   * (assigned per source id in `usePolicyFeed`). Shown as a transparency badge;
   * it is not a judgement on the item itself.
   */
  stateAffiliated?: boolean;
  sev: PolicySeverity;
  /** Minutes derived from the real publish timestamp; collected time is fallback. */
  minsAgo: number;
  title: string;
  summary: string;
  /** Paragraphs separated by blank lines. */
  body: string;
  tags: string[];
};

/** Topic tabs, in display order (after "All Topics"). */
export const POLICY_TOPICS: PolicyTopic[] = [
  "Diplomacy",
  "Defense & Security",
  "Economy & Sanctions",
  "Intl. Organizations",
  "Official Statements",
  "Energy",
  "Crisis & Conflict",
];

/** Collection channels, in legend order. */
export const POLICY_CHANNELS: PolicyChannel[] = ["News", "Telegram"];

export type PolicyTopicKey = "all" | PolicyTopic;

export const POLICY_TIME_WINDOWS = [3, 6, 12, 24] as const;
export type PolicyTimeWindow = (typeof POLICY_TIME_WINDOWS)[number];

export type PolicySeverityToken = {
  label: string;
  color: string;
  bg: string;
  border: string;
};

// Mapped onto the crimson/silver severity ladder already defined on
// `.cyber-premium` (identical values to the handoff's severity tokens).
export const POLICY_SEV: Record<PolicySeverity, PolicySeverityToken> = {
  critical: { label: "CRITICAL", color: "var(--c-crit)", bg: "var(--c-crit-bg)", border: "var(--c-crit-border)" },
  high:     { label: "HIGH",     color: "var(--c-high)", bg: "var(--c-high-bg)", border: "var(--c-high-border)" },
  medium:   { label: "MEDIUM",   color: "var(--c-med)",  bg: "var(--c-med-bg)",  border: "var(--c-med-border)" },
  low:      { label: "ELEVATED", color: "var(--c-elev)", bg: "var(--c-elev-bg)", border: "var(--c-elev-border)" },
};

export const POLICY_CHANNEL_COLOR: Record<PolicyChannel, string> = {
  News: "var(--c-accent)",
  Telegram: "rgba(196,202,212,0.72)",
};
