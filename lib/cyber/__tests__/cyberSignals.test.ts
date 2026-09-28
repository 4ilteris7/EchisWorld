/* ---------------------------------------------------------------------------
 * Self-contained test harness for the cyber signal engine.
 *
 * No test-runner dependency (the project ships none). Runs as a plain script:
 *
 *   npx tsc --module commonjs --moduleResolution node --target es2020 \
 *       --strict --esModuleInterop --skipLibCheck \
 *       --outDir <tmp> lib/cyber/__tests__/cyberSignals.test.ts
 *   node <tmp>/__tests__/cyberSignals.test.js
 *
 * Exits non-zero if any assertion fails. Covers the two layers separately:
 *   1. Role attribution  (detectGeoSignals)   — attacker vs victim correctness
 *   2. Sector detection   (detectSectors)      — sector mapping + disambiguation
 *   3. Rollup metrics     (analyzeCyberSignals) — counting + share semantics
 * ------------------------------------------------------------------------- */

import { detectGeoSignals } from "../regionDetection";
import { detectSectors } from "../sectorDetection";
import { analyzeCyberSignals } from "../analyzeCyberSignals";
import type { GeoRole, SectorId } from "../types";

let passed = 0;
const failures: string[] = [];

function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed += 1;
  } else {
    failures.push(`✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// ── Role-attribution helpers ────────────────────────────────────────────────

function countryRole(title: string, summary: string, country: string) {
  const { countries } = detectGeoSignals(title, summary);
  return countries.find((c) => c.country === country);
}

function expectRole(
  title: string,
  country: string,
  expected: GeoRole,
  summary = "",
): void {
  const hit = countryRole(title, summary, country);
  check(
    `[role] "${title}" → ${country}=${expected}`,
    !!hit && hit.primaryRole === expected,
    hit ? `got primaryRole=${hit.primaryRole}, roles=[${hit.roles.join(",")}]` : "country not detected",
  );
}

function expectCountryAbsent(title: string, country: string, summary = ""): void {
  const hit = countryRole(title, summary, country);
  check(`[absent] "${title}" → no ${country}`, !hit, hit ? `unexpectedly detected as ${hit.primaryRole}` : "");
}

// ── Sector helpers ──────────────────────────────────────────────────────────

function expectSector(title: string, sectorId: SectorId, summary = ""): void {
  const hits = detectSectors(title, summary);
  check(
    `[sector] "${title}" → ${sectorId}`,
    hits.some((h) => h.sectorId === sectorId),
    `got [${hits.map((h) => h.sectorId).join(",") || "none"}]`,
  );
}

function expectSectorAbsent(title: string, sectorId: SectorId, summary = ""): void {
  const hits = detectSectors(title, summary);
  check(
    `[sector-absent] "${title}" → no ${sectorId}`,
    !hits.some((h) => h.sectorId === sectorId),
    `got [${hits.map((h) => h.sectorId).join(",")}]`,
  );
}

// ===========================================================================
// 1. ROLE ATTRIBUTION — attacker (origin) vs victim (target)
// ===========================================================================

// The canonical case from the spec.
expectRole("Chinese hackers target Taiwan's semiconductor industry", "China", "origin");
expectRole("Chinese hackers target Taiwan's semiconductor industry", "Taiwan", "target");

// Passive voice — victim is the subject, attacker after "by".
expectRole("Taiwan was targeted by Chinese state-sponsored hackers", "Taiwan", "target");
expectRole("Taiwan was targeted by Chinese state-sponsored hackers", "China", "origin");

// Cross-region attacker/victim.
expectRole("North Korean hackers target US banks in new campaign", "North Korea", "origin");
expectRole("North Korean hackers target US banks in new campaign", "United States", "target");

expectRole("Russian hackers breach Ukrainian energy companies", "Russia", "origin");
expectRole("Russian hackers breach Ukrainian energy companies", "Ukraine", "target");

// Attacker named only by APT group (no nationality word in the text).
expectRole("Volt Typhoon infiltrates US critical infrastructure networks", "China", "origin");
expectRole("Volt Typhoon infiltrates US critical infrastructure networks", "United States", "target");
expectRole("Sandworm wiper malware hits Ukrainian government agencies", "Russia", "origin");
expectRole("Sandworm wiper malware hits Ukrainian government agencies", "Ukraine", "target");
expectRole("Lazarus Group steals crypto from Japanese exchange", "North Korea", "origin");

// "-linked" / "-backed" tails.
expectRole("China-linked group targets Philippine government", "China", "origin");
expectRole("China-linked group targets Philippine government", "Philippines", "target");
expectRole("Iran-backed actors hit Israeli water utilities", "Iran", "origin");
expectRole("Iran-backed actors hit Israeli water utilities", "Israel", "target");

// Attribution phrases.
expectRole("Espionage campaign attributed to Russia hits EU diplomats", "Russia", "origin");
expectRole("Cyberattack on Saudi Arabia linked to Iran", "Iran", "origin");

// Intelligence-service possessive.
expectRole("Researchers expose Russia's GRU hacking unit operations", "Russia", "origin");

// Victim noun forms.
expectRole("Ransomware gang hits German hospitals and clinics", "Germany", "target");
expectRole("Phishing campaign targets Indian banks and users", "India", "target");

// ===========================================================================
// 2. FALSE-POSITIVE GUARDS — do not hallucinate, do not mis-role
// ===========================================================================

// No country mentioned at all.
expectCountryAbsent("Malicious npm packages steal developer credentials", "United States");
expectCountryAbsent("Critical Fortinet VPN flaw exploited in the wild", "France");

// Vendor/product names must not leak a country.
expectCountryAbsent("Google patches actively exploited Chrome zero-day", "United States");

// Country mentioned without attack role + no attack context → neutral, not target.
expectRole(
  "US firm publishes annual transparency report on data requests",
  "United States",
  "neutral",
);

// "us" pronoun trap — bare "us" is intentionally not a token.
expectCountryAbsent("New malware lets attackers spy on us through webcams", "United States");

// ===========================================================================
// 3. SECTOR DETECTION + DISAMBIGUATION
// ===========================================================================

expectSector("Hackers drain $50M from crypto exchange in wallet breach", "finance_crypto");
expectSector("Ransomware attack disrupts hospital network patient care", "healthcare");
expectSector("Threat actors breach federal government agency network", "government");
expectSector("Malicious npm and PyPI packages found in supply chain attack", "software_supply_chain");
expectSector("Critical Fortinet and Cisco VPN flaws under active exploitation", "enterprise_infra");
expectSector("Volt Typhoon targets US power grid and water treatment plants", "energy_utilities");
expectSector("New attack hits SCADA and ICS in manufacturing plants", "industrial_ot");
expectSector("Okta breach exposes customer identity and SSO tokens", "cloud_identity");
expectSector("Telecom operator breach exposes 5G subscriber data", "telecom");

// Disambiguation: Microsoft Exchange Server is infrastructure, NOT finance.
expectSector("Microsoft Exchange Server zero-day exploited by attackers", "enterprise_infra");
expectSectorAbsent("Microsoft Exchange Server zero-day exploited by attackers", "finance_crypto");

// Disambiguation: a crypto exchange IS finance, not infra.
expectSector("Crypto exchange loses funds in hot wallet hack", "finance_crypto");
expectSectorAbsent("Crypto exchange loses funds in hot wallet hack", "enterprise_infra");

// Weak-only terms must NOT manufacture a sector.
expectSectorAbsent("New software update improves app performance", "technology");

// ===========================================================================
// 4. ROLLUP METRICS — counting + share semantics
// ===========================================================================

(() => {
  // Same-region attacker+victim must count the region ONCE but tag both roles.
  const res = analyzeCyberSignals(
    [{ title: "Chinese hackers target Taiwan's chip firms" }],
    { includeAnnotations: true },
  );
  const ea = res.regions.find((r) => r.regionId === "east_asia");
  check("[rollup] East Asia counted once", !!ea && ea.itemCount === 1, ea ? `itemCount=${ea.itemCount}` : "missing");
  check("[rollup] East Asia has origin role", !!ea && ea.roleBreakdown.origin === 1, ea ? `origin=${ea.roleBreakdown.origin}` : "");
  check("[rollup] East Asia has target role", !!ea && ea.roleBreakdown.target === 1, ea ? `target=${ea.roleBreakdown.target}` : "");
})();

(() => {
  // Cross-region: two separate regions, each tagged with its role.
  const res = analyzeCyberSignals([
    { title: "North Korean Lazarus Group targets US banks" },
  ]);
  const ea = res.regions.find((r) => r.regionId === "east_asia");
  const na = res.regions.find((r) => r.regionId === "north_america");
  check("[rollup] origin region East Asia present", !!ea && ea.roleBreakdown.origin === 1);
  check("[rollup] target region North America present", !!na && na.roleBreakdown.target === 1);
})();

(() => {
  // Share semantics: 4 items, 2 finance → 50%.
  const res = analyzeCyberSignals([
    { title: "Crypto exchange hacked, millions stolen" },
    { title: "Bank customers hit by phishing fraud" },
    { title: "Hospital ransomware disrupts care" },
    { title: "Fortinet VPN zero-day exploited" },
  ]);
  const fin = res.sectors.find((s) => s.sectorId === "finance_crypto");
  check("[share] finance itemCount=2", !!fin && fin.itemCount === 2, fin ? `got ${fin.itemCount}` : "missing");
  check("[share] finance share=0.5", !!fin && Math.abs(fin.share - 0.5) < 1e-9, fin ? `got ${fin.share}` : "");
  check("[share] totalItems=4", res.totalItems === 4);
})();

(() => {
  // Items with no geo signal land in the unspecified bucket.
  const res = analyzeCyberSignals([
    { title: "Malicious npm packages steal developer credentials" },
    { title: "Chinese hackers target Taiwan" },
  ]);
  check("[unspecified] one item has no region", res.unspecifiedRegionItems === 1, `got ${res.unspecifiedRegionItems}`);
})();

(() => {
  const res = analyzeCyberSignals([{ title: "test" }]);
  check("[provenance] flagged inferred", res.inferred === true && res.provenance === "derived_from_rss_text");
})();

// ===========================================================================

console.log(`\n${"=".repeat(60)}`);
if (failures.length === 0) {
  console.log(`✓ ALL PASSED — ${passed} assertions`);
  console.log("=".repeat(60));
  process.exit(0);
} else {
  console.log(`✓ ${passed} passed   ✗ ${failures.length} failed`);
  console.log("-".repeat(60));
  for (const f of failures) console.log(f);
  console.log("=".repeat(60));
  process.exit(1);
}
