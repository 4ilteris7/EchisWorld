/* ---------------------------------------------------------------------------
 * Self-contained test harness for the Defense Industry engine.
 * No test-runner dependency. Run:
 *
 *   tmp="$(mktemp -d)"
 *   ./node_modules/.bin/tsc --module commonjs --moduleResolution node --target es2020 \
 *     --strict --esModuleInterop --skipLibCheck --outDir "$tmp" \
 *     lib/defense/__tests__/defenseSignals.test.ts
 *   node "$tmp/__tests__/defenseSignals.test.js"
 * ------------------------------------------------------------------------- */

import { detectDefense } from "../detect";
import { analyzeDefenseSignals } from "../analyzeDefenseSignals";

let passed = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) passed += 1;
  else failures.push(`✗ ${name}${detail ? ` — ${detail}` : ""}`);
}

// ── Segment detection ───────────────────────────────────────────────────────

check(
  "[segment] frigate → Naval",
  detectDefense("Shipyard lays keel for new frigate program").topSegmentLabel === "Naval",
  detectDefense("Shipyard lays keel for new frigate program").topSegmentLabel,
);
check(
  "[segment] F-35 → Aerospace",
  detectDefense("Air force receives new F-35 Lightning II jets").topSegmentLabel === "Aerospace",
);
check(
  "[segment] Bayraktar drone → UAV / Unmanned",
  detectDefense("Baykar unveils new Bayraktar TB2 drone variant").topSegmentLabel === "UAV / Unmanned",
);
check(
  "[segment] missile → Munitions",
  detectDefense("Army orders thousands of precision-guided artillery shells").topSegmentLabel === "Munitions",
);

// ── Activity classification ─────────────────────────────────────────────────

check(
  "[activity] arms sale → Export Review",
  detectDefense("State Department approves foreign military sale of missiles").activityType === "Export Review",
);
check(
  "[activity] joint venture → Industrial Partnership",
  detectDefense("Two primes sign joint venture for co-production of airframe").activityType === "Industrial Partnership",
);
check(
  "[activity] MRO contract → Sustainment",
  detectDefense("Air force awards MRO and spare parts sustainment contract").activityType === "Sustainment",
);
check(
  "[activity] production ramp → Production Capacity",
  detectDefense("Manufacturer to increase output with new production line").activityType === "Production Capacity",
);

// ── Contractor + program ────────────────────────────────────────────────────

(() => {
  const d = detectDefense("Lockheed Martin delivers F-35 jets to the air force");
  check("[org] Lockheed detected", d.organizationLabel === "Lockheed Martin", d.organizationLabel);
  check("[program] F-35 detected", d.programLabel.startsWith("F-35"), d.programLabel);
})();

// ── Buyer / supplier country role ───────────────────────────────────────────

(() => {
  const d = detectDefense("Poland to buy K2 tanks from South Korea in major deal");
  const poland = d.countries.find((c) => c.country === "Poland");
  const korea = d.countries.find((c) => c.country === "South Korea");
  check("[role] Poland = buyer", poland?.role === "buyer", poland?.role);
  check("[role] South Korea = supplier", korea?.role === "supplier", korea?.role);
  check("[label] supplier → buyer arrow", d.countryRegionLabel.includes("→"), d.countryRegionLabel);
})();

(() => {
  const d = detectDefense("Germany to supply Leopard 2 tanks to Ukraine");
  const germany = d.countries.find((c) => c.country === "Germany");
  check("[role] Germany = supplier (to supply)", germany?.role === "supplier", germany?.role);
})();

// ── Supply chain + stress ───────────────────────────────────────────────────

(() => {
  const d = detectDefense(
    "Semiconductor shortage and export ban disrupt defense supply chain",
    "Chipmakers face extended lead times amid sanctions.",
  );
  check("[commodity] semiconductors detected", d.commodities.some((c) => c.id === "semiconductors"));
  check("[stress] stress signals present", d.hasStress === true);
})();

// ── Relevance gate ──────────────────────────────────────────────────────────

check(
  "[relevance] defense item is relevant",
  detectDefense("Navy commissions new destroyer").relevant === true,
);
check(
  "[relevance] non-defense item is filtered",
  detectDefense("Local bakery wins regional dessert competition").relevant === false,
);

// ── Rollup metrics ──────────────────────────────────────────────────────────

(() => {
  const res = analyzeDefenseSignals([
    { id: "1", title: "Poland to buy K2 tanks from South Korea", source: "Defense News", publishedAt: "2026-06-30T10:00:00Z" },
    { id: "2", title: "Shipyard launches new frigate for the navy", source: "TWZ", publishedAt: "2026-06-30T09:00:00Z" },
    { id: "3", title: "Semiconductor shortage hits missile production amid export ban", source: "Breaking Defense", publishedAt: "2026-06-30T08:00:00Z" },
    { id: "4", title: "Bakery wins dessert contest", source: "Local", publishedAt: "2026-06-30T07:00:00Z" },
  ]);
  check("[rollup] non-defense filtered out", res.relevantItems === 3, `got ${res.relevantItems}`);
  check("[rollup] segments produced", res.segments.length > 0);
  check("[rollup] land systems present", res.segments.some((s) => s.segment === "Land Systems"));
  check("[rollup] supply chain has semiconductors", res.supplyChain.some((s) => s.name === "Semiconductors"));
  check("[rollup] provenance flag", res.provenance === "derived_from_rss_text" && res.inferred === true);
  const semi = res.supplyChain.find((s) => s.name === "Semiconductors");
  check("[rollup] stressed commodity scores higher than a bare mention", !!semi && semi.score >= 12);
})();

(() => {
  // Feed item shape is panel-compatible.
  const res = analyzeDefenseSignals([
    { id: "x", title: "Lockheed Martin wins $2 billion F-35 sustainment contract", source: "Defense News", verificationStatus: "official", publishedAt: "2026-06-30T10:00:00Z" },
  ]);
  const item = res.items[0];
  check("[item] has context", !!item && !!item.context);
  check("[item] activity + priority set", !!item.activityType && !!item.priority);
  check("[item] confidence lifted by official + value", item.context.confidenceLevel >= 3);
})();

// ===========================================================================

console.log(`\n${"=".repeat(58)}`);
if (failures.length === 0) {
  console.log(`✓ ALL PASSED — ${passed} assertions`);
  console.log("=".repeat(58));
  process.exit(0);
} else {
  console.log(`✓ ${passed} passed   ✗ ${failures.length} failed`);
  console.log("-".repeat(58));
  for (const f of failures) console.log(f);
  console.log("=".repeat(58));
  process.exit(1);
}
