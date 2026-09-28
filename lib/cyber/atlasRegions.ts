// ---------------------------------------------------------------------------
// world-atlas (countries-110m) name → macro-region map.
//
// Used by CyberMap to fill an ENTIRE macro-region on the 2D map when that
// region appears in "Most Mentioned Regions". Keys are the lowercased
// `properties.name` values exactly as world-atlas exposes them (the same key
// The monitor derives), so lookups are direct with no fuzzy matching.
//
// Region assignment is a deliberate, documented grouping (matches geoLexicon
// where the two overlap):
//   • Türkiye, Egypt, Levant, Gulf → middle_east (EMEA threat-intel grouping)
//   • Caucasus (Armenia/Azerbaijan/Georgia) + Belarus + Russia → russia_cis
//   • Caribbean + Central/South America + Mexico → latin_america
//   • Maghreb/North Africa (except Egypt) → africa
//   • Oversized territorial edge cases (Greenland) → "global" so they are NOT
//     filled — keeps the screen serious instead of lighting a giant ice sheet.
// ---------------------------------------------------------------------------

import type { RegionId } from "./types";

export const ATLAS_NAME_TO_REGION: Readonly<Record<string, RegionId>> = {
  // ── North America ──
  "united states of america": "north_america",
  canada: "north_america",

  // ── Latin America (incl. Mexico, Central America, Caribbean) ──
  mexico: "latin_america",
  guatemala: "latin_america",
  belize: "latin_america",
  honduras: "latin_america",
  "el salvador": "latin_america",
  nicaragua: "latin_america",
  "costa rica": "latin_america",
  panama: "latin_america",
  colombia: "latin_america",
  venezuela: "latin_america",
  ecuador: "latin_america",
  peru: "latin_america",
  brazil: "latin_america",
  bolivia: "latin_america",
  paraguay: "latin_america",
  chile: "latin_america",
  argentina: "latin_america",
  uruguay: "latin_america",
  guyana: "latin_america",
  suriname: "latin_america",
  cuba: "latin_america",
  haiti: "latin_america",
  "dominican rep.": "latin_america",
  jamaica: "latin_america",
  bahamas: "latin_america",
  "puerto rico": "latin_america",
  "trinidad and tobago": "latin_america",
  "falkland is.": "latin_america",

  // ── Europe ──
  "united kingdom": "europe",
  ireland: "europe",
  france: "europe",
  germany: "europe",
  netherlands: "europe",
  belgium: "europe",
  luxembourg: "europe",
  spain: "europe",
  portugal: "europe",
  italy: "europe",
  switzerland: "europe",
  austria: "europe",
  poland: "europe",
  czechia: "europe",
  slovakia: "europe",
  hungary: "europe",
  slovenia: "europe",
  croatia: "europe",
  "bosnia and herz.": "europe",
  serbia: "europe",
  montenegro: "europe",
  kosovo: "europe",
  macedonia: "europe",
  albania: "europe",
  greece: "europe",
  bulgaria: "europe",
  romania: "europe",
  moldova: "europe",
  ukraine: "europe",
  denmark: "europe",
  norway: "europe",
  sweden: "europe",
  finland: "europe",
  iceland: "europe",
  estonia: "europe",
  latvia: "europe",
  lithuania: "europe",
  cyprus: "europe",
  "n. cyprus": "europe",

  // ── Russia & CIS (incl. Caucasus) ──
  russia: "russia_cis",
  belarus: "russia_cis",
  georgia: "russia_cis",
  armenia: "russia_cis",
  azerbaijan: "russia_cis",

  // ── Middle East (incl. Türkiye + Egypt) ──
  turkey: "middle_east",
  syria: "middle_east",
  lebanon: "middle_east",
  israel: "middle_east",
  palestine: "middle_east",
  jordan: "middle_east",
  iraq: "middle_east",
  iran: "middle_east",
  "saudi arabia": "middle_east",
  yemen: "middle_east",
  oman: "middle_east",
  "united arab emirates": "middle_east",
  qatar: "middle_east",
  kuwait: "middle_east",
  egypt: "middle_east",

  // ── Africa ──
  morocco: "africa",
  "w. sahara": "africa",
  algeria: "africa",
  tunisia: "africa",
  libya: "africa",
  mauritania: "africa",
  mali: "africa",
  niger: "africa",
  chad: "africa",
  sudan: "africa",
  "s. sudan": "africa",
  senegal: "africa",
  gambia: "africa",
  "guinea-bissau": "africa",
  guinea: "africa",
  "sierra leone": "africa",
  liberia: "africa",
  "côte d'ivoire": "africa",
  ghana: "africa",
  togo: "africa",
  benin: "africa",
  "burkina faso": "africa",
  nigeria: "africa",
  cameroon: "africa",
  "central african rep.": "africa",
  "eq. guinea": "africa",
  gabon: "africa",
  congo: "africa",
  "dem. rep. congo": "africa",
  angola: "africa",
  zambia: "africa",
  malawi: "africa",
  mozambique: "africa",
  zimbabwe: "africa",
  botswana: "africa",
  namibia: "africa",
  "south africa": "africa",
  lesotho: "africa",
  eswatini: "africa",
  madagascar: "africa",
  tanzania: "africa",
  kenya: "africa",
  uganda: "africa",
  rwanda: "africa",
  burundi: "africa",
  ethiopia: "africa",
  eritrea: "africa",
  djibouti: "africa",
  somalia: "africa",
  somaliland: "africa",

  // ── South Asia ──
  afghanistan: "south_asia",
  pakistan: "south_asia",
  india: "south_asia",
  nepal: "south_asia",
  bhutan: "south_asia",
  bangladesh: "south_asia",
  "sri lanka": "south_asia",

  // ── East Asia ──
  china: "east_asia",
  taiwan: "east_asia",
  "north korea": "east_asia",
  "south korea": "east_asia",
  japan: "east_asia",
  mongolia: "east_asia",

  // ── Southeast Asia ──
  myanmar: "southeast_asia",
  thailand: "southeast_asia",
  laos: "southeast_asia",
  vietnam: "southeast_asia",
  cambodia: "southeast_asia",
  malaysia: "southeast_asia",
  brunei: "southeast_asia",
  indonesia: "southeast_asia",
  "timor-leste": "southeast_asia",
  philippines: "southeast_asia",

  // ── Central Asia ──
  kazakhstan: "central_asia",
  turkmenistan: "central_asia",
  uzbekistan: "central_asia",
  tajikistan: "central_asia",
  kyrgyzstan: "central_asia",

  // ── Oceania ──
  australia: "oceania",
  "new zealand": "oceania",
  "papua new guinea": "oceania",
  fiji: "oceania",
  "solomon is.": "oceania",
  vanuatu: "oceania",
  "new caledonia": "oceania",

  // ── Intentionally NOT filled (territorial / oversized edge cases) ──
  greenland: "global",
};
