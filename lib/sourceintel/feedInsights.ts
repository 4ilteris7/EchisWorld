// ---------------------------------------------------------------------------
// Global View feed insights — pure, framework-free helpers.
//
// These read the already-computed pipeline output (IntelligenceEventCandidate)
// and derive PRESENTATION-ONLY signals. They add NOTHING to detection and touch
// no pipeline state — they only reshape what the pipeline already produced:
//
//   • clusterCorroboratedItems() — group near-duplicate stories reported by
//     multiple sources ("corroboration"), so the feed can collapse repeats and
//     show a "N sources" badge instead of N near-identical cards.
//   • confidenceTier()           — a display confidence band from priorityScore
//     + verification + geo-evidence strength.
//   • regionLabelForItem()       — a short region/country label for the card.
//
// Everything is inferred from open-source text (OSINT-safe). Nothing here is a
// verified attribution.
//
// The helpers accept a minimal structural shape (`FeedInsightItem`) so they are
// unit-testable without constructing a full IntelligenceEventCandidate.
// ---------------------------------------------------------------------------

export interface FeedInsightGeoBasis {
  label?: string;
  region?: string;
  evidenceDetails?: ReadonlyArray<{ strength?: "strong" | "moderate" | "weak" }>;
}

export interface FeedInsightEntityRoles {
  targetCountry?: string;
  affectedCountry?: string;
  eventLocation?: string;
  primaryActorCountry?: string;
  issuingCountry?: string;
}

/** Minimal shape the helpers need; IntelligenceEventCandidate satisfies it. */
export interface FeedInsightItem {
  id: string;
  title: string;
  sourceId: string;
  sourceName: string;
  primaryDomain: string;
  priorityScore: number;
  verificationStatus?: string;
  publishedAt?: string;
  collectedAt?: string;
  geoBasis?: FeedInsightGeoBasis;
  entityRoles?: FeedInsightEntityRoles;
}

// ── Confidence ──────────────────────────────────────────────────────────────

export type ConfidenceLevel = "high" | "medium" | "low";

const OFFICIAL_VERIFICATIONS = new Set(["official", "official_entry", "official_statement"]);

/**
 * Display confidence band. Rooted in the pipeline's own thresholds
 * (FILTER_ACCEPTANCE_THRESHOLD = 25, STRONG_MARKER_THRESHOLD = 70): a strong
 * priority score, official verification, or strong geo evidence each lift the
 * band. Purely for the card indicator — not an attribution claim.
 */
export function confidenceTier(item: FeedInsightItem): {
  level: ConfidenceLevel;
  label: string;
} {
  let score = item.priorityScore ?? 0;

  if (item.verificationStatus && OFFICIAL_VERIFICATIONS.has(item.verificationStatus)) {
    score += 25;
  }
  const hasStrongGeo = item.geoBasis?.evidenceDetails?.some(
    (e) => e.strength === "strong",
  );
  if (hasStrongGeo) score += 10;

  const level: ConfidenceLevel = score >= 70 ? "high" : score >= 40 ? "medium" : "low";
  const label = level === "high" ? "High" : level === "medium" ? "Medium" : "Low";
  return { level, label };
}

// ── Region label ────────────────────────────────────────────────────────────

/** Short region/country label for the card, preferring resolved geo evidence. */
export function regionLabelForItem(item: FeedInsightItem): string | undefined {
  const roles = item.entityRoles;
  const candidate =
    item.geoBasis?.region ||
    item.geoBasis?.label ||
    roles?.targetCountry ||
    roles?.affectedCountry ||
    roles?.eventLocation ||
    roles?.primaryActorCountry ||
    roles?.issuingCountry;
  if (!candidate) return undefined;
  const trimmed = candidate.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

// ── Corroboration clustering ────────────────────────────────────────────────

const TITLE_STOPWORDS = new Set([
  // English
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "at",
  "by", "from", "as", "is", "are", "was", "were", "be", "been", "after", "over",
  "amid", "into", "new", "says", "say", "said", "report", "reports", "reported",
  "reportedly", "update", "live", "video", "watch", "photos", "breaking",
  // Turkish
  "ve", "ile", "icin", "de", "da", "bir", "bu", "o", "ama", "cok", "gibi",
]);

/** Light suffix fold so cross-outlet variants unify: plural "drones"→"drone",
 *  "airstrikes"→"airstrike", "talks"→"talk". Conservative (only trailing -s on
 *  longer tokens); no aggressive stemming that could collide unrelated words. */
function foldToken(token: string): string {
  if (token.length >= 5 && token.endsWith("s") && !token.endsWith("ss")) {
    return token.slice(0, -1);
  }
  return token;
}

function normalizeTitleTokens(title: string): Set<string> {
  const cleaned = title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ı/g, "i")
    .replace(/[^a-z0-9\s]+/g, " ");
  const tokens = cleaned
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !TITLE_STOPWORDS.has(t))
    .map(foldToken);
  return new Set(tokens);
}

