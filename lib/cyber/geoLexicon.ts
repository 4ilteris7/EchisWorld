// ---------------------------------------------------------------------------
// Geographic lexicon for cyber signal detection.
//
// Two layers:
//   1. REGIONS         — macro-region taxonomy (display labels).
//   2. COUNTRIES       — country → region mapping with demonyms + aliases.
//   3. REGION_DIRECT   — words that name a macro-region directly
//                        ("European", "Middle East", "Southeast Asia").
//
// Design notes (precision-first):
//   • `demonyms` (nationality adjectives) are kept separate from `aliases`
//     because they drive attacker/victim role attribution
//     ("Chinese hackers" → origin; "targets Taiwanese firms" → target).
//   • Collision-prone short tokens (e.g. bare "us") are intentionally omitted;
//     only safe forms ("u.s.", "usa", "united states", "america") are kept.
//   • Region assignment for transcontinental states is a documented judgment
//     call (e.g. Türkiye → Middle East/EMEA grouping, Mexico → Latin America).
// ---------------------------------------------------------------------------

import type { RegionId } from "./types";
import { normalizeText } from "./normalize";

export const REGIONS: Record<RegionId, { label: string }> = {
  north_america: { label: "North America" },
  latin_america: { label: "Latin America" },
  europe: { label: "Europe" },
  russia_cis: { label: "Russia & CIS" },
  middle_east: { label: "Middle East" },
  africa: { label: "Africa" },
  south_asia: { label: "South Asia" },
  east_asia: { label: "East Asia" },
  southeast_asia: { label: "Southeast Asia" },
  central_asia: { label: "Central Asia" },
  oceania: { label: "Oceania" },
  global: { label: "Global / Multi-region" },
};

export interface CountryEntry {
  name: string;
  regionId: RegionId;
  /** Nationality adjectives — drive actor/target role attribution. */
  demonyms: readonly string[];
  /** Country names, abbreviations, capitals, major cities, key institutions. */
  aliases: readonly string[];
}

