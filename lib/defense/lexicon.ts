// ---------------------------------------------------------------------------
// Defense Industry lexicon — segments, supply-chain commodities + stress
// signals, activity types, prime contractors, platforms/programs, and the
// relevance core. Weighted, context-tuned.
//
//   weight 3 = strong/unambiguous multi-word phrase
//   weight 2 = solid single signal
//   weight 1 = weak/ambiguous — colours a match, never qualifies alone
//
// Reuses the cyber module's normalization so matching is deterministic and
// language-agnostic.
// ---------------------------------------------------------------------------

import type {
  DefenseActivityType,
  DefenseSegmentId,
  SupplyChainCommodityId,
} from "./types";
import { normalizeText } from "../cyber/normalize";

type Pattern = readonly [term: string, weight: number];

// ── Industry segments (Key Segments panel) ──────────────────────────────────

export interface SegmentEntry {
  id: DefenseSegmentId;
  label: string;
  patterns: readonly Pattern[];
}

export const SEGMENTS: readonly SegmentEntry[] = [
  {
    id: "aerospace",
    label: "Aerospace",
    patterns: [
      ["combat aircraft", 3], ["fighter jet", 3], ["transport aircraft", 3],
      ["tanker aircraft", 3], ["fifth-generation fighter", 3],
      ["fighter", 2], ["aircraft", 2], ["warplane", 2], ["helicopter", 2],
      ["rotary", 2], ["airframe", 2], ["avionics", 2], ["aerospace", 2],
      ["jet", 1], ["air force", 1],
    ],
  },
  {
    id: "naval",
    label: "Naval",
    patterns: [
      ["aircraft carrier", 3], ["surface combatant", 3], ["naval program", 3],
      ["submarine", 2], ["frigate", 2], ["destroyer", 2], ["corvette", 2],
      ["warship", 2], ["shipyard", 2], ["naval", 2], ["navy", 2],
      ["amphibious", 2], ["maritime patrol", 2], ["patrol vessel", 2],
      ["hull", 1],
    ],
  },
  {
    id: "uav_unmanned",
    label: "UAV / Unmanned",
    patterns: [
      ["unmanned aerial", 3], ["loitering munition", 3], ["unmanned surface", 3],
      ["unmanned ground", 3], ["combat drone", 3],
      ["drone", 2], ["uav", 2], ["ucav", 2], ["unmanned", 2], ["quadcopter", 2],
      ["autonomous system", 2],
    ],
  },
  {
    id: "land_systems",
    label: "Land Systems",
    patterns: [
      ["main battle tank", 3], ["infantry fighting vehicle", 3],
      ["armored vehicle", 2], ["armoured vehicle", 2], ["combat vehicle", 2],
      ["tank", 2], ["howitzer", 2], ["artillery", 2], ["self-propelled", 2],
      ["mrap", 2], ["land systems", 2], ["armored personnel carrier", 3],
    ],
  },
  {
    id: "munitions",
    label: "Munitions",
    patterns: [
      ["precision-guided", 3], ["artillery shell", 3], ["guided missile", 3],
      ["missile", 2], ["ammunition", 2], ["munition", 2], ["warhead", 2],
      ["rocket", 2], ["torpedo", 2], ["hypersonic", 2], ["interceptor", 2],
      ["bomb", 1],
    ],
  },
  {
    id: "electronics",
    label: "Electronics",
    patterns: [
      ["electronic warfare", 3], ["defense electronics", 3], ["signals intelligence", 3],
      ["radar", 2], ["sensor suite", 2], ["electro-optical", 2], ["jamming", 2],
      ["seeker", 2], ["c4isr", 2], ["sensor", 1], ["avionics", 1],
    ],
  },
  {
    id: "space_satellite",
    label: "Space / Satellite",
    patterns: [
      ["space program", 3], ["reconnaissance satellite", 3], ["space force", 3],
      ["satellite", 2], ["launch vehicle", 2], ["spacecraft", 2], ["orbital", 2],
      ["space domain", 2], ["constellation", 2], ["gps", 1],
    ],
  },
  {
    id: "cyber_c4isr",
    label: "Cyber / C4ISR",
    patterns: [
      ["cyber defense", 3], ["critical infrastructure", 3], ["command and control", 3],
      ["cyberattack", 2], ["cyber attack", 2], ["cybersecurity", 2], ["ransomware", 2],
      ["scada", 2], ["ics", 2], ["threat actor", 2], ["zero-day", 2], ["data breach", 2],
      ["malware", 1], ["vulnerability", 1],
    ],
  },
];