function intersectionCount(a: Set<string>, b: Set<string>): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let count = 0;
  for (const t of small) if (large.has(t)) count += 1;
  return count;
}

/** Overlap coefficient: intersection / size of the smaller set. More forgiving
 *  than Jaccard for headlines of different lengths about the same event. */
function overlapCoefficient(a: Set<string>, b: Set<string>): number {
  const minSize = Math.min(a.size, b.size);
  if (minSize === 0) return 0;
  return intersectionCount(a, b) / minSize;
}

function itemTimeMs(item: FeedInsightItem): number | null {
  const raw = item.publishedAt ?? item.collectedAt;
  if (!raw) return null;
  const t = new Date(raw).getTime();
  return Number.isNaN(t) ? null : t;
}

function salientCountry(item: FeedInsightItem): string | undefined {
  const roles = item.entityRoles;
  return (
    roles?.targetCountry ||
    roles?.affectedCountry ||
    roles?.eventLocation ||
    roles?.primaryActorCountry ||
    item.geoBasis?.region ||
    undefined
  );
}

export interface FeedCluster<T extends FeedInsightItem = FeedInsightItem> {
  /** Highest-priority member — the card actually rendered. */
  primary: T;
  /** All members (incl. primary), primary first. */
  members: T[];
  /** Distinct source count = corroboration strength. */
  sourceCount: number;
  /** Distinct corroborating source names (primary's source first). */
  sourceNames: string[];
}

// Overlap-coefficient thresholds with an absolute-intersection floor so a tiny
// generic title cannot be swallowed by a longer one on 1–2 shared words.
const OVERLAP_THRESHOLD = 0.5;
const STRONG_MIN_INTERSECTION = 3; // pure title path
const ASSIST_MIN_INTERSECTION = 2; // when a salient country is shared
const CLUSTER_TIME_WINDOW_MS = 48 * 60 * 60 * 1000;

/**
 * Group near-duplicate stories reported across sources. Conservative by design
 * (false merges are worse than misses): two items cluster only when they share
 * the same `primaryDomain` AND their titles are strongly similar — with a lower
 * similarity bar allowed when they also share a salient country — AND they fall
 * within a 48h window. Greedy single pass; input order is preserved by primary.
 */
export function clusterCorroboratedItems<T extends FeedInsightItem>(
  items: readonly T[],
): FeedCluster<T>[] {
  interface WorkingCluster {
    members: T[];
    tokens: Set<string>; // representative (primary) tokens
    domain: string;
    country?: string;
    timeMs: number | null;
  }
  const clusters: WorkingCluster[] = [];

  for (const item of items) {
    const tokens = normalizeTitleTokens(item.title);
    const country = salientCountry(item)?.toLowerCase();
    const timeMs = itemTimeMs(item);

    let placed = false;
    for (const cluster of clusters) {
      if (cluster.domain !== item.primaryDomain) continue;

      if (cluster.timeMs !== null && timeMs !== null) {
        if (Math.abs(cluster.timeMs - timeMs) > CLUSTER_TIME_WINDOW_MS) continue;
      }

      const overlap = overlapCoefficient(cluster.tokens, tokens);
      const inter = intersectionCount(cluster.tokens, tokens);
      const sharesCountry = !!country && !!cluster.country && country === cluster.country;
      const matches =
        overlap >= OVERLAP_THRESHOLD &&
        (inter >= STRONG_MIN_INTERSECTION ||
          (sharesCountry && inter >= ASSIST_MIN_INTERSECTION));

      if (matches) {
        cluster.members.push(item);
        placed = true;
        break;
      }
    }

    if (!placed) {
      clusters.push({ members: [item], tokens, domain: item.primaryDomain, country, timeMs });
    }
  }

  return clusters.map((cluster) => {
    const members = [...cluster.members].sort((a, b) => {
      const scoreDelta = (b.priorityScore ?? 0) - (a.priorityScore ?? 0);
      if (scoreDelta !== 0) return scoreDelta;
      return (itemTimeMs(b) ?? 0) - (itemTimeMs(a) ?? 0);
    });
    const primary = members[0];
    const sourceNames: string[] = [];
    const seenSources = new Set<string>();
    for (const m of members) {
      if (seenSources.has(m.sourceId)) continue;
      seenSources.add(m.sourceId);
      sourceNames.push(m.sourceName);
    }
    return {
      primary,
      members,
      sourceCount: seenSources.size,
      sourceNames,
    };
  });
}