// NOTE: keep aliases lowercase-ish; they are normalized at module load anyway.
export const COUNTRIES: readonly CountryEntry[] = [
  // ── North America ────────────────────────────────────────────────────────
  {
    name: "United States",
    regionId: "north_america",
    demonyms: ["american", "americans"],
    aliases: [
      "united states", "u.s.", "u.s.a.", "u.s", "usa", "america",
      "washington", "pentagon", "white house", "fbi", "cisa", "nsa",
      "new york", "california", "texas",
    ],
  },
  {
    name: "Canada",
    regionId: "north_america",
    demonyms: ["canadian", "canadians"],
    aliases: ["canada", "ottawa", "toronto", "ontario"],
  },
  // ── Latin America ────────────────────────────────────────────────────────
  {
    name: "Mexico",
    regionId: "latin_america",
    demonyms: ["mexican", "mexicans"],
    aliases: ["mexico", "mexico city"],
  },
  {
    name: "Brazil",
    regionId: "latin_america",
    demonyms: ["brazilian", "brazilians"],
    aliases: ["brazil", "brasil", "sao paulo", "brasilia"],
  },
  {
    name: "Argentina",
    regionId: "latin_america",
    demonyms: ["argentine", "argentinian", "argentinians"],
    aliases: ["argentina", "buenos aires"],
  },
  {
    name: "Colombia",
    regionId: "latin_america",
    demonyms: ["colombian", "colombians"],
    aliases: ["colombia", "bogota"],
  },
  {
    name: "Chile",
    regionId: "latin_america",
    demonyms: ["chilean", "chileans"],
    aliases: ["chile", "santiago"],
  },
  {
    name: "Venezuela",
    regionId: "latin_america",
    demonyms: ["venezuelan", "venezuelans"],
    aliases: ["venezuela", "caracas"],
  },
  {
    name: "Peru",
    regionId: "latin_america",
    demonyms: ["peruvian", "peruvians"],
    aliases: ["peru", "lima"],
  },
  // ── Europe ───────────────────────────────────────────────────────────────
  {
    name: "United Kingdom",
    regionId: "europe",
    demonyms: ["british", "briton", "britons", "english"],
    aliases: ["united kingdom", "uk", "u.k.", "britain", "great britain", "england", "london", "scotland", "ncsc"],
  },
  {
    name: "Germany",
    regionId: "europe",
    demonyms: ["german", "germans"],
    aliases: ["germany", "berlin", "munich", "bundestag", "bsi"],
  },
  {
    name: "France",
    regionId: "europe",
    demonyms: ["french"],
    aliases: ["france", "paris", "anssi"],
  },
  {
    name: "Italy",
    regionId: "europe",
    demonyms: ["italian", "italians"],
    aliases: ["italy", "rome", "milan"],
  },
  {
    name: "Spain",
    regionId: "europe",
    demonyms: ["spanish", "spaniard", "spaniards"],
    aliases: ["spain", "madrid", "barcelona"],
  },
  {
    name: "Netherlands",
    regionId: "europe",
    demonyms: ["dutch"],
    aliases: ["netherlands", "holland", "amsterdam", "the hague"],
  },
  {
    name: "Poland",
    regionId: "europe",
    demonyms: ["polish", "poles"],
    aliases: ["poland", "warsaw"],
  },
  {
    name: "Ukraine",
    regionId: "europe",
    demonyms: ["ukrainian", "ukrainians"],
    aliases: ["ukraine", "kyiv", "kiev", "kharkiv", "cert-ua"],
  },
  {
    name: "Sweden",
    regionId: "europe",
    demonyms: ["swedish", "swedes"],
    aliases: ["sweden", "stockholm"],
  },
  {
    name: "Norway",
    regionId: "europe",
    demonyms: ["norwegian", "norwegians"],
    aliases: ["norway", "oslo"],
  },
  {
    name: "Finland",
    regionId: "europe",
    demonyms: ["finnish", "finns"],
    aliases: ["finland", "helsinki"],
  },
  {
    name: "Denmark",
    regionId: "europe",
    demonyms: ["danish", "danes"],
    aliases: ["denmark", "copenhagen"],
  },
  {
    name: "Switzerland",
    regionId: "europe",
    demonyms: ["swiss"],
    aliases: ["switzerland", "zurich", "geneva"],
  },
  {
    name: "Belgium",
    regionId: "europe",
    demonyms: ["belgian", "belgians"],
    aliases: ["belgium", "brussels"],
  },
  {
    name: "Ireland",
    regionId: "europe",
    demonyms: ["irish"],
    aliases: ["ireland", "dublin"],
  },
  {
    name: "Austria",
    regionId: "europe",
    demonyms: ["austrian", "austrians"],
    aliases: ["austria", "vienna"],
  },
  {
    name: "Portugal",
    regionId: "europe",
    demonyms: ["portuguese"],
    aliases: ["portugal", "lisbon"],
  },
  {
    name: "Greece",
    regionId: "europe",
    demonyms: ["greek", "greeks"],
    aliases: ["greece", "athens"],
  },
  {
    name: "Romania",
    regionId: "europe",
    demonyms: ["romanian", "romanians"],
    aliases: ["romania", "bucharest"],
  },
  {
    name: "Czechia",
    regionId: "europe",
    demonyms: ["czech"],
    aliases: ["czechia", "czech republic", "prague"],
  },
  {
    name: "Estonia",
    regionId: "europe",
    demonyms: ["estonian", "estonians"],
    aliases: ["estonia", "tallinn"],
  },
  {
    name: "Lithuania",
    regionId: "europe",
    demonyms: ["lithuanian", "lithuanians"],
    aliases: ["lithuania", "vilnius"],
  },
  // ── Russia & CIS ─────────────────────────────────────────────────────────
  {
    name: "Russia",
    regionId: "russia_cis",
    demonyms: ["russian", "russians"],
    aliases: ["russia", "moscow", "kremlin", "gru", "svr", "fsb"],
  },
  {
    name: "Belarus",
    regionId: "russia_cis",
    demonyms: ["belarusian", "belarusians"],
    aliases: ["belarus", "minsk"],
  },
  // ── Middle East (incl. MENA & Türkiye, per EMEA threat-intel grouping) ────
  {
    name: "Israel",
    regionId: "middle_east",
    demonyms: ["israeli", "israelis"],
    aliases: ["israel", "tel aviv", "jerusalem"],
  },
  {
    name: "Iran",
    regionId: "middle_east",
    demonyms: ["iranian", "iranians"],
    aliases: ["iran", "tehran", "irgc"],
  },
  {
    name: "Saudi Arabia",
    regionId: "middle_east",
    demonyms: ["saudi", "saudis"],
    aliases: ["saudi arabia", "riyadh", "jeddah"],
  },
  {
    name: "United Arab Emirates",
    regionId: "middle_east",
    demonyms: ["emirati", "emiratis"],
    aliases: ["united arab emirates", "uae", "u.a.e.", "dubai", "abu dhabi"],
  },
  {
    name: "Qatar",
    regionId: "middle_east",
    demonyms: ["qatari", "qataris"],
    aliases: ["qatar", "doha"],
  },
  {
    name: "Türkiye",
    regionId: "middle_east",
    demonyms: ["turkish"],
    aliases: ["turkiye", "turkey", "istanbul", "ankara"],
  },
  {
    name: "Iraq",
    regionId: "middle_east",
    demonyms: ["iraqi", "iraqis"],
    aliases: ["iraq", "baghdad"],
  },
  {
    name: "Syria",
    regionId: "middle_east",
    demonyms: ["syrian", "syrians"],
    aliases: ["syria", "damascus"],
  },
  {
    name: "Lebanon",
    regionId: "middle_east",
    demonyms: ["lebanese"],
    aliases: ["lebanon", "beirut"],
  },
  {
    name: "Jordan",
    regionId: "middle_east",
    demonyms: ["jordanian", "jordanians"],
    aliases: ["jordan", "amman"],
  },
  {
    name: "Egypt",
    regionId: "middle_east",
    demonyms: ["egyptian", "egyptians"],
    aliases: ["egypt", "cairo"],
  },
  {
    name: "Yemen",
    regionId: "middle_east",
    demonyms: ["yemeni", "yemenis"],
    aliases: ["yemen", "sanaa"],
  },
  // ── South Asia ───────────────────────────────────────────────────────────
  {
    name: "India",
    regionId: "south_asia",
    demonyms: ["indian", "indians"],
    aliases: ["india", "new delhi", "mumbai", "cert-in"],
  },
  {
    name: "Pakistan",
    regionId: "south_asia",
    demonyms: ["pakistani", "pakistanis"],
    aliases: ["pakistan", "islamabad", "karachi"],
  },
  {
    name: "Bangladesh",
    regionId: "south_asia",
    demonyms: ["bangladeshi", "bangladeshis"],
    aliases: ["bangladesh", "dhaka"],
  },
  {
    name: "Sri Lanka",
    regionId: "south_asia",
    demonyms: ["sri lankan", "sri lankans"],
    aliases: ["sri lanka", "colombo"],
  },
  {
    name: "Nepal",
    regionId: "south_asia",
    demonyms: ["nepali", "nepalese"],
    aliases: ["nepal", "kathmandu"],
  },
  // ── East Asia ────────────────────────────────────────────────────────────
  {
    name: "China",
    regionId: "east_asia",
    demonyms: ["chinese"],
    aliases: ["china", "prc", "beijing", "shanghai", "mss"],
  },
  {
    name: "Taiwan",
    regionId: "east_asia",
    demonyms: ["taiwanese"],
    aliases: ["taiwan", "taipei"],
  },
  {
    name: "Hong Kong",
    regionId: "east_asia",
    demonyms: ["hongkonger", "hongkongers"],
    aliases: ["hong kong"],
  },
  {
    name: "Japan",
    regionId: "east_asia",
    demonyms: ["japanese"],
    aliases: ["japan", "tokyo", "osaka", "jpcert"],
  },
  {
    name: "South Korea",
    regionId: "east_asia",
    demonyms: ["south korean", "south koreans"],
    aliases: ["south korea", "seoul", "republic of korea"],
  },
  {
    name: "North Korea",
    regionId: "east_asia",
    demonyms: ["north korean", "north koreans"],
    aliases: ["north korea", "pyongyang", "dprk", "rgb", "reconnaissance general bureau"],
  },
  {
    name: "Mongolia",
    regionId: "east_asia",
    demonyms: ["mongolian", "mongolians"],
    aliases: ["mongolia", "ulaanbaatar"],
  },
  // ── Southeast Asia ───────────────────────────────────────────────────────
  {
    name: "Vietnam",
    regionId: "southeast_asia",
    demonyms: ["vietnamese"],
    aliases: ["vietnam", "hanoi"],
  },
  {
    name: "Thailand",
    regionId: "southeast_asia",
    demonyms: ["thai", "thais"],
    aliases: ["thailand", "bangkok"],
  },
  {
    name: "Philippines",
    regionId: "southeast_asia",
    demonyms: ["filipino", "filipinos", "philippine"],
    aliases: ["philippines", "manila"],
  },
  {
    name: "Indonesia",
    regionId: "southeast_asia",
    demonyms: ["indonesian", "indonesians"],
    aliases: ["indonesia", "jakarta"],
  },
  {
    name: "Malaysia",
    regionId: "southeast_asia",
    demonyms: ["malaysian", "malaysians"],
    aliases: ["malaysia", "kuala lumpur"],
  },
  {
    name: "Singapore",
    regionId: "southeast_asia",
    demonyms: ["singaporean", "singaporeans"],
    aliases: ["singapore"],
  },
  {
    name: "Myanmar",
    regionId: "southeast_asia",
    demonyms: ["burmese"],
    aliases: ["myanmar", "burma", "naypyidaw"],
  },
  {
    name: "Cambodia",
    regionId: "southeast_asia",
    demonyms: ["cambodian", "cambodians"],
    aliases: ["cambodia", "phnom penh"],
  },
  // ── Central Asia ─────────────────────────────────────────────────────────
  {
    name: "Kazakhstan",
    regionId: "central_asia",
    demonyms: ["kazakh", "kazakhs"],
    aliases: ["kazakhstan", "astana", "almaty"],
  },
  {
    name: "Uzbekistan",
    regionId: "central_asia",
    demonyms: ["uzbek", "uzbeks"],
    aliases: ["uzbekistan", "tashkent"],
  },
  // ── Oceania ──────────────────────────────────────────────────────────────
  {
    name: "Australia",
    regionId: "oceania",
    demonyms: ["australian", "australians"],
    aliases: ["australia", "sydney", "canberra", "melbourne", "acsc"],
  },
  {
    name: "New Zealand",
    regionId: "oceania",
    demonyms: ["new zealander", "new zealanders"],
    aliases: ["new zealand", "wellington", "auckland"],
  },
  // ── Africa ───────────────────────────────────────────────────────────────
  {
    name: "South Africa",
    regionId: "africa",
    demonyms: ["south african", "south africans"],
    aliases: ["south africa", "johannesburg", "pretoria", "cape town"],
  },
  {
    name: "Nigeria",
    regionId: "africa",
    demonyms: ["nigerian", "nigerians"],
    aliases: ["nigeria", "lagos", "abuja"],
  },
  {
    name: "Kenya",
    regionId: "africa",
    demonyms: ["kenyan", "kenyans"],
    aliases: ["kenya", "nairobi"],
  },
  {
    name: "Ethiopia",
    regionId: "africa",
    demonyms: ["ethiopian", "ethiopians"],
    aliases: ["ethiopia", "addis ababa"],
  },
  {
    name: "Morocco",
    regionId: "africa",
    demonyms: ["moroccan", "moroccans"],
    aliases: ["morocco", "rabat", "casablanca"],
  },
] as const;

