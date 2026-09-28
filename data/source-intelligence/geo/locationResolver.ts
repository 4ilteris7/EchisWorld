import { containsNormalizedPhrase, normalizeFilterText } from "../filters/normalizeFilterText";
import { worldCapitals } from "../../worldCapitals";
import type { GeoResolutionMethod } from "../sourceIntelligenceTypes";

export type ResolvedLocation = {
  latitude: number;
  longitude: number;
  label: string;
  countryCode?: string;
  region?: string;
};

type LocationEntry = ResolvedLocation & {
  aliases: readonly string[];
  isGlobalCapitalEntry?: boolean;
};

type LocationMatch = {
  entry: LocationEntry;
  score: number;
};

export type LocationResolutionMethod = Extract<
  GeoResolutionMethod,
  | "event_location_phrase"
  | "official_actor_phrase"
  | "country_actor_phrase"
  | "target_country_phrase"
  | "negotiation_location_phrase"
  | "headline_location_prefix"
  | "mentioned_location_phrase"
>;

export type LocationResolutionCandidate = {
  location: ResolvedLocation;
  method: LocationResolutionMethod;
  score: number;
  matchedAlias: string;
  evidence: string[];
};

const TURKISH_POSSESSIVE_LINKERS = [
  "nin",
  "in",
  "nun",
  "un",
  "s",
] as const;

const TURKISH_CASE_LINKERS = [
  "a",
  "e",
  "ya",
  "ye",
  "da",
  "de",
  "dan",
  "den",
  "daki",
  "deki",
  "taki",
  "teki",
] as const;

const DIRECTIONAL_LOCATION_MODIFIERS = [
  "north",
  "northern",
  "south",
  "southern",
  "east",
  "eastern",
  "west",
  "western",
  "central",
  "kuzey",
  "guney",
  "dogu",
  "bati",
  "orta",
] as const;

const OFFICIAL_ACTOR_PHRASES = [
  "foreign ministry",
  "ministry of foreign affairs",
  "foreign minister",
  "state department",
  "defense ministry",
  "defence ministry",
  "ministry of defense",
  "ministry of defence",
  "presidency",
  "president",
  "prime minister",
  "government",
  "cabinet",
  "diplomatic mission",
  "embassy",
  "leader",
  "mps",
  "mp",
  "lawmakers",
  "parliament",
  "corps",
  "army",
  "military",
  "combat medics",
  "foreign spy chief",
  "disisleri bakanligi",
  "disisleri bakani",
  "savunma bakanligi",
  "savunma bakani",
  "cumhurbaskanligi",
  "cumhurbaskani",
  "basbakan",
  "basbakani",
  "hukumet",
  "hukumeti",
  "bakanlar kurulu",
  "buyukelcilik",
  "diplomatik misyon",
] as const;

const COUNTRY_ACTOR_ACTIONS = [
  "cuts ties",
  "cut ties",
  "denies",
  "denied",
  "accuses",
  "accused",
  "reaffirms",
  "reaffirm",
  "votes",
  "vote",
  "overturning",
  "set to dominate",
  "inch closer",
  "launches strikes",
  "rejects",
  "preparing",
  "to take",
  "will take",
  "says",
  "said",
  "announced",
  "agreed",
  "agreeing",
  "denies agreeing",
  "karar aldi",
  "reddetti",
  "sucladi",
  "acikladi",
  "oyladi",
] as const;

const EVENT_LOCATION_BEFORE = [
  "in",
  "near",
  "around",
  "across",
  "inside",
  "from",
  "toward",
  "towards",
  "over",
  "at",
  "within",
  "into",
  "outside",
  "off",
  "de",
  "da",
  "den",
  "dan",
] as const;

const EVENT_LOCATION_AFTER = [
  "da",
  "de",
  "daki",
  "deki",
  "taki",
  "teki",
  "yakini",
  "yakininda",
  "civarinda",
  "bolgesinde",
  "sinirinda",
  "kiyisinda",
  "aciklarinda",
  "war",
  "conflict",
  "combat zone",
  "combat zones",
  "crisis",
  "ceasefire",
  "fight",
  "force",
  "stability force",
  "tension",
  "dispute",
  "patrol",
  "drill",
  "exercise",
  "border",
  "front",
  "frontline",
  "airspace",
  "territory",
  "coast",
  "strait",
  "region",
  "province",
  "capital",
  "airstrike",
  "strike",
  "missile",
  "drone",
  "shelling",
  "invasion",
  "sanctions",
  "talks",
  "summit",
  "sinir",
  "siniri",
  "bolge",
  "bolgesi",
  "hava",
  "sahasi",
  "toprak",
  "saldiri",
  "ateskes",
  "talimati",
  "talimat",
  "isgal",
  "isgal alani",
  "istikrar gucu",
  "gucu",
  "gerilim",
  "ihtilaf",
  "devriye",
  "tatbikat",
  "kriz",
  "savasi",
  "savas",
  "yaptirim",
  "muzakere",
  "zirve",
  "refugee returns",
  "returns dashboard",
  "dashboard",
  "elections",
  "election",
  "insecurity",
  "train station",
  "stabbing",
  "terror",
  "partnership",
  "funding",
  "hospital care",
  "malnutrition",
  "refugee",
  "refugees",
  "desplazamientos",
  "confinamientos",
  "people of",
  "municipio de",
  "department of",
] as const;

const NEGOTIATION_TERMS = [
  "talks",
  "negotiations",
  "summit",
  "meeting",
  "mediation",
  "ceasefire talks",
  "peace talks",
  "muzakere",
  "muzakereler",
  "gorusme",
  "gorusmeler",
  "zirve",
  "arabuluculuk",
  "ateskes gorusmeleri",
] as const;