export const SEGMENT_LABELS: Record<DefenseSegmentId, string> = SEGMENTS.reduce(
  (acc, s) => {
    acc[s.id] = s.label;
    return acc;
  },
  {} as Record<DefenseSegmentId, string>,
);

// ── Supply-chain commodities + stress signals ───────────────────────────────

export interface CommodityEntry {
  id: SupplyChainCommodityId;
  name: string;
  patterns: readonly Pattern[];
}

export const COMMODITIES: readonly CommodityEntry[] = [
  {
    id: "semiconductors",
    name: "Semiconductors",
    patterns: [
      ["chip shortage", 3], ["semiconductor", 2], ["microchip", 2], ["foundry", 2],
      ["chipmaker", 2], ["wafer", 2], ["gallium", 2], ["integrated circuit", 2],
      ["processor", 1], ["chip", 1],
    ],
  },
  {
    id: "precision_components",
    name: "Precision Components",
    patterns: [
      ["precision component", 3], ["precision machining", 3], ["machined part", 2],
      ["bearing", 2], ["actuator", 2], ["precision part", 2], ["subcomponent", 1],
    ],
  },
  {
    id: "composite_materials",
    name: "Composite Materials",
    patterns: [
      ["composite material", 3], ["composite airframe", 3], ["carbon fiber", 2],
      ["carbon fibre", 2], ["composites", 2], ["prepreg", 2], ["resin", 1],
    ],
  },
  {
    id: "energetic_materials",
    name: "Energetic Materials",
    patterns: [
      ["energetic material", 3], ["rocket motor", 2], ["propellant", 2],
      ["explosive", 2], ["nitrocellulose", 2], ["rdx", 2], ["tnt", 2], ["gunpowder", 1],
    ],
  },
  {
    id: "specialty_metals",
    name: "Specialty Metals",
    patterns: [
      ["rare earth", 3], ["specialty metal", 3], ["titanium", 2], ["tungsten", 2],
      ["cobalt", 2], ["superalloy", 2], ["aluminum alloy", 2], ["magnet", 2],
      ["steel plate", 1],
    ],
  },
  {
    id: "optronics",
    name: "Optronics",
    patterns: [
      ["optronics", 3], ["thermal imaging", 2], ["infrared sensor", 2],
      ["targeting pod", 2], ["night vision", 2], ["seeker head", 2],
      ["electro-optical", 2], ["laser", 1],
    ],
  },
  {
    id: "propulsion",
    name: "Propulsion",
    patterns: [
      ["jet engine", 3], ["rocket engine", 3], ["turbofan", 2], ["gas turbine", 2],
      ["propulsion", 2], ["powerplant", 2], ["engine", 1],
    ],
  },
];

/** Stress signals — presence anywhere in an item amplifies commodity pressure. */
export const SUPPLY_STRESS_SIGNALS: readonly Pattern[] = [
  ["export ban", 3], ["export control", 3], ["export restriction", 3],
  ["shortage", 3], ["bottleneck", 3], ["supply risk", 3], ["scarcity", 3],
  ["embargo", 3], ["sanction", 2], ["sanctions", 2], ["disruption", 2],
  ["disrupted", 2], ["lead time", 2], ["lead times", 2], ["backlog", 2],
  ["delay", 2], ["delays", 2], ["delayed", 2], ["constraint", 2], ["constrained", 2],
  ["dependency", 2], ["dependence", 2], ["stockpile", 2], ["struggle to", 2],
  ["cannot keep up", 3], ["ramp up production", 1], ["halt", 2], ["halted", 2],
];

// ── Activity types ──────────────────────────────────────────────────────────

export interface ActivityEntry {
  type: DefenseActivityType;
  patterns: readonly Pattern[];
}