/**
 * Direct macro-region phrases. When a headline names a region itself
 * ("European banks", "Middle East", "Southeast Asian governments") we attach
 * the signal to that region without needing a specific country.
 */
export const REGION_DIRECT: ReadonlyArray<{ regionId: RegionId; terms: readonly string[] }> = [
  { regionId: "north_america", terms: ["north america", "north american"] },
  { regionId: "latin_america", terms: ["latin america", "latin american", "south america", "south american", "central america"] },
  { regionId: "europe", terms: ["europe", "european", "european union", "e.u.", "schengen", "balkans", "nordic", "baltic"] },
  { regionId: "russia_cis", terms: ["cis region", "post-soviet", "eurasia", "eurasian"] },
  { regionId: "middle_east", terms: ["middle east", "middle eastern", "mena", "gulf states", "persian gulf", "levant"] },
  { regionId: "africa", terms: ["africa", "african", "sub-saharan", "north africa"] },
  { regionId: "south_asia", terms: ["south asia", "south asian", "indian subcontinent"] },
  { regionId: "east_asia", terms: ["east asia", "east asian", "far east"] },
  { regionId: "southeast_asia", terms: ["southeast asia", "south-east asia", "southeast asian", "asean", "indo-pacific"] },
  { regionId: "central_asia", terms: ["central asia", "central asian"] },
  { regionId: "oceania", terms: ["oceania", "australasia", "pacific islands"] },
];

