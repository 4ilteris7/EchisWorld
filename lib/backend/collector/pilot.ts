// Collection rollout scope. Grew phase-by-phase: F2D pilot (8 Cyber) →
// F4A (+14 Defense) → F4B (+17 Policy) → F5 full fleet.
//
// F5 (24 Tem 2026): the user explicitly overrode the §22.3 seven-day gate
// ("hemen tam geçiş") after the blocking risk was explained, so the whole
// canonical manifest is collected. Per-source cadence keeps adapting from
// observed data; sources that block us go into backoff automatically.

import {
  CANONICAL_SOURCE_MANIFEST,
  type CanonicalSourceManifestEntry,
} from "@/lib/backend/sources/manifest";

export const PILOT_SOURCE_IDS: readonly string[] =
  CANONICAL_SOURCE_MANIFEST.map((entry) => entry.sourceId);

export function pilotManifestEntries(): CanonicalSourceManifestEntry[] {
  return [...CANONICAL_SOURCE_MANIFEST];
}