export const ACTIVITIES: readonly ActivityEntry[] = [
  {
    type: "Export Review",
    patterns: [
      ["foreign military sale", 3], ["arms export", 3], ["defense export", 3],
      ["export license", 3], ["arms sale", 3], ["export approval", 3], ["export ban", 3],
      ["fms", 2], ["itar", 2], ["export control", 2], ["end-user", 2],
    ],
  },
  {
    type: "Industrial Partnership",
    patterns: [
      ["joint venture", 3], ["teaming agreement", 3], ["memorandum of understanding", 3],
      ["co-production", 3], ["cooperation agreement", 3], ["joint development", 3],
      ["strategic partnership", 2], ["partnership", 2], ["consortium", 2], ["mou", 2],
    ],
  },
  {
    type: "Production Capacity",
    patterns: [
      ["production capacity", 3], ["new production line", 3], ["facility expansion", 3],
      ["increase output", 3], ["scale up production", 3], ["boost production", 3],
      ["ramp up", 2], ["ramp-up", 2], ["production rate", 2], ["annual output", 2],
    ],
  },
  {
    type: "Naval Program",
    patterns: [
      ["frigate program", 3], ["submarine program", 3], ["shipbuilding program", 3],
      ["destroyer program", 3], ["corvette program", 3], ["keel laying", 3],
      ["naval program", 3], ["sea trials", 2], ["commissioned", 2],
    ],
  },
  {
    type: "UAV / Aerospace",
    patterns: [
      ["combat aircraft program", 3], ["uav program", 3], ["drone program", 3],
      ["aerospace program", 3], ["first flight", 3], ["maiden flight", 3],
      ["aircraft development", 2], ["aircraft program", 2], ["flight test", 2],
    ],
  },
  {
    type: "Sustainment",
    patterns: [
      ["life extension", 3], ["mro", 3], ["sustainment", 3], ["support contract", 2],
      ["maintenance", 2], ["overhaul", 2], ["spare parts", 2], ["spares", 2],
      ["depot", 2], ["upgrade contract", 2],
    ],
  },
  {
    type: "Supply Chain",
    patterns: [
      ["supply chain", 3], ["tier-1 supplier", 3], ["tier-2 supplier", 3],
      ["lead time", 2], ["shortage", 2], ["sourcing", 2], ["bottleneck", 2],
      ["suppliers", 1], ["components", 1],
    ],
  },
  {
    type: "Procurement",
    patterns: [
      ["framework agreement", 3], ["deal to purchase", 3], ["contract award", 3],
      ["procurement", 2], ["procure", 2], ["acquisition", 2], ["to acquire", 2],
      ["to buy", 2], ["purchase", 2], ["tender", 2], ["order for", 2], ["contract for", 2],
      ["orders", 1], ["select", 1],
    ],
  },
];

// ── Prime contractors ───────────────────────────────────────────────────────

export interface ContractorEntry {
  name: string;
  country?: string;
  segment?: DefenseSegmentId;
  aliases: readonly string[];
}