// ── Precompiled, normalized lookup structures (built once at module load) ───

export interface NormalizedCountry extends CountryEntry {
  /** Normalized demonyms. */
  normDemonyms: readonly string[];
  /** Normalized aliases. */
  normAliases: readonly string[];
}

export const NORMALIZED_COUNTRIES: readonly NormalizedCountry[] = COUNTRIES.map((c) => ({
  ...c,
  normDemonyms: c.demonyms.map((d) => normalizeText(d)),
  normAliases: c.aliases.map((a) => normalizeText(a)),
}));

/** Map normalized demonym → country (for actor/origin resolution). */
export const DEMONYM_TO_COUNTRY = new Map<string, NormalizedCountry>();
for (const c of NORMALIZED_COUNTRIES) {
  for (const d of c.normDemonyms) {
    if (!DEMONYM_TO_COUNTRY.has(d)) DEMONYM_TO_COUNTRY.set(d, c);
  }
}

/** Map canonical country name → entry. */
export const COUNTRY_BY_NAME = new Map<string, NormalizedCountry>(
  NORMALIZED_COUNTRIES.map((c) => [c.name, c]),
);

export const NORMALIZED_REGION_DIRECT = REGION_DIRECT.map((r) => ({
  regionId: r.regionId,
  terms: r.terms.map((t) => normalizeText(t)),
}));

export function regionLabel(regionId: RegionId): string {
  return REGIONS[regionId].label;
}