const TARGET_ACTION_BEFORE = [
  "against",
  "on",
  "targeting",
  "hits",
  "hit",
  "strikes",
  "strike",
  "attacks",
  "attack",
  "sanctions",
  "embargo",
  "karsi",
  "hedef alan",
  "hedefledi",
  "vurulan",
  "vurdu",
  "saldirdi",
  "yaptirim",
  "ambargo",
  "blacklist",
  "adds",
  "add",
] as const;

const TARGET_ACTION_AFTER = [
  "sanctions",
  "embargo",
  "targeted",
  "hit",
  "struck",
  "attacked",
  "vuruldu",
  "hedef alindi",
  "yaptirim",
  "ambargo",
  "blacklist",
  "blacklisted",
  "sanctions law",
] as const;

const WEAK_STANDALONE_ALIASES = new Set(
  [
    "netanyahu",
    "hezbollah",
    "hizbullah",
    "houthi",
    "houthis",
    "husiler",
    "khamenei",
    "pezeshkian",
    "erdogan",
    "modi",
    "putin",
    "xi jinping",
    "kim jong un",
    "biden",
    "trump",
    "macron",
    "scholz",
    "taliban",
    "tatmadaw",
    "al shabaab",
    "nato",
    "eu",
    "ab",
    "sahel",
    "kremlin",
    "white house",
    "downing street",
    "elysee",
    "european commission",
    "european council",
  ].map(normalizeFilterText),
);

