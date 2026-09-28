// ---------------------------------------------------------------------------
// Sector lexicon — weighted, context-aware keyword model.
//
// Each sector owns a set of [term, weight] patterns:
//   weight 3 = strong/unambiguous multi-word phrase
//   weight 2 = solid single signal
//   weight 1 = weak/ambiguous — contributes but never qualifies alone
//
// An item is mapped to a sector when its summed score for that sector reaches
// SECTOR_MATCH_THRESHOLD. An item may map to several sectors.
//
// Disambiguation is handled by *which phrases exist*, not by post-hoc rules:
//   • bare "exchange" is deliberately absent. "crypto exchange" → finance,
//     "exchange server" / "microsoft exchange" → enterprise_infra.
//   • "supply chain attack" lives only in software_supply_chain; transport
//     uses "logistics"/"freight" so the two never collide.
//   • generic, everywhere-words ("software", "server", "github", "credentials")
//     are weight 1 so they colour a match but can't manufacture one.
// ---------------------------------------------------------------------------

import type { SectorId } from "./types";
import { normalizeText } from "./normalize";

/** Score an item needs for a sector to count. */
export const SECTOR_MATCH_THRESHOLD = 2;

type Pattern = readonly [term: string, weight: number];

export interface SectorEntry {
  sectorId: SectorId;
  label: string;
  patterns: readonly Pattern[];
}

