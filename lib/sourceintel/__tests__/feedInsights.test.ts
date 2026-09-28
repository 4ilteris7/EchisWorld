/* ---------------------------------------------------------------------------
 * Self-contained test harness for the Global View feed insight helpers.
 * No test-runner dependency. Run:
 *
 *   tmp="$(mktemp -d)"
 *   ./node_modules/.bin/tsc --module commonjs --moduleResolution node --target es2020 \
 *     --strict --esModuleInterop --skipLibCheck --outDir "$tmp" \
 *     lib/sourceintel/__tests__/feedInsights.test.ts
 *   node "$tmp/__tests__/feedInsights.test.js"
 * ------------------------------------------------------------------------- */

import {
  clusterCorroboratedItems,
  confidenceTier,
  regionLabelForItem,
  type FeedInsightItem,
} from "../feedInsights";

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else failures.push(`✗ ${name}${detail ? ` — ${detail}` : ""}`);
}

const BASE = "2026-06-30T12:00:00.000Z";
function mk(partial: Partial<FeedInsightItem> & { id: string; title: string; sourceId: string }): FeedInsightItem {
  return {
    sourceName: partial.sourceId,
    primaryDomain: "conflict",
    priorityScore: 50,
    publishedAt: BASE,
    ...partial,
  };
}

// ── Corroboration clustering ────────────────────────────────────────────────

(() => {
  // Same story, three different sources, near-identical titles → one cluster.
  const items = [
    mk({ id: "a", sourceId: "reuters", title: "Israel launches airstrikes on southern Lebanon", priorityScore: 60 }),
    mk({ id: "b", sourceId: "aljazeera", title: "Israeli airstrikes hit southern Lebanon overnight", priorityScore: 55 }),
    mk({ id: "c", sourceId: "bbc", title: "Southern Lebanon struck by Israeli airstrikes", priorityScore: 40 }),
  ];
  const clusters = clusterCorroboratedItems(items);
  check("[cluster] same story merges to 1", clusters.length === 1, `got ${clusters.length}`);
  check("[cluster] sourceCount=3", clusters[0]?.sourceCount === 3, `got ${clusters[0]?.sourceCount}`);
  check("[cluster] primary is highest priority (reuters)", clusters[0]?.primary.id === "a", `got ${clusters[0]?.primary.id}`);
})();

(() => {
  // Distinct stories in same domain must NOT merge.
  const items = [
    mk({ id: "a", sourceId: "reuters", title: "Israel launches airstrikes on southern Lebanon" }),
    mk({ id: "b", sourceId: "reuters", title: "Sudan army clashes with RSF near Khartoum" }),
  ];
  const clusters = clusterCorroboratedItems(items);
  check("[cluster] distinct stories stay separate", clusters.length === 2, `got ${clusters.length}`);
})();

(() => {
  // Same words but different domain must NOT merge.
  const items = [
    mk({ id: "a", sourceId: "reuters", title: "Russia and Ukraine hold prisoner exchange talks", primaryDomain: "conflict" }),
    mk({ id: "b", sourceId: "tass", title: "Russia and Ukraine hold prisoner exchange talks", primaryDomain: "diplomacy" }),
  ];
  const clusters = clusterCorroboratedItems(items);
  check("[cluster] different domain does not merge", clusters.length === 2, `got ${clusters.length}`);
})();

(() => {
  // Outside the time window → separate even if titles match.
  const items = [
    mk({ id: "a", sourceId: "reuters", title: "Iran sanctions announced by United States", primaryDomain: "sanctions_law", publishedAt: "2026-06-30T12:00:00.000Z" }),
    mk({ id: "b", sourceId: "ap", title: "Iran sanctions announced by United States", primaryDomain: "sanctions_law", publishedAt: "2026-06-25T12:00:00.000Z" }),
  ];
  const clusters = clusterCorroboratedItems(items);
  check("[cluster] out-of-window does not merge", clusters.length === 2, `got ${clusters.length}`);
})();

(() => {
  // Lower title similarity but shared salient country → entity-assisted merge.
  const items = [
    mk({
      id: "a", sourceId: "reuters", primaryDomain: "conflict",
      title: "Ukraine reports major overnight drone barrage on Kyiv",
      entityRoles: { affectedCountry: "Ukraine" },
    }),
    mk({
      id: "b", sourceId: "guardian", primaryDomain: "conflict",
      title: "Kyiv hit by wave of drones, Ukraine air force says",
      entityRoles: { affectedCountry: "Ukraine" },
    }),
  ];
  const clusters = clusterCorroboratedItems(items);
  check("[cluster] entity-assisted merge", clusters.length === 1, `got ${clusters.length}`);
})();

(() => {
  // Corroboration counts DISTINCT sources, not repeats from one source.
  const items = [
    mk({ id: "a", sourceId: "reuters", title: "Gaza ceasefire talks resume in Cairo", primaryDomain: "peace_process" }),
    mk({ id: "b", sourceId: "reuters", title: "Gaza ceasefire talks resume in Cairo today", primaryDomain: "peace_process" }),
  ];
  const clusters = clusterCorroboratedItems(items);
  check("[cluster] same-source repeat merges", clusters.length === 1, `got ${clusters.length}`);
  check("[cluster] sourceCount=1 for same source", clusters[0]?.sourceCount === 1, `got ${clusters[0]?.sourceCount}`);
})();

// ── Confidence ──────────────────────────────────────────────────────────────

check("[confidence] high on strong score", confidenceTier(mk({ id: "x", sourceId: "s", title: "t", priorityScore: 85 })).level === "high");
check("[confidence] medium mid score", confidenceTier(mk({ id: "x", sourceId: "s", title: "t", priorityScore: 45 })).level === "medium");
check("[confidence] low on weak score", confidenceTier(mk({ id: "x", sourceId: "s", title: "t", priorityScore: 20 })).level === "low");
check(
  "[confidence] official verification lifts band",
  confidenceTier(mk({ id: "x", sourceId: "s", title: "t", priorityScore: 50, verificationStatus: "official" })).level === "high",
);
check(
  "[confidence] strong geo evidence lifts score",
  confidenceTier(mk({ id: "x", sourceId: "s", title: "t", priorityScore: 62, geoBasis: { evidenceDetails: [{ strength: "strong" }] } })).level === "high",
);

// ── Region label ────────────────────────────────────────────────────────────

check("[region] prefers geoBasis.region", regionLabelForItem(mk({ id: "x", sourceId: "s", title: "t", geoBasis: { region: "Levant" } })) === "Levant");
check(
  "[region] falls back to targetCountry",
  regionLabelForItem(mk({ id: "x", sourceId: "s", title: "t", entityRoles: { targetCountry: "Taiwan" } })) === "Taiwan",
);
check("[region] undefined when no geo", regionLabelForItem(mk({ id: "x", sourceId: "s", title: "t" })) === undefined);

// ===========================================================================

console.log(`\n${"=".repeat(56)}`);
if (failures.length === 0) {
  console.log(`✓ ALL PASSED — ${passed} assertions`);
  console.log("=".repeat(56));
  process.exit(0);
} else {
  console.log(`✓ ${passed} passed   ✗ ${failures.length} failed`);
  console.log("-".repeat(56));
  for (const f of failures) console.log(f);
  console.log("=".repeat(56));
  process.exit(1);
}