export const CONTRACTORS: readonly ContractorEntry[] = [
  // United States
  { name: "Lockheed Martin", country: "United States", segment: "aerospace", aliases: ["lockheed martin", "lockheed"] },
  { name: "RTX (Raytheon)", country: "United States", segment: "munitions", aliases: ["raytheon", "rtx", "raytheon technologies"] },
  { name: "Northrop Grumman", country: "United States", segment: "aerospace", aliases: ["northrop grumman", "northrop"] },
  { name: "General Dynamics", country: "United States", segment: "land_systems", aliases: ["general dynamics"] },
  { name: "Boeing", country: "United States", segment: "aerospace", aliases: ["boeing"] },
  { name: "L3Harris", country: "United States", segment: "electronics", aliases: ["l3harris", "l3 harris"] },
  { name: "General Atomics", country: "United States", segment: "uav_unmanned", aliases: ["general atomics"] },
  { name: "Huntington Ingalls", country: "United States", segment: "naval", aliases: ["huntington ingalls"] },
  { name: "Anduril", country: "United States", segment: "uav_unmanned", aliases: ["anduril"] },
  // Europe
  { name: "BAE Systems", country: "United Kingdom", segment: "naval", aliases: ["bae systems"] },
  { name: "Airbus", country: "France", segment: "aerospace", aliases: ["airbus"] },
  { name: "Leonardo", country: "Italy", segment: "aerospace", aliases: ["leonardo"] },
  { name: "Thales", country: "France", segment: "electronics", aliases: ["thales"] },
  { name: "Rheinmetall", country: "Germany", segment: "land_systems", aliases: ["rheinmetall"] },
  { name: "Saab", country: "Sweden", segment: "aerospace", aliases: ["saab"] },
  { name: "MBDA", country: "France", segment: "munitions", aliases: ["mbda"] },
  { name: "Naval Group", country: "France", segment: "naval", aliases: ["naval group"] },
  { name: "Fincantieri", country: "Italy", segment: "naval", aliases: ["fincantieri"] },
  { name: "Dassault", country: "France", segment: "aerospace", aliases: ["dassault"] },
  { name: "Kongsberg", country: "Norway", segment: "munitions", aliases: ["kongsberg"] },
  { name: "KNDS", country: "Germany", segment: "land_systems", aliases: ["knds", "krauss-maffei", "nexter"] },
  { name: "Hensoldt", country: "Germany", segment: "electronics", aliases: ["hensoldt"] },
  // Türkiye
  { name: "Baykar", country: "Türkiye", segment: "uav_unmanned", aliases: ["baykar"] },
  { name: "ASELSAN", country: "Türkiye", segment: "electronics", aliases: ["aselsan"] },
  { name: "Turkish Aerospace (TUSAŞ)", country: "Türkiye", segment: "aerospace", aliases: ["turkish aerospace", "tusas", "tai"] },
  { name: "Roketsan", country: "Türkiye", segment: "munitions", aliases: ["roketsan"] },
  { name: "Havelsan", country: "Türkiye", segment: "cyber_c4isr", aliases: ["havelsan"] },
  { name: "STM", country: "Türkiye", segment: "naval", aliases: ["stm defense", "savunma teknolojileri"] },
  { name: "Otokar", country: "Türkiye", segment: "land_systems", aliases: ["otokar"] },
  { name: "FNSS", country: "Türkiye", segment: "land_systems", aliases: ["fnss"] },
  // Asia-Pacific
  { name: "Hanwha", country: "South Korea", segment: "land_systems", aliases: ["hanwha"] },
  { name: "Korea Aerospace (KAI)", country: "South Korea", segment: "aerospace", aliases: ["korea aerospace", "kai"] },
  { name: "Hyundai Rotem", country: "South Korea", segment: "land_systems", aliases: ["hyundai rotem"] },
  { name: "Mitsubishi Heavy", country: "Japan", segment: "naval", aliases: ["mitsubishi heavy"] },
  { name: "Hindustan Aeronautics (HAL)", country: "India", segment: "aerospace", aliases: ["hindustan aeronautics", "hal"] },
  { name: "AVIC", country: "China", segment: "aerospace", aliases: ["avic"] },
  { name: "NORINCO", country: "China", segment: "land_systems", aliases: ["norinco"] },
  // Israel
  { name: "Israel Aerospace Industries (IAI)", country: "Israel", segment: "aerospace", aliases: ["israel aerospace", "iai"] },
  { name: "Elbit Systems", country: "Israel", segment: "electronics", aliases: ["elbit"] },
  { name: "Rafael", country: "Israel", segment: "munitions", aliases: ["rafael advanced", "rafael"] },
  // Russia
  { name: "Rostec", country: "Russia", segment: "land_systems", aliases: ["rostec"] },
  { name: "Almaz-Antey", country: "Russia", segment: "munitions", aliases: ["almaz-antey"] },
  { name: "United Aircraft (UAC)", country: "Russia", segment: "aerospace", aliases: ["united aircraft", "uac"] },
];

// ── Platforms / programs (also feed segment detection) ──────────────────────

export interface PlatformEntry {
  name: string;
  segment: DefenseSegmentId;
  aliases: readonly string[];
}