export const SECTORS: readonly SectorEntry[] = [
  {
    sectorId: "finance_crypto",
    label: "Finance & Crypto",
    patterns: [
      ["crypto exchange", 3], ["cryptocurrency exchange", 3], ["crypto wallet", 3],
      ["payment processor", 3], ["defi protocol", 3], ["crypto heist", 3], ["swift network", 3],
      ["bank", 2], ["banking", 2], ["banks", 2], ["fintech", 2], ["payment", 2],
      ["payments", 2], ["cryptocurrency", 2], ["crypto", 2], ["bitcoin", 2], ["ethereum", 2],
      ["blockchain", 2], ["wallet", 2], ["stablecoin", 2], ["atm", 2], ["credit card", 2],
      ["debit card", 2], ["payment card", 2], ["financial institution", 2], ["stock exchange", 2],
      ["trading platform", 2], ["brokerage", 2], ["insurer", 2], ["insurance company", 2],
      ["finance", 1], ["financial", 1], ["investment", 1], ["fund", 1],
    ],
  },
  {
    sectorId: "healthcare",
    label: "Healthcare",
    patterns: [
      ["healthcare provider", 3], ["hospital network", 3], ["medical records", 3],
      ["patient data", 3], ["health system", 3], ["health insurer", 3],
      ["hospital", 2], ["hospitals", 2], ["healthcare", 2], ["health care", 2],
      ["medical", 2], ["clinic", 2], ["clinics", 2], ["patient", 2], ["patients", 2],
      ["pharmaceutical", 2], ["pharma", 2], ["biotech", 2], ["ehr", 2], ["medical device", 2],
      ["health", 1], ["doctors", 1], ["nurses", 1],
    ],
  },
  {
    sectorId: "government",
    label: "Government",
    patterns: [
      ["government agency", 3], ["federal agency", 3], ["state agency", 3],
      ["public sector", 3], ["local government", 3], ["election infrastructure", 3],
      ["government network", 3],
      ["government", 2], ["governments", 2], ["govt", 2], ["federal", 2], ["ministry", 2],
      ["municipal", 2], ["parliament", 2], ["embassy", 2], ["diplomatic", 2],
      ["election", 2], ["elections", 2], ["civil service", 2], ["city council", 2],
      ["official", 1], ["authorities", 1], ["agency", 1],
    ],
  },
  {
    sectorId: "defense_military",
    label: "Defense & Military",
    patterns: [
      ["defense contractor", 3], ["defence contractor", 3], ["military network", 3],
      ["defense industrial base", 3], ["weapons systems", 3], ["missile defense", 3],
      ["military", 2], ["defense", 2], ["defence", 2], ["army", 2], ["navy", 2],
      ["air force", 2], ["pentagon", 2], ["armed forces", 2], ["warship", 2],
      ["missile", 2], ["ministry of defense", 2], ["defense ministry", 2],
      ["troops", 1], ["soldiers", 1],
    ],
  },
  {
    sectorId: "cloud_identity",
    label: "Cloud & Identity",
    patterns: [
      ["identity provider", 3], ["single sign-on", 3], ["active directory", 3],
      ["azure ad", 3], ["microsoft entra", 3], ["entra id", 3], ["cloud infrastructure", 3],
      ["saas platform", 3], ["oauth token", 3], ["access token theft", 3],
      ["cloud", 2], ["aws", 2], ["amazon web services", 2], ["azure", 2],
      ["google cloud", 2], ["gcp", 2], ["saas", 2], ["okta", 2], ["iam", 2],
      ["sso", 2], ["kerberos", 2], ["ldap", 2], ["mfa bypass", 2], ["federation", 2],
      ["oauth", 2], ["openid", 2], ["service account", 2], ["session token", 2], ["identity", 2],
      ["credentials", 1], ["credential", 1], ["authentication", 1], ["login", 1],
    ],
  },
  {
    sectorId: "software_supply_chain",
    label: "Software Supply Chain",
    patterns: [
      ["supply chain attack", 3], ["software supply chain", 3], ["malicious package", 3],
      ["malicious packages", 3], ["typosquat", 3], ["dependency confusion", 3],
      ["compromised package", 3], ["poisoned dependency", 3], ["build pipeline", 3],
      ["npm", 2], ["pypi", 2], ["rubygems", 2], ["nuget", 2], ["maven", 2],
      ["packagist", 2], ["crates.io", 2], ["open source package", 2], ["dependency", 2],
      ["dependencies", 2], ["github action", 2], ["ci/cd", 2], ["docker hub", 2],
      ["container image", 2], ["sbom", 2], ["third-party library", 2],
      ["github", 1], ["gitlab", 1], ["repository", 1], ["package", 1],
    ],
  },
  {
    sectorId: "industrial_ot",
    label: "Industrial & OT",
    patterns: [
      ["industrial control system", 3], ["operational technology", 3],
      ["industrial control", 3], ["scada system", 3], ["ot security", 3],
      ["ics", 2], ["scada", 2], ["plc", 2], ["industrial", 2], ["manufacturing", 2],
      ["factory", 2], ["factories", 2], ["programmable logic controller", 2],
      ["plant", 1], ["sensors", 1],
    ],
  },
  {
    sectorId: "enterprise_infra",
    label: "Enterprise Infrastructure",
    patterns: [
      ["vpn appliance", 3], ["edge device", 3], ["managed file transfer", 3],
      ["exchange server", 3], ["microsoft exchange", 3],
      ["vpn", 2], ["firewall", 2], ["router", 2], ["routers", 2], ["gateway", 2],
      ["fortinet", 2], ["fortios", 2], ["fortigate", 2], ["cisco", 2], ["palo alto", 2],
      ["ivanti", 2], ["citrix", 2], ["sonicwall", 2], ["juniper", 2], ["big-ip", 2],
      ["vmware", 2], ["esxi", 2], ["load balancer", 2], ["nas device", 2],
      ["remote desktop", 2], ["rdp", 2], ["endpoint", 2], ["email server", 2],
      ["server", 1], ["servers", 1], ["appliance", 1],
    ],
  },
  {
    sectorId: "telecom",
    label: "Telecom",
    patterns: [
      ["telecom operator", 3], ["telecommunications company", 3], ["mobile carrier", 3],
      ["5g network", 3],
      ["telecom", 2], ["telecommunications", 2], ["telco", 2], ["isp", 2],
      ["internet service provider", 2], ["5g", 2], ["sim swap", 2], ["sim swapping", 2],
      ["cellular network", 2], ["broadband provider", 2],
      ["carrier", 1],
    ],
  },
  {
    sectorId: "energy_utilities",
    label: "Energy & Utilities",
    patterns: [
      ["critical infrastructure", 3], ["power grid", 3], ["electric utility", 3],
      ["water treatment", 3], ["nuclear plant", 3], ["gas pipeline", 3], ["energy sector", 3],
      ["oil and gas", 2], ["pipeline operator", 2], ["pipeline", 2], ["utility", 2],
      ["utilities", 2], ["substation", 2], ["water utility", 2], ["renewable energy", 2],
      ["power company", 2],
      ["energy", 1],
    ],
  },
  {
    sectorId: "retail_ecommerce",
    label: "Retail & E-commerce",
    patterns: [
      ["point-of-sale", 3], ["pos terminal", 3], ["e-commerce platform", 3],
      ["payment skimmer", 3], ["magecart", 3], ["online store", 3],
      ["retailer", 2], ["retailers", 2], ["retail chain", 2], ["e-commerce", 2],
      ["ecommerce", 2], ["online retailer", 2], ["checkout", 2], ["magento", 2],
      ["shopify", 2], ["hospitality", 2], ["hotel chain", 2], ["casino", 2],
      ["store", 1], ["merchant", 1],
    ],
  },
  {
    sectorId: "education_research",
    label: "Education & Research",
    patterns: [
      ["higher education", 3], ["school district", 3], ["research institution", 3],
      ["university network", 3],
      ["university", 2], ["universities", 2], ["college", 2], ["colleges", 2],
      ["school", 2], ["schools", 2], ["education sector", 2], ["academic", 2],
      ["edtech", 2], ["k-12", 2],
      ["students", 1], ["campus", 1], ["faculty", 1],
    ],
  },
  {
    sectorId: "media_entertainment",
    label: "Media & Entertainment",
    patterns: [
      ["social media platform", 3], ["streaming service", 3], ["news outlet", 3],
      ["media company", 2], ["broadcaster", 2], ["newspaper", 2], ["gaming company", 2],
      ["game studio", 2], ["film studio", 2], ["entertainment company", 2],
      ["media", 1], ["gaming", 1], ["journalists", 1],
    ],
  },
  {
    sectorId: "transportation_logistics",
    label: "Transportation & Logistics",
    patterns: [
      ["air traffic", 3], ["aviation sector", 3], ["maritime sector", 3],
      ["airline", 2], ["airlines", 2], ["airport", 2], ["aviation", 2], ["railway", 2],
      ["rail operator", 2], ["shipping company", 2], ["maritime", 2], ["port operator", 2],
      ["logistics", 2], ["freight", 2], ["seaport", 2], ["transit agency", 2],
      ["transport", 1],
    ],
  },
  {
    sectorId: "technology",
    label: "Technology",
    patterns: [
      ["semiconductor", 2], ["chipmaker", 2], ["chip manufacturer", 2], ["tech giant", 2],
      ["software vendor", 2], ["technology firm", 2], ["saas vendor", 2],
      ["software", 1], ["app", 1], ["platform", 1], ["startup", 1],
    ],
  },
];

export interface NormalizedSectorPattern {
  term: string;
  weight: number;
}

export interface NormalizedSector {
  sectorId: SectorId;
  label: string;
  patterns: readonly NormalizedSectorPattern[];
}

export const NORMALIZED_SECTORS: readonly NormalizedSector[] = SECTORS.map((s) => ({
  sectorId: s.sectorId,
  label: s.label,
  // Longest term first so multi-word phrases are reported before their fragments.
  patterns: s.patterns
    .map(([term, weight]) => ({ term: normalizeText(term), weight }))
    .sort((a, b) => b.term.length - a.term.length),
}));

export const SECTOR_LABELS: Record<SectorId, string> = SECTORS.reduce(
  (acc, s) => {
    acc[s.sectorId] = s.label;
    return acc;
  },
  {} as Record<SectorId, string>,
);