function tokenCount(value: string): number {
  return normalizeFilterText(value).split(/\s+/).filter(Boolean).length;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function phraseAlternation(values: readonly string[]): string {
  return values
    .map((value) => normalizeFilterText(value))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join("|");
}

function containsAnyPhrase(normalizedText: string, phrases: readonly string[]): boolean {
  return phrases.some((phrase) => containsNormalizedPhrase(normalizedText, phrase));
}

// ── Module-level precomputed alternation strings ──────────────────────────────
// phraseAlternation() was previously called inside every has*() invocation,
// rebuilding the same large alternation string — and constructing a new RegExp
// from it — for every alias × item pair in the pipeline.  Precomputing them
// once at module load eliminates ~2 M regex compilations per pipeline run.
// All results are identical to what the old code produced; only timing changes.
const _BEFORE_ALT          = phraseAlternation(EVENT_LOCATION_BEFORE);
const _AFTER_ALT           = phraseAlternation(EVENT_LOCATION_AFTER);
const _ACTIONS_ALT         = phraseAlternation(COUNTRY_ACTOR_ACTIONS);
const _TARGET_BEFORE_ALT   = phraseAlternation(TARGET_ACTION_BEFORE);
const _TARGET_AFTER_ALT    = phraseAlternation(TARGET_ACTION_AFTER);
const _DIRECTIONAL_MOD_ALT = phraseAlternation(DIRECTIONAL_LOCATION_MODIFIERS);
// Replaces optionalDirectionalModifier() — same string, computed once.
const _DIRECTIONAL_OPT     = `(?:the\\s+)?(?:(?:${_DIRECTIONAL_MOD_ALT})\\s+)?`;
const _CASE_LINKER_ALT     = TURKISH_CASE_LINKERS.join("|");
const _POSS_LINKER_ALT     = TURKISH_POSSESSIVE_LINKERS.join("|");

// Precomputed normalized + escaped official-actor phrase fragments.
// hasOfficialActorPhraseAfter() iterates over 30+ phrases and previously
// called normalizeFilterText() + new RegExp() for each.  Now it only calls
// RegExp.prototype.test() on the precompiled objects.
const _OFFICIAL_ACTOR_FRAGS: readonly string[] = OFFICIAL_ACTOR_PHRASES
  .map((p) => escapeRegExp(normalizeFilterText(p)))
  .filter(Boolean);

// ── Per-alias RegExp cache ────────────────────────────────────────────────────
// AliasRegexSet holds all precompiled RegExp objects for one normalized alias
// string.  Built lazily on first encounter, reused across every pipeline run.
// Eagerly warmed for all LOCATION_DICTIONARY + worldCapitals entries below.
type AliasRegexSet = {
  /** Shared "before alias" pattern used by contextual + event location checks. */
  beforeRe:        RegExp;
  /** Contextual (no Turkish case linker): alias SPACE after-word */
  ctxAfterRe:      RegExp;
  /** "people of the alias" — event location variant */
  evtPeopleRe:     RegExp;
  /** Event location: alias (case-linker)? SPACE after-word */
  evtAfterRe:      RegExp;
  /** Headline starts with alias */
  hlStartRe:       RegExp;
  /** Headline with world / global / update prefix before alias */
  hlGlobalRe:      RegExp;
  /** Country actor action: (directional)? alias SPACE action-verb */
  actorActionRe:   RegExp;
  /** target-action-before SPACE (case-linker)? (directional)? alias */
  tgtBeforeRe:     RegExp;
  /** alias (case-linker)? SPACE target-action-after */
  tgtAfterRe:      RegExp;
  /** One RegExp per official actor phrase (e.g. "foreign ministry") */
  officialActorRes: readonly RegExp[];
};

const _aliasRegexCache = new Map<string, AliasRegexSet>();

function _buildAliasRegexes(normalizedAlias: string): AliasRegexSet {
  const ea = escapeRegExp(normalizedAlias);
  return {
    beforeRe: new RegExp(
      `(^|\\s)(${_BEFORE_ALT})\\s+${_DIRECTIONAL_OPT}${ea}(?=\\s|$)`,
    ),
    ctxAfterRe: new RegExp(
      `(^|\\s)${ea}\\s+(${_AFTER_ALT})(?=\\s|$)`,
    ),
    evtPeopleRe: new RegExp(
      `(^|\\s)people\\s+of\\s+the\\s+${ea}(?=\\s|$)`,
    ),
    evtAfterRe: new RegExp(
      `(^|\\s)${ea}(?:\\s+(?:${_CASE_LINKER_ALT}))?\\s+(${_AFTER_ALT})(?=\\s|$)`,
    ),
    hlStartRe: new RegExp(
      `^${ea}(?=\\s|$)`,
    ),
    hlGlobalRe: new RegExp(
      `^(world|global|update|flash update)\\s+${ea}(?=\\s|$)`,
    ),
    actorActionRe: new RegExp(
      `(^|\\s)${_DIRECTIONAL_OPT}${ea}\\s+(${_ACTIONS_ALT})(?=\\s|$)`,
    ),
    tgtBeforeRe: new RegExp(
      `(^|\\s)(${_TARGET_BEFORE_ALT})(?:\\s+(?:${_CASE_LINKER_ALT}))?\\s+${_DIRECTIONAL_OPT}${ea}(?=\\s|$)`,
    ),
    tgtAfterRe: new RegExp(
      `(^|\\s)${ea}(?:\\s+(?:${_CASE_LINKER_ALT}))?\\s+(${_TARGET_AFTER_ALT})(?=\\s|$)`,
    ),
    officialActorRes: _OFFICIAL_ACTOR_FRAGS.map(
      (frag) =>
        new RegExp(
          `(^|\\s)${ea}(?:\\s+(?:${_POSS_LINKER_ALT}))?\\s+${frag}(?=\\s|$)`,
        ),
    ),
  };
}

function _getAliasRegexes(normalizedAlias: string): AliasRegexSet {
  let set = _aliasRegexCache.get(normalizedAlias);
  if (!set) {
    set = _buildAliasRegexes(normalizedAlias);
    _aliasRegexCache.set(normalizedAlias, set);
  }
  return set;
}

// ── Per-alias property cache ──────────────────────────────────────────────────
// normalizeFilterText() and tokenCount() were called on the same static alias
// strings on every findLocationResolutionCandidates() invocation.  Memoising
// the results eliminates repeated normalization across pipeline runs.
type AliasProps = { normalized: string; tokens: number };
const _aliasPropCache = new Map<string, AliasProps>();

function _getAliasProps(rawAlias: string): AliasProps {
  let props = _aliasPropCache.get(rawAlias);
  if (!props) {
    props = { normalized: normalizeFilterText(rawAlias), tokens: tokenCount(rawAlias) };
    _aliasPropCache.set(rawAlias, props);
  }
  return props;
}

// ── has*() functions — now delegate to precompiled RegExp sets ────────────────
// Behaviour is identical to before; only allocation and compilation are removed.

function hasContextualSingleAlias(
  normalizedText: string,
  normalizedAlias: string,
): boolean {
  const r = _getAliasRegexes(normalizedAlias);
  return r.beforeRe.test(normalizedText) || r.ctxAfterRe.test(normalizedText);
}

function hasEventLocationPhrase(
  normalizedText: string,
  normalizedAlias: string,
): boolean {
  const r = _getAliasRegexes(normalizedAlias);
  return (
    r.beforeRe.test(normalizedText) ||
    r.evtPeopleRe.test(normalizedText) ||
    r.evtAfterRe.test(normalizedText)
  );
}

function hasOfficialActorPhraseAfter(
  normalizedText: string,
  normalizedAlias: string,
): boolean {
  const { officialActorRes } = _getAliasRegexes(normalizedAlias);
  return officialActorRes.some((re) => re.test(normalizedText));
}

function hasHeadlineLocationPrefix(
  normalizedText: string,
  normalizedAlias: string,
): boolean {
  const r = _getAliasRegexes(normalizedAlias);
  return r.hlStartRe.test(normalizedText) || r.hlGlobalRe.test(normalizedText);
}

function hasCountryActorAction(
  normalizedText: string,
  normalizedAlias: string,
): boolean {
  return _getAliasRegexes(normalizedAlias).actorActionRe.test(normalizedText);
}

function hasNegotiationLocationPhrase(
  normalizedText: string,
  normalizedAlias: string,
): boolean {
  if (!containsAnyPhrase(normalizedText, NEGOTIATION_TERMS)) return false;
  return hasEventLocationPhrase(normalizedText, normalizedAlias);
}

function hasTargetCountryPhrase(
  normalizedText: string,
  normalizedAlias: string,
): boolean {
  const r = _getAliasRegexes(normalizedAlias);
  return r.tgtBeforeRe.test(normalizedText) || r.tgtAfterRe.test(normalizedText);
}

function aliasMatches(normalizedText: string, entry: LocationEntry) {
  return entry.aliases
    .map((rawAlias) => {
      const { normalized, tokens } = _getAliasProps(rawAlias);
      return { raw: rawAlias, normalized, tokens };
    })
    .filter(
      (alias) =>
        alias.normalized &&
        containsNormalizedPhrase(normalizedText, alias.raw),
    );
}

function scoreLocationEntry(normalizedText: string, entry: LocationEntry): number {
  const matchedAliases = aliasMatches(normalizedText, entry);

  if (matchedAliases.length === 0) return 0;

  let score = 0;
  for (const alias of matchedAliases) {
    const isWeak = WEAK_STANDALONE_ALIASES.has(alias.normalized);
    if (alias.tokens >= 2) {
      score = Math.max(score, isWeak ? 60 : 90);
      continue;
    }
    if (!isWeak && hasContextualSingleAlias(normalizedText, alias.normalized)) {
      score = Math.max(score, 70);
    }
  }

  const strongDistinctAliases = new Set(
    matchedAliases
      .filter((alias) => !WEAK_STANDALONE_ALIASES.has(alias.normalized))
      .map((alias) => alias.normalized),
  );
  if (strongDistinctAliases.size >= 2) {
    score = Math.max(score, 75);
  }

  return score;
}

function scoreOfficialActorEntry(
  normalizedText: string,
  entry: LocationEntry,
): number {
  const aliases = aliasMatches(normalizedText, entry);

  let score = 0;
  for (const alias of aliases) {
    if (!hasOfficialActorPhraseAfter(normalizedText, alias.normalized)) continue;
    score = Math.max(score, alias.tokens >= 2 ? 95 : 85);
  }

  return score;
}

const LOCATION_DICTIONARY: readonly LocationEntry[] = [
  {
    label: "Middle East",
    latitude: 29.8,
    longitude: 44.0,
    region: "Middle East",
    aliases: ["middle east", "mena", "orta dogu", "ortadogu"],
  },
  {
    label: "Red Sea",
    latitude: 19.0,
    longitude: 38.8,
    region: "Red Sea",
    aliases: ["red sea", "kizildeniz", "kizil deniz", "bab el mandeb", "bab al mandab"],
  },
  {
    label: "Strait of Hormuz",
    latitude: 26.6,
    longitude: 56.25,
    region: "Persian Gulf",
    aliases: ["strait of hormuz", "hormuz strait", "hurmuz bogazi", "hurmuz"],
  },
  {
    label: "Suez Canal",
    latitude: 30.6,
    longitude: 32.3,
    region: "Suez Canal",
    aliases: ["suez canal", "suveys kanali"],
  },
  {
    label: "Eastern Mediterranean",
    latitude: 34.4,
    longitude: 32.8,
    region: "Eastern Mediterranean",
    aliases: ["eastern mediterranean", "dogu akdeniz"],
  },
  {
    label: "Persian Gulf",
    latitude: 26.8,
    longitude: 51.6,
    region: "Persian Gulf",
    aliases: ["persian gulf", "basra korfezi"],
  },
  {
    label: "Gulf of Aden",
    latitude: 12.5,
    longitude: 48.0,
    region: "Gulf of Aden",
    aliases: ["gulf of aden", "aden korfezi"],
  },
  {
    label: "Black Sea",
    latitude: 43.4,
    longitude: 34.3,
    region: "Black Sea",
    aliases: ["black sea", "karadeniz", "kerch strait", "kerc bogazi"],
  },
  {
    label: "Caucasus",
    latitude: 42.2,
    longitude: 44.8,
    region: "Caucasus",
    aliases: ["caucasus", "south caucasus", "kafkasya", "guney kafkasya"],
  },
  {
    label: "Balkans",
    latitude: 43.5,
    longitude: 21.0,
    region: "Balkans",
    aliases: ["balkans", "western balkans", "balkanlar", "bati balkanlar"],
  },
  {
    label: "Sahel",
    latitude: 15.8,
    longitude: 2.5,
    region: "Sahel",
    aliases: ["sahel", "sahel region", "sahel bolgesi"],
  },
  {
    label: "Horn of Africa",
    latitude: 8.4,
    longitude: 46.3,
    region: "Horn of Africa",
    aliases: ["horn of africa", "afrika boynuzu"],
  },
  {
    label: "South China Sea",
    latitude: 12.0,
    longitude: 114.0,
    region: "South China Sea",
    aliases: ["south china sea", "guney cin denizi"],
  },
  {
    label: "Indo-Pacific",
    latitude: 5.0,
    longitude: 110.0,
    region: "Indo-Pacific",
    aliases: ["indo pacific", "indo-pacific", "hint pasifik"],
  },
  {
    label: "Gaza Strip",
    latitude: 31.42,
    longitude: 34.36,
    countryCode: "PS",
    aliases: ["gaza strip", "gaza", "gazze", "gazze seridi", "gazzeye", "gazzede"],
  },
  {
    label: "West Bank",
    latitude: 31.95,
    longitude: 35.23,
    countryCode: "PS",
    aliases: ["west bank", "bati seria", "ramallah"],
  },
  {
    label: "Palestine / Gaza",
    latitude: 31.5,
    longitude: 34.5,
    countryCode: "PS",
    aliases: ["gaza", "gazze", "palestine", "palestinian", "filistin", "west bank", "ramallah"],
  },
  {
    label: "Israel",
    latitude: 31.5,
    longitude: 34.8,
    countryCode: "IL",
    aliases: ["israel", "israeli", "israil", "tel aviv", "jerusalem", "kudus", "netanyahu"],
  },
  {
    label: "Lebanon",
    latitude: 33.9,
    longitude: 35.5,
    countryCode: "LB",
    aliases: [
      "lebanon",
      "lebanese",
      "lubnan",
      "south lebanon",
      "southern lebanon",
      "guney lubnan",
      "beirut",
      "beyrut",
      "tyre",
      "sour",
      "sur",
      "hezbollah",
      "hizbullah",
    ],
  },
  {
    label: "Syria",
    latitude: 34.8,
    longitude: 38.9,
    countryCode: "SY",
    aliases: [
      "syria",
      "syrian",
      "syrian arab republic",
      "suriye",
      "damascus",
      "sam",
      "aleppo",
      "halep",
      "idlib",
    ],
  },
  {
    label: "Iraq",
    latitude: 33.3,
    longitude: 44.4,
    countryCode: "IQ",
    aliases: ["iraq", "iraqi", "irak", "baghdad", "bagdat", "mosul", "musul", "erbil", "kirkuk", "kerkuk"],
  },
  {
    label: "Yemen",
    latitude: 15.6,
    longitude: 48.5,
    countryCode: "YE",
    aliases: ["yemen", "yemeni", "sanaa", "aden", "houthi", "houthis", "husiler"],
  },
  {
    label: "Iran",
    latitude: 32.4,
    longitude: 53.7,
    countryCode: "IR",
    aliases: ["iran", "iranian", "iranli", "tehran", "tahran", "khamenei", "pezeshkian"],
  },
  {
    label: "Turkey",
    latitude: 39.0,
    longitude: 35.0,
    countryCode: "TR",
    aliases: ["turkey", "turkiye", "turkish", "ankara", "istanbul", "erdogan"],
  },
  {
    label: "Saudi Arabia",
    latitude: 24.7,
    longitude: 46.7,
    countryCode: "SA",
    aliases: ["saudi arabia", "saudi", "suudi", "riyadh", "riyad", "jeddah"],
  },
  {
    label: "Egypt",
    latitude: 26.8,
    longitude: 30.8,
    countryCode: "EG",
    aliases: ["egypt", "egyptian", "misir", "cairo", "kahire", "sinai"],
  },
  {
    label: "Jordan",
    latitude: 30.6,
    longitude: 36.2,
    countryCode: "JO",
    aliases: ["jordan", "jordanian", "urdun", "amman"],
  },
  {
    label: "Qatar",
    latitude: 25.35,
    longitude: 51.18,
    countryCode: "QA",
    aliases: ["qatar", "qatari", "katar", "doha"],
  },
  {
    label: "Oman",
    latitude: 21.5,
    longitude: 55.9,
    countryCode: "OM",
    aliases: ["oman", "omani", "umman", "muscat", "maskat"],
  },
  {
    label: "United Arab Emirates",
    latitude: 23.4,
    longitude: 53.8,
    countryCode: "AE",
    aliases: [
      "united arab emirates",
      "uae",
      "emirates",
      "bae",
      "abu dhabi",
      "dubai",
    ],
  },
  {
    label: "Cyprus",
    latitude: 35.1,
    longitude: 33.4,
    countryCode: "CY",
    aliases: ["cyprus", "kibris", "nicosia", "lefkosia"],
  },
  {
    label: "Greece",
    latitude: 39.0,
    longitude: 22.0,
    countryCode: "GR",
    aliases: ["greece", "greek", "yunanistan", "atina", "athens", "aegean"],
  },
  {
    label: "Ukraine",
    latitude: 48.4,
    longitude: 31.2,
    countryCode: "UA",
    aliases: ["ukraine", "ukrainian", "ukrayna", "kyiv", "kiev", "donbas", "crimea", "kirim", "kharkiv"],
  },
  {
    label: "Russia",
    latitude: 61.5,
    longitude: 105.3,
    countryCode: "RU",
    aliases: ["russia", "russian", "rusya", "moscow", "moskova", "kremlin", "putin"],
  },
  {
    label: "China",
    latitude: 35.9,
    longitude: 104.2,
    countryCode: "CN",
    aliases: ["china", "chinese", "cin", "beijing", "pekin", "xi jinping"],
  },
  {
    label: "Taiwan",
    latitude: 23.7,
    longitude: 121.0,
    countryCode: "TW",
    aliases: ["taiwan", "taiwanese", "tayvan", "taipei", "taiwan strait", "tayvan bogazi"],
  },
  {
    label: "Japan",
    latitude: 36.2,
    longitude: 138.3,
    countryCode: "JP",
    aliases: ["japan", "japanese", "japonya", "tokyo", "osaka"],
  },
  {
    label: "South Korea",
    latitude: 35.9,
    longitude: 127.8,
    countryCode: "KR",
    aliases: ["south korea", "south korean", "guney kore", "seoul", "seul"],
  },
  {
    label: "North Korea",
    latitude: 40.3,
    longitude: 127.5,
    countryCode: "KP",
    aliases: ["north korea", "north korean", "kuzey kore", "pyongyang", "kim jong un"],
  },
  {
    label: "United States",
    latitude: 37.1,
    longitude: -95.7,
    countryCode: "US",
    aliases: ["united states", "usa", "us", "u s", "america", "american", "abd", "washington", "white house", "biden", "trump"],
  },
  {
    label: "United Kingdom",
    latitude: 55.4,
    longitude: -3.4,
    countryCode: "GB",
    aliases: ["united kingdom", "uk", "britain", "british", "london", "ingiltere", "downing street"],
  },
  {
    label: "France",
    latitude: 46.2,
    longitude: 2.2,
    countryCode: "FR",
    aliases: ["france", "french", "fransa", "paris", "elysee", "macron"],
  },
  {
    label: "Germany",
    latitude: 51.2,
    longitude: 10.5,
    countryCode: "DE",
    aliases: ["germany", "german", "german netherlands", "almanya", "berlin", "scholz"],
  },
  {
    label: "Netherlands",
    latitude: 52.1,
    longitude: 5.3,
    countryCode: "NL",
    aliases: ["netherlands", "dutch", "holland", "hollanda", "the hague", "amsterdam"],
  },
  {
    label: "Switzerland",
    latitude: 46.8,
    longitude: 8.2,
    countryCode: "CH",
    aliases: ["switzerland", "swiss", "isvicre", "zurich", "geneva", "bern"],
  },
  {
    label: "Hungary",
    latitude: 47.2,
    longitude: 19.5,
    countryCode: "HU",
    aliases: ["hungary", "hungarian", "macaristan", "budapest", "orban"],
  },
  {
    label: "Estonia",
    latitude: 58.6,
    longitude: 25.0,
    countryCode: "EE",
    aliases: ["estonia", "estonian", "estonya", "tallinn"],
  },
  {
    label: "Latvia",
    latitude: 56.9,
    longitude: 24.6,
    countryCode: "LV",
    aliases: ["latvia", "latvian", "letonya", "riga"],
  },
  {
    label: "Poland",
    latitude: 51.9,
    longitude: 19.1,
    countryCode: "PL",
    aliases: ["poland", "polish", "polonya", "warsaw", "varsova"],
  },
  {
    label: "Belarus",
    latitude: 53.7,
    longitude: 28.0,
    countryCode: "BY",
    aliases: ["belarus", "belarusian", "minsk"],
  },
  {
    label: "Romania",
    latitude: 45.9,
    longitude: 25.0,
    countryCode: "RO",
    aliases: ["romania", "romanian", "romanya", "bucharest", "bukres"],
  },
  {
    label: "Moldova",
    latitude: 47.4,
    longitude: 28.4,
    countryCode: "MD",
    aliases: ["moldova", "moldovan", "chisinau", "transnistria"],
  },
  {
    label: "Brussels / NATO-EU",
    latitude: 50.85,
    longitude: 4.35,
    countryCode: "BE",
    aliases: ["nato", "european union", "eu", "avrupa birligi", "ab", "brussels", "bruksel", "european commission", "european council"],
  },
  {
    label: "Afghanistan",
    latitude: 33.9,
    longitude: 67.7,
    countryCode: "AF",
    aliases: ["afghanistan", "afghan", "afganistan", "kabul", "taliban"],
  },
  {
    label: "Pakistan",
    latitude: 30.4,
    longitude: 69.3,
    countryCode: "PK",
    aliases: ["pakistan", "pakistani", "islamabad", "karachi"],
  },
  {
    label: "India",
    latitude: 20.6,
    longitude: 79.0,
    countryCode: "IN",
    aliases: ["india", "indian", "hindistan", "new delhi", "modi", "kashmir"],
  },
  {
    label: "Armenia",
    latitude: 40.1,
    longitude: 45.0,
    countryCode: "AM",
    aliases: ["armenia", "armenian", "ermenistan", "yerevan"],
  },
  {
    label: "Azerbaijan",
    latitude: 40.1,
    longitude: 47.6,
    countryCode: "AZ",
    aliases: ["azerbaijan", "azerbaijani", "azerbaycan", "baku", "karabakh", "karabag"],
  },
  {
    label: "Georgia",
    latitude: 42.3,
    longitude: 43.4,
    countryCode: "GE",
    aliases: ["georgia", "georgian", "gurcistan", "tbilisi", "abkhazia", "south ossetia"],
  },
  {
    label: "Myanmar",
    latitude: 21.9,
    longitude: 95.9,
    countryCode: "MM",
    aliases: ["myanmar", "burma", "birma", "yangon", "naypyidaw", "tatmadaw"],
  },
  {
    label: "Sudan",
    latitude: 12.9,
    longitude: 30.2,
    countryCode: "SD",
    aliases: ["sudan", "sudanese", "hartum", "khartoum", "darfur"],
  },
  {
    label: "Ethiopia",
    latitude: 9.1,
    longitude: 40.5,
    countryCode: "ET",
    aliases: ["ethiopia", "ethiopian", "etiyopya", "addis ababa", "tigray"],
  },
  {
    label: "Democratic Republic of the Congo",
    latitude: -2.9,
    longitude: 23.7,
    countryCode: "CD",
    aliases: [
      "democratic republic of the congo",
      "dr congo",
      "drc",
      "d r congo",
      "demokratik kongo cumhuriyeti",
      "kongo demokratik cumhuriyeti",
      "kongo dc",
      "congo kinshasa",
      "kinshasa",
    ],
  },
  {
    label: "Uganda",
    latitude: 1.4,
    longitude: 32.3,
    countryCode: "UG",
    aliases: ["uganda", "ugandan", "kampala"],
  },
  {
    label: "Somalia",
    latitude: 5.2,
    longitude: 46.2,
    countryCode: "SO",
    aliases: ["somalia", "somali", "mogadishu", "mogadisu", "al shabaab"],
  },
  {
    label: "Mali",
    latitude: 17.6,
    longitude: -4.0,
    countryCode: "ML",
    aliases: ["mali", "bamako", "sahel"],
  },
  {
    label: "Niger",
    latitude: 17.6,
    longitude: 8.1,
    countryCode: "NE",
    aliases: ["niger", "niamey", "sahel"],
  },
  {
    label: "Libya",
    latitude: 26.3,
    longitude: 17.2,
    countryCode: "LY",
    aliases: ["libya", "libyan", "libya", "tripoli", "trablus"],
  },
  {
    label: "Morocco",
    latitude: 31.8,
    longitude: -7.1,
    countryCode: "MA",
    aliases: ["morocco", "moroccan", "fas", "rabat", "casablanca", "marrakech"],
  },
  {
    label: "Algeria",
    latitude: 28.0,
    longitude: 2.6,
    countryCode: "DZ",
    aliases: ["algeria", "algerian", "cezayir", "algiers"],
  },
  {
    label: "Tunisia",
    latitude: 33.9,
    longitude: 9.6,
    countryCode: "TN",
    aliases: ["tunisia", "tunisian", "tunus", "tunis"],
  },
  {
    label: "Mauritania",
    latitude: 21.0,
    longitude: -10.9,
    countryCode: "MR",
    aliases: ["mauritania", "mauritanian", "moritanya", "nouakchott"],
  },
  {
    label: "Nigeria",
    latitude: 9.08,
    longitude: 8.68,
    countryCode: "NG",
    aliases: ["nigeria", "nigerian", "nijerya", "abuja", "lagos", "kano"],
  },
  {
    label: "Ghana",
    latitude: 7.95,
    longitude: -1.03,
    countryCode: "GH",
    aliases: ["ghana", "ghanaian", "gana", "accra", "kumasi"],
  },
  {
    label: "Kenya",
    latitude: 0.02,
    longitude: 37.9,
    countryCode: "KE",
    aliases: ["kenya", "kenyan", "nairobi", "mombasa"],
  },
  {
    label: "South Africa",
    latitude: -30.56,
    longitude: 22.94,
    countryCode: "ZA",
    aliases: [
      "south africa",
      "south african",
      "guney afrika",
      "pretoria",
      "johannesburg",
      "cape town",
    ],
  },
  {
    label: "Zimbabwe",
    latitude: -19.02,
    longitude: 29.15,
    countryCode: "ZW",
    aliases: ["zimbabwe", "zimbabwean", "zimbabve", "harare", "bulawayo"],
  },
  {
    label: "Zambia",
    latitude: -13.13,
    longitude: 27.85,
    countryCode: "ZM",
    aliases: ["zambia", "zambian", "zambiya", "lusaka"],
  },
  {
    label: "Malawi",
    latitude: -13.25,
    longitude: 34.3,
    countryCode: "MW",
    aliases: ["malawi", "malawian", "malavi", "lilongwe", "blantyre"],
  },
  {
    label: "Mozambique",
    latitude: -18.67,
    longitude: 35.53,
    countryCode: "MZ",
    aliases: ["mozambique", "mozambican", "mozambik", "maputo"],
  },
  {
    label: "Tanzania",
    latitude: -6.37,
    longitude: 34.89,
    countryCode: "TZ",
    aliases: ["tanzania", "tanzanian", "tanzanya", "dodoma", "dar es salaam"],
  },
  {
    label: "Rwanda",
    latitude: -1.94,
    longitude: 29.87,
    countryCode: "RW",
    aliases: ["rwanda", "rwandan", "ruanda", "kigali"],
  },
  {
    label: "South Sudan",
    latitude: 6.88,
    longitude: 31.31,
    countryCode: "SS",
    aliases: ["south sudan", "south sudanese", "guney sudan", "juba"],
  },
  {
    label: "Botswana",
    latitude: -22.33,
    longitude: 24.68,
    countryCode: "BW",
    aliases: ["botswana", "botswanan", "botsvana", "gaborone"],
  },
  {
    label: "Namibia",
    latitude: -22.96,
    longitude: 18.49,
    countryCode: "NA",
    aliases: ["namibia", "namibian", "namibya", "windhoek"],
  },
  {
    label: "Mauritius",
    latitude: -20.35,
    longitude: 57.55,
    countryCode: "MU",
    aliases: ["mauritius", "mauritian", "port louis"],
  },
  {
    label: "Cameroon",
    latitude: 7.37,
    longitude: 12.35,
    countryCode: "CM",
    aliases: ["cameroon", "cameroonian", "kamerun", "yaounde", "douala"],
  },
  {
    label: "Liberia",
    latitude: 6.43,
    longitude: -9.43,
    countryCode: "LR",
    aliases: ["liberia", "liberian", "liberya", "monrovia"],
  },
  {
    label: "Sierra Leone",
    latitude: 8.46,
    longitude: -11.78,
    countryCode: "SL",
    aliases: ["sierra leone", "sierra leonean", "freetown"],
  },
  {
    label: "Gambia",
    latitude: 13.44,
    longitude: -15.31,
    countryCode: "GM",
    aliases: ["gambia", "gambian", "gambiya", "banjul"],
  },
  {
    label: "Togo",
    latitude: 8.62,
    longitude: 0.82,
    countryCode: "TG",
    aliases: ["togo", "togolese", "lome"],
  },
  {
    label: "Venezuela",
    latitude: 6.4,
    longitude: -66.6,
    countryCode: "VE",
    aliases: ["venezuela", "venezuelan", "caracas", "maduro"],
  },
  {
    label: "Guatemala",
    latitude: 15.8,
    longitude: -90.2,
    countryCode: "GT",
    aliases: ["guatemala", "guatemalan", "guatemala city"],
  },
  {
    label: "Colombia",
    latitude: 4.6,
    longitude: -74.3,
    countryCode: "CO",
    aliases: [
      "colombia",
      "colombian",
      "bogota",
      "antioquia",
      "briceno",
      "briceño",
    ],
  },
];

const manualEntryKeys = new Set(
  LOCATION_DICTIONARY.flatMap((entry) => [
    normalizeFilterText(entry.label),
    ...entry.aliases.map((alias) => normalizeFilterText(alias)),
  ]).filter(Boolean),
);

const GLOBAL_CAPITAL_LOCATION_ENTRIES: readonly LocationEntry[] = worldCapitals
  .filter((entry) => !manualEntryKeys.has(normalizeFilterText(entry.country)))
  .map((entry) => ({
    label: entry.country,
    latitude: entry.coordinates[1],
    longitude: entry.coordinates[0],
    aliases: [entry.country, entry.capital],
    isGlobalCapitalEntry: true,
  }));

const ALL_LOCATION_ENTRIES: readonly LocationEntry[] = [
  ...LOCATION_DICTIONARY,
  ...GLOBAL_CAPITAL_LOCATION_ENTRIES,
];

// Eagerly warm alias property and regex caches for every known entry.
// Pays the one-time compilation cost at module load rather than spreading it
// across the first pipeline run on the main thread.
for (const _warmEntry of ALL_LOCATION_ENTRIES) {
  for (const _warmAlias of _warmEntry.aliases) {
    const _warmNorm = _getAliasProps(_warmAlias).normalized;
    if (_warmNorm) _getAliasRegexes(_warmNorm);
  }
}

const entriesByCountryCode = new Map(
  ALL_LOCATION_ENTRIES.flatMap((entry) =>
    entry.countryCode ? [[entry.countryCode, entry] as const] : [],
  ),
);

function candidateFor(
  entry: LocationEntry,
  method: LocationResolutionMethod,
  score: number,
  matchedAlias: string,
  evidence: string[],
): LocationResolutionCandidate {
  return {
    location: { ...entry },
    method,
    score,
    matchedAlias,
    evidence,
  };
}

export function findLocationResolutionCandidates(
  text: string,
): LocationResolutionCandidate[] {
  const normalized = normalizeFilterText(text);
  if (!normalized) return [];

  const candidates: LocationResolutionCandidate[] = [];

  for (const entry of ALL_LOCATION_ENTRIES) {
    const aliases = aliasMatches(normalized, entry);
    if (aliases.length === 0) continue;
    let hasRoleEvidenceForEntry = false;

    for (const alias of aliases) {
      const isWeak = WEAK_STANDALONE_ALIASES.has(alias.normalized);

      if (hasOfficialActorPhraseAfter(normalized, alias.normalized)) {
        hasRoleEvidenceForEntry = true;
        candidates.push(
          candidateFor(
            entry,
            "official_actor_phrase",
            alias.tokens >= 2 ? 96 : 90,
            alias.raw,
            [`official actor phrase: ${alias.raw}`],
          ),
        );
      }

      if (!isWeak && hasHeadlineLocationPrefix(normalized, alias.normalized)) {
        hasRoleEvidenceForEntry = true;
        candidates.push(
          candidateFor(
            entry,
            "headline_location_prefix",
            alias.tokens >= 2 ? 86 : 82,
            alias.raw,
            [`headline location prefix: ${alias.raw}`],
          ),
        );
      }

      if (!isWeak && hasCountryActorAction(normalized, alias.normalized)) {
        hasRoleEvidenceForEntry = true;
        candidates.push(
          candidateFor(
            entry,
            "country_actor_phrase",
            alias.tokens >= 2 ? 90 : 84,
            alias.raw,
            [`country actor action: ${alias.raw}`],
          ),
        );
      }

      if (hasNegotiationLocationPhrase(normalized, alias.normalized)) {
        hasRoleEvidenceForEntry = true;
        candidates.push(
          candidateFor(
            entry,
            "negotiation_location_phrase",
            alias.tokens >= 2 ? 97 : 91,
            alias.raw,
            [`negotiation venue phrase: ${alias.raw}`],
          ),
        );
      }

      if (hasEventLocationPhrase(normalized, alias.normalized)) {
        hasRoleEvidenceForEntry = true;
        candidates.push(
          candidateFor(
            entry,
            "event_location_phrase",
            alias.tokens >= 2 ? 95 : 88,
            alias.raw,
            [`event location phrase: ${alias.raw}`],
          ),
        );
      }

      if (!isWeak && hasTargetCountryPhrase(normalized, alias.normalized)) {
        hasRoleEvidenceForEntry = true;
        candidates.push(
          candidateFor(
            entry,
            "target_country_phrase",
            alias.tokens >= 2 ? 90 : 84,
            alias.raw,
            [`target country phrase: ${alias.raw}`],
          ),
        );
      }
    }

    const strongDistinctAliases = new Set(
      aliases
        .filter((alias) => !WEAK_STANDALONE_ALIASES.has(alias.normalized))
        .map((alias) => alias.normalized),
    );
    const strongestAlias = aliases.sort((a, b) => b.tokens - a.tokens)[0];
    if (
      !hasRoleEvidenceForEntry &&
      strongestAlias &&
      (strongestAlias.tokens >= 2 || strongDistinctAliases.size >= 2)
    ) {
      candidates.push(
        candidateFor(
          entry,
          "mentioned_location_phrase",
          strongestAlias.tokens >= 2 ? 74 : 70,
          strongestAlias.raw,
          [`mentioned location phrase: ${strongestAlias.raw}`],
        ),
      );
    }
  }

  const bestByMethodAndLocation = new Map<string, LocationResolutionCandidate>();
  for (const candidate of candidates) {
    const key = [
      candidate.location.countryCode ?? candidate.location.label,
      candidate.method,
    ].join("::");
    const existing = bestByMethodAndLocation.get(key);
    if (!existing || candidate.score > existing.score) {
      bestByMethodAndLocation.set(key, candidate);
    }
  }

  return [...bestByMethodAndLocation.values()].sort((a, b) => b.score - a.score);
}

export function resolveLocationByCountryCode(
  countryCode: string | undefined,
): ResolvedLocation | null {
  if (!countryCode) return null;
  const entry = entriesByCountryCode.get(countryCode.toUpperCase());
  return entry ? { ...entry } : null;
}

export function resolveLocationByText(text: string): ResolvedLocation | null {
  const normalized = normalizeFilterText(text);
  if (!normalized) return null;

  const matches: LocationMatch[] = [];
  for (const entry of ALL_LOCATION_ENTRIES) {
    const score = scoreLocationEntry(normalized, entry);
    if (score >= 70) matches.push({ entry, score });
  }

  const best = matches.sort((a, b) => b.score - a.score)[0];
  return best ? { ...best.entry } : null;
}

export function resolveLocationByAnchor(text: string): ResolvedLocation | null {
  const normalized = normalizeFilterText(text);
  if (!normalized) return null;

  for (const entry of ALL_LOCATION_ENTRIES) {
    if (normalizeFilterText(entry.label) === normalized) return { ...entry };
    if (entry.aliases.some((alias) => normalizeFilterText(alias) === normalized)) {
      return { ...entry };
    }
  }

  return resolveLocationByText(text);
}

export function resolveOfficialActorLocation(
  text: string,
): ResolvedLocation | null {
  const normalized = normalizeFilterText(text);
  if (!normalized) return null;

  const matches: LocationMatch[] = [];
  for (const entry of ALL_LOCATION_ENTRIES) {
    const score = scoreOfficialActorEntry(normalized, entry);
    if (score >= 80) matches.push({ entry, score });
  }

  const best = matches.sort((a, b) => b.score - a.score)[0];
  return best ? { ...best.entry } : null;
}