export const PLATFORMS: readonly PlatformEntry[] = [
  // Fighters / aircraft
  { name: "F-35 Lightning II", segment: "aerospace", aliases: ["f-35", "f35", "joint strike fighter", "lightning ii"] },
  { name: "F-16", segment: "aerospace", aliases: ["f-16", "f16", "fighting falcon"] },
  { name: "F-15", segment: "aerospace", aliases: ["f-15", "f15"] },
  { name: "Eurofighter Typhoon", segment: "aerospace", aliases: ["eurofighter", "typhoon jet"] },
  { name: "Rafale", segment: "aerospace", aliases: ["rafale"] },
  { name: "Gripen", segment: "aerospace", aliases: ["gripen"] },
  { name: "KAAN", segment: "aerospace", aliases: ["kaan", "tf-x", "tfx"] },
  { name: "KF-21 Boramae", segment: "aerospace", aliases: ["kf-21", "kf21", "boramae"] },
  { name: "GCAP / Tempest", segment: "aerospace", aliases: ["gcap", "tempest fighter"] },
  { name: "FCAS", segment: "aerospace", aliases: ["fcas", "future combat air system"] },
  { name: "B-21 Raider", segment: "aerospace", aliases: ["b-21", "raider bomber"] },
  { name: "A400M", segment: "aerospace", aliases: ["a400m"] },
  { name: "C-130 Hercules", segment: "aerospace", aliases: ["c-130", "hercules"] },
  // UAVs
  { name: "Bayraktar TB2", segment: "uav_unmanned", aliases: ["bayraktar tb2", "tb2"] },
  { name: "Bayraktar Akıncı", segment: "uav_unmanned", aliases: ["akinci", "bayraktar akinci"] },
  { name: "Bayraktar Kızılelma", segment: "uav_unmanned", aliases: ["kizilelma"] },
  { name: "TAI Anka", segment: "uav_unmanned", aliases: ["tai anka", "anka drone"] },
  { name: "MQ-9 Reaper", segment: "uav_unmanned", aliases: ["mq-9", "reaper drone"] },
  { name: "Global Hawk", segment: "uav_unmanned", aliases: ["global hawk"] },
  // Naval
  { name: "Constellation-class", segment: "naval", aliases: ["constellation-class"] },
  { name: "Type 26 Frigate", segment: "naval", aliases: ["type 26"] },
  { name: "Virginia-class", segment: "naval", aliases: ["virginia-class"] },
  { name: "TCG Anadolu", segment: "naval", aliases: ["tcg anadolu"] },
  { name: "MILGEM", segment: "naval", aliases: ["milgem"] },
  // Air / missile defense
  { name: "Patriot", segment: "munitions", aliases: ["patriot missile", "patriot system"] },
  { name: "THAAD", segment: "munitions", aliases: ["thaad"] },
  { name: "Iron Dome", segment: "munitions", aliases: ["iron dome"] },
  { name: "NASAMS", segment: "munitions", aliases: ["nasams"] },
  { name: "HIMARS", segment: "munitions", aliases: ["himars"] },
  { name: "Tomahawk", segment: "munitions", aliases: ["tomahawk"] },
  { name: "SIPER", segment: "munitions", aliases: ["siper"] },
  // Land
  { name: "Altay", segment: "land_systems", aliases: ["altay tank"] },
  { name: "Leopard 2", segment: "land_systems", aliases: ["leopard 2"] },
  { name: "M1 Abrams", segment: "land_systems", aliases: ["m1 abrams", "abrams tank"] },
  { name: "K2 Black Panther", segment: "land_systems", aliases: ["k2 black panther", "k2 tank"] },
];

// ── Relevance core (any hit qualifies an item as defense-industry) ──────────

export const RELEVANCE_CORE: readonly string[] = [
  "defense", "defence", "military", "army", "navy", "air force", "weapon",
  "warfare", "missile", "fighter jet", "warship", "submarine", "tank",
  "artillery", "drone", "uav", "munition", "ammunition", "procurement",
  "arms deal", "arms sale", "defense ministry", "pentagon", "nato", "radar",
  "aircraft carrier", "combat aircraft", "defense contractor", "defense industry",
  "aerospace", "shipyard", "hypersonic", "air defense", "air defence", "armored",
  "armoured", "soldier", "troop", "warplane", "helicopter", "frigate", "destroyer",
  "critical infrastructure", "cyber defense",
];

// ── Normalized indexes (built once) ─────────────────────────────────────────

export interface NormPattern { term: string; weight: number }
function normPatterns(p: readonly Pattern[]): NormPattern[] {
  return p
    .map(([term, weight]) => ({ term: normalizeText(term), weight }))
    .sort((a, b) => b.term.length - a.term.length);
}

export const NORM_SEGMENTS = SEGMENTS.map((s) => ({ ...s, norm: normPatterns(s.patterns) }));
export const NORM_COMMODITIES = COMMODITIES.map((c) => ({ ...c, norm: normPatterns(c.patterns) }));
export const NORM_STRESS = normPatterns(SUPPLY_STRESS_SIGNALS);
export const NORM_ACTIVITIES = ACTIVITIES.map((a) => ({ ...a, norm: normPatterns(a.patterns) }));
export const NORM_CONTRACTORS = CONTRACTORS.map((c) => ({
  ...c,
  normAliases: c.aliases.map((a) => normalizeText(a)).sort((x, y) => y.length - x.length),
}));
export const NORM_PLATFORMS = PLATFORMS.map((p) => ({
  ...p,
  normAliases: p.aliases.map((a) => normalizeText(a)).sort((x, y) => y.length - x.length),
}));
export const NORM_RELEVANCE = RELEVANCE_CORE.map((t) => normalizeText(t)).sort(
  (a, b) => b.length - a.length,
);
