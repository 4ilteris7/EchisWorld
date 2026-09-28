import type {
  NoMarkerReason,
  NormalizedSourceItem,
  SourceEntityRoles,
  SourceEventType,
} from "../sourceIntelligenceTypes";
import { containsNormalizedPhrase, normalizeFilterText } from "./normalizeFilterText";

const MAX_CONTEXT_BODY_CHARS = 1_200;

export type SourceContextClassification = {
  eventType: SourceEventType;
  entityRoles: SourceEntityRoles;
  contextReasons: string[];
  filterGuardReason?: NoMarkerReason;
  noMarkerReason?: NoMarkerReason;
};

type CountryAlias = {
  label: string;
  aliases: readonly string[];
};

const COUNTRY_ALIASES: readonly CountryAlias[] = [
  { label: "United States", aliases: ["united states", "usa", "us", "u s", "american", "abd"] },
  { label: "United Kingdom", aliases: ["united kingdom", "uk", "britain", "british", "ingiltere"] },
  { label: "Democratic Republic of the Congo", aliases: ["democratic republic of the congo", "dr congo", "drc", "d r congo", "demokratik kongo cumhuriyeti", "kongo demokratik cumhuriyeti", "kongo dc"] },
  { label: "Gaza Strip", aliases: ["gaza strip", "gaza", "gazze", "gazze seridi", "palestinian"] },
  { label: "West Bank", aliases: ["west bank", "bati seria", "ramallah"] },
  { label: "Strait of Hormuz", aliases: ["strait of hormuz", "hormuz strait", "hurmuz bogazi", "hurmuz"] },
  { label: "Red Sea", aliases: ["red sea", "kizildeniz", "bab el mandeb", "bab al mandab"] },
  { label: "Suez Canal", aliases: ["suez canal", "suveys kanali"] },
  { label: "South China Sea", aliases: ["south china sea", "guney cin denizi"] },
  { label: "Taiwan Strait", aliases: ["taiwan strait", "tayvan bogazi"] },
  { label: "Eastern Mediterranean", aliases: ["eastern mediterranean", "dogu akdeniz"] },
  { label: "Persian Gulf", aliases: ["persian gulf", "basra korfezi"] },
  { label: "Gulf of Aden", aliases: ["gulf of aden", "aden korfezi"] },
  { label: "Indo-Pacific", aliases: ["indo pacific", "indo-pacific", "hint pasifik"] },
  { label: "Lebanon", aliases: ["lebanon", "lebanese", "lubnan"] },
  { label: "Israel", aliases: ["israel", "israeli", "israil", "idf"] },
  { label: "Iran", aliases: ["iran", "iranian", "iranli"] },
  { label: "Romania", aliases: ["romania", "romanian", "romanya"] },
  { label: "Italy", aliases: ["italy", "italian", "italya"] },
  { label: "Russia", aliases: ["russia", "russian", "rusya", "kremlin"] },
  { label: "Turkey", aliases: ["turkey", "turkiye", "turkish", "turk", "tbmm"] },
  { label: "Japan", aliases: ["japan", "japanese", "japonya"] },
  { label: "Kuwait", aliases: ["kuwait", "kuwaiti", "kuveyt"] },
  { label: "India", aliases: ["india", "indian", "hindistan"] },
  { label: "Finland", aliases: ["finland", "finnish", "finlandiya"] },
  { label: "Sweden", aliases: ["sweden", "swedish", "isvec"] },
  { label: "Bulgaria", aliases: ["bulgaria", "bulgarian", "bulgaristan"] },
  { label: "Montenegro", aliases: ["montenegro", "montenegrin", "karadag"] },
  { label: "South Korea", aliases: ["south korea", "south korean", "guney kore"] },
  { label: "North Korea", aliases: ["north korea", "north korean", "kuzey kore"] },
  { label: "France", aliases: ["france", "french", "fransa"] },
  { label: "Germany", aliases: ["germany", "german", "almanya"] },
  { label: "China", aliases: ["china", "chinese", "cin"] },
  { label: "Syria", aliases: ["syria", "syrian", "suriye"] },
  { label: "Iraq", aliases: ["iraq", "iraqi", "irak"] },
  { label: "Yemen", aliases: ["yemen", "yemeni"] },
  { label: "Sudan", aliases: ["sudan", "sudanese"] },
  { label: "Libya", aliases: ["libya", "libyan"] },
  { label: "Egypt", aliases: ["egypt", "egyptian", "misir"] },
  { label: "Greece", aliases: ["greece", "greek", "yunanistan"] },
  { label: "Cyprus", aliases: ["cyprus", "cypriot", "kibris"] },
  { label: "Armenia", aliases: ["armenia", "armenian", "ermenistan"] },
  { label: "Azerbaijan", aliases: ["azerbaijan", "azerbaijani", "azerbaycan"] },
  { label: "Georgia", aliases: ["georgia", "georgian", "gurcistan"] },
  { label: "Serbia", aliases: ["serbia", "serbian", "sirbistan"] },
  { label: "Kosovo", aliases: ["kosovo", "kosovar"] },
  { label: "Ukraine", aliases: ["ukraine", "ukrainian", "ukrayna"] },
  { label: "Belarus", aliases: ["belarus", "belarusian"] },
  { label: "Poland", aliases: ["poland", "polish", "polonya"] },
  { label: "Spain", aliases: ["spain", "spanish", "ispanya"] },
  { label: "Malaysia", aliases: ["malaysia", "malaysian", "malezya"] },
  { label: "Saudi Arabia", aliases: ["saudi arabia", "saudi", "riyadh", "suudi arabistan"] },
  { label: "United Arab Emirates", aliases: ["united arab emirates", "uae", "emirati", "abu dhabi", "bae"] },
  { label: "Qatar", aliases: ["qatar", "qatari", "doha", "katar"] },
  { label: "Jordan", aliases: ["jordan", "jordanian", "urdun"] },
  { label: "Taiwan", aliases: ["taiwan", "taiwanese", "tayvan"] },
  { label: "Pakistan", aliases: ["pakistan", "pakistani"] },
  { label: "Afghanistan", aliases: ["afghanistan", "afghan"] },
  { label: "Indonesia", aliases: ["indonesia", "indonesian", "endonezya"] },
  { label: "Philippines", aliases: ["philippines", "filipino", "filipinler"] },
  { label: "Canada", aliases: ["canada", "canadian", "kanada"] },
  { label: "Australia", aliases: ["australia", "australian", "avustralya"] },
  { label: "Brazil", aliases: ["brazil", "brazilian", "brezilya"] },
  { label: "Mexico", aliases: ["mexico", "mexican", "meksika"] },
  { label: "South Africa", aliases: ["south africa", "south african", "guney afrika"] },
  { label: "Morocco", aliases: ["morocco", "moroccan", "fas"] },
  { label: "Algeria", aliases: ["algeria", "algerian", "cezayir"] },
  { label: "Tunisia", aliases: ["tunisia", "tunisian", "tunus"] },
  { label: "Nigeria", aliases: ["nigeria", "nigerian", "nijerya"] },
  { label: "Mali", aliases: ["mali", "malian"] },
  { label: "Niger", aliases: ["niger", "nigerien"] },
] as const;

const OFFICIAL_ROLE_PATTERNS = [
  "pm", "president", "prime minister", "chancellor", "king", "queen", "emir",
  "crown prince", "sultan", "head of state", "head of government",
  "leader", "government chief",
  "foreign minister", "foreign secretary", "minister of foreign affairs",
  "foreign ministry", "ministry of foreign affairs", "state department",
  "secretary of state", "deputy foreign minister", "ambassador", "envoy",
  "special envoy", "diplomat", "embassy", "consulate", "high representative",
  "defense minister",
  "defence minister", "minister of defense", "minister of defence",
  "defense ministry", "defence ministry", "ministry of defense",
  "ministry of defence", "pentagon", "department of defense",
  "armed forces", "army", "navy",
  "air force", "general staff", "chief of staff", "military spokesperson",
  "military command", "defense chief", "army chief", "commander",
  "military official", "interior minister", "interior ministry",
  "home ministry", "homeland security", "security council",
  "national security council", "intelligence chief", "intelligence agency",
  "spy chief", "police chief", "justice minister", "prosecutor general",
  "supreme court", "constitutional court", "parliament", "senate", "congress",
  "speaker of parliament", "parliament speaker", "spokesperson", "spokesman",
  "spokeswoman", "press secretary", "government spokesperson",
  "ministry spokesperson", "presidential spokesperson", "official statement",
  "press statement", "press release", "government statement",
  "ministry statement", "presidential statement", "joint statement", "readout",
  "briefing", "communique", "transcript",
  "cumhurbaskani", "baskan", "basbakan", "sansolye", "kral", "kralice",
  "emir", "veliaht prens", "sultan", "devlet baskani", "hukumet baskani",
  "lider", "disisleri bakani",
  "disisleri bakanligi", "dis politika", "buyukelci", "elci", "elcilik",
  "konsolosluk", "ozel temsilci", "diplomat",
  "savunma bakani", "savunma bakanligi", "milli savunma bakanligi",
  "silahli kuvvetler", "genelkurmay", "genelkurmay baskani", "ordu",
  "donanma", "hava kuvvetleri", "kara kuvvetleri", "askeri sozcu",
  "askeri yetkili", "komutan",
  "icisleri bakani", "icisleri bakanligi", "milli guvenlik kurulu",
  "ulusal guvenlik konseyi", "istihbarat baskani", "istihbarat teskilati",
  "polis sefi", "adalet bakani", "bassavci", "anayasa mahkemesi",
  "yuksek mahkeme", "meclis", "parlamento",
  "meclis baskani", "sozcu", "sozcusu", "basin sozcusu", "resmi aciklama",
  "basin aciklamasi", "bakanlik aciklamasi", "hukumet aciklamasi",
  "cumhurbaskanligi aciklamasi", "ortak aciklama", "bildiri",
  "deklarasyon", "teblig",
] as const;

const INTERNATIONAL_ORGS = [
  "un", "united nations", "un security council", "general assembly", "nato",
  "european union", "eu", "osce", "oic", "arab league", "african union",
  "g7", "g20", "brics", "asean", "world bank", "imf", "iaea", "wto",
  "who", "unhcr", "ocha", "icc", "icj", "red cross", "icrc", "bm",
  "birlesmis milletler", "bm guvenlik konseyi", "avrupa birligi", "ab",
  "dunya bankasi", "uluslararasi para fonu", "uaea", "dso", "ucm", "uad",
] as const;

const SOURCE_MEDIA = [
  "france 24", "france24", "ap", "associated press", "reuters", "bbc", "cnn",
  "trt haber", "al jazeera", "dw", "sky news", "guardian", "the guardian",
  "times of israel", "jerusalem post", "tass", "ansa", "euronews",
  "balkaninsight", "xinhua", "irna", "mehr", "presstv", "press tv", "sana",
  "wam", "qna",
] as const;

const SOURCE_MEDIA_SET = new Set(SOURCE_MEDIA.map(normalizeFilterText));

const PERSON_OVERRIDES = [
  { aliases: ["netanyahu", "benjamin netanyahu", "pm netanyahu"], country: "Israel", actor: "Netanyahu", title: "Prime Minister", institution: "Prime Minister's Office" },
  { aliases: ["hakan fidan", "bakan fidan"], country: "Turkey", actor: "Hakan Fidan", title: "Foreign Minister", institution: "Foreign Ministry" },
  { aliases: ["tbmm baskani kurtulmus", "kurtulmus", "numan kurtulmus"], country: "Turkey", actor: "Numan Kurtulmus", title: "Parliament Speaker", institution: "Parliament" },
  { aliases: ["crosetto", "guido crosetto"], country: "Italy", actor: "Guido Crosetto", title: "Defense Minister", institution: "Defense Ministry" },
  { aliases: ["meloni", "giorgia meloni"], country: "Italy", actor: "Giorgia Meloni", title: "Prime Minister", institution: "Prime Ministry" },
  { aliases: ["marco rubio", "rubio"], country: "United States", actor: "Marco Rubio", title: "Secretary of State", institution: "State Department" },
  { aliases: ["hegseth", "pete hegseth"], country: "United States", actor: "Pete Hegseth", title: "Defense Secretary", institution: "Department of Defense" },
  { aliases: ["trump", "donald trump", "president trump"], country: "United States", actor: "Donald Trump", title: "President", institution: "Presidency" },
  { aliases: ["putin", "vladimir putin", "president putin"], country: "Russia", actor: "Vladimir Putin", title: "President", institution: "Presidency" },
  { aliases: ["zelensky", "zelenskyy", "volodymyr zelenskyy"], country: "Ukraine", actor: "Volodymyr Zelenskyy", title: "President", institution: "Presidency" },
  { aliases: ["macron", "emmanuel macron"], country: "France", actor: "Emmanuel Macron", title: "President", institution: "Presidency" },
  { aliases: ["starmer", "keir starmer"], country: "United Kingdom", actor: "Keir Starmer", title: "Prime Minister", institution: "Prime Minister's Office" },
  { aliases: ["scholz", "olaf scholz"], country: "Germany", actor: "Olaf Scholz", title: "Chancellor", institution: "Chancellery" },
  { aliases: ["merz", "friedrich merz"], country: "Germany", actor: "Friedrich Merz", title: "Chancellor", institution: "Chancellery" },
  { aliases: ["xi", "xi jinping"], country: "China", actor: "Xi Jinping", title: "President", institution: "Presidency" },
  { aliases: ["modi", "narendra modi"], country: "India", actor: "Narendra Modi", title: "Prime Minister", institution: "Prime Ministry" },
  { aliases: ["pezeshkian", "masoud pezeshkian"], country: "Iran", actor: "Masoud Pezeshkian", title: "President", institution: "Presidency" },
  { aliases: ["khamenei", "ayatollah khamenei"], country: "Iran", actor: "Ayatollah Khamenei", title: "Supreme Leader", institution: "Supreme Leadership" },
  { aliases: ["erdogan", "recep tayyip erdogan", "president erdogan"], country: "Turkey", actor: "Recep Tayyip Erdogan", title: "President", institution: "Presidency" },
  { aliases: ["sisi", "abdel fattah el sisi"], country: "Egypt", actor: "Abdel Fattah el-Sisi", title: "President", institution: "Presidency" },
  { aliases: ["mbs", "mohammed bin salman"], country: "Saudi Arabia", actor: "Mohammed bin Salman", title: "Crown Prince", institution: "Royal Court" },
  { aliases: ["king salman"], country: "Saudi Arabia", actor: "King Salman", title: "King", institution: "Royal Court" },
  { aliases: ["mohammed bin zayed", "mbz"], country: "United Arab Emirates", actor: "Mohammed bin Zayed", title: "President", institution: "Presidency" },
  { aliases: ["sheikh tamim", "tamim bin hamad"], country: "Qatar", actor: "Tamim bin Hamad", title: "Emir", institution: "Emiri Diwan" },
] as const;

const COUNTRY_BY_ALIAS = new Map<string, string>();
for (const country of COUNTRY_ALIASES) {
  for (const alias of country.aliases) {
    COUNTRY_BY_ALIAS.set(normalizeFilterText(alias), country.label);
  }
}

const COUNTRY_ALIAS_MATCHERS = [...COUNTRY_BY_ALIAS.entries()]
  .sort((a, b) => b[0].length - a[0].length)
  .map(([alias, label]) => ({ alias, label }));

const INTERNATIONAL_ORG_SET = new Set(INTERNATIONAL_ORGS.map(normalizeFilterText));
const OFFICIAL_ROLE_SET = new Set(OFFICIAL_ROLE_PATTERNS.map(normalizeFilterText));
const OFFICIAL_ROLE_ALTERNATION = [...OFFICIAL_ROLE_SET]
  .sort((a, b) => b.length - a.length)
  .map((role) => escapeRegExp(role))
  .join("|");

const COUNTRY_ROLE_RE = new RegExp(
  `(^|\\s)(${COUNTRY_ALIAS_MATCHERS.map((item) => escapeRegExp(item.alias)).join("|")})\\s+` +
    `(${OFFICIAL_ROLE_ALTERNATION})(?=\\s|$|:|,)`,
);

const ROLE_COUNTRY_RE = new RegExp(
  `(^|\\s)(${OFFICIAL_ROLE_ALTERNATION})\\s+` +
    `(${COUNTRY_ALIAS_MATCHERS.map((item) => escapeRegExp(item.alias)).join("|")})(?=\\s|$|:|,)`,
);

const APPOINTMENT_RE = /\b(appoints|appointed|names|named|designates|designated|picks|chooses|nominates|nominated|taps|selected|atadi|goreve getirdi|gorevlendirdi|aday gosterdi|secti)\b/;
const APPOINTED_PERSON_RE = /\b(?:appoints|appointed|names|named|designates|designated|picks|chooses|nominates|nominated|taps|selected|atadi)\s+([a-z][a-z]+(?:\s+[a-z][a-z]+){0,3})\s+(?:as|to|for|olarak|gorevine|baskanligina|sef olarak)\b/;

const DIRECT_INSTITUTIONS = [
  { label: "White House", country: "United States", aliases: ["white house"] },
  { label: "State Department", country: "United States", aliases: ["state department"] },
  { label: "Pentagon", country: "United States", aliases: ["pentagon", "department of defense"] },
  { label: "Kremlin", country: "Russia", aliases: ["kremlin"] },
  { label: "IDF", country: "Israel", aliases: ["idf", "israeli army"] },
  { label: "Knesset", country: "Israel", aliases: ["knesset"] },
  { label: "TBMM", country: "Turkey", aliases: ["tbmm"] },
  { label: "Downing Street", country: "United Kingdom", aliases: ["downing street"] },
  { label: "Foreign Office", country: "United Kingdom", aliases: ["foreign office"] },
  { label: "Elysee", country: "France", aliases: ["elysee", "elysee palace"] },
  { label: "Quai d'Orsay", country: "France", aliases: ["quai d orsay"] },
  { label: "Bundestag", country: "Germany", aliases: ["bundestag"] },
  { label: "PLA", country: "China", aliases: ["pla", "people s liberation army"] },
  { label: "IRGC", country: "Iran", aliases: ["irgc", "revolutionary guards"] },
] as const;

const GENERIC_STATE_INSTITUTIONS = [
  "national security council", "security council", "prime minister s office",
  "prime minister office", "presidency", "foreign ministry",
  "ministry of foreign affairs", "defense ministry", "defence ministry",
  "ministry of defense", "ministry of defence", "interior ministry",
  "parliament", "senate", "congress", "supreme court",
  "constitutional court", "army", "armed forces", "general staff",
  "milli guvenlik kurulu", "ulusal guvenlik konseyi",
  "cumhurbaskanligi", "disisleri bakanligi", "savunma bakanligi",
  "milli savunma bakanligi", "icisleri bakanligi", "meclis",
] as const;

const STRATEGIC_LOCATION_BY_LABEL = new Map(
  [
    "Strait of Hormuz", "Red Sea", "Suez Canal", "South China Sea",
    "Taiwan Strait", "Eastern Mediterranean", "Persian Gulf", "Gulf of Aden",
    "Indo-Pacific",
  ].map((label) => [label, COUNTRY_ALIASES.find((item) => item.label === label)] as const),
);

const COUNTRY_ACTION_RE = new RegExp(
  `(^|\\s)(${COUNTRY_ALIAS_MATCHERS.map((item) => escapeRegExp(item.alias)).join("|")})\\s+` +
    "(condemns|condemned|warns|warned|says|said|announced|rejects|urged|calls|kinadi|uyardi|acikladi)(?=\\s|$)",
);

const GUARD_PATTERNS: Record<NoMarkerReason, readonly string[]> = {
  local_crime_not_geopolitical: [
    "park halindeki otomobil", "silahli saldiri", "yerel saldiri",
    "trafik kazasi", "otomobil kazasi", "tekne arizasi", "ariza yapan tekne",
    "kurtarildi", "mahalle", "ilce", "ordinary crime", "local crime",
    "traffic accident", "car crash", "bus driver", "license in new york",
  ],
  sports_or_non_relevant_domain: [
    "tennis", "football", "soccer", "basketball", "volleyball",
    "roland garros", "djokovic", "knocks out", "third round", "match",
    "tournament", "score", "league", "transfer",
  ],
  non_relevant_lifestyle_item: [
    "everest", "tattoos", "therapeutic", "healing ink", "celebrity",
    "movie", "album", "travel", "tourism", "weather conditions",
    "lifestyle", "human interest",
  ],
  analysis_or_opinion_item: [
    "reflects his wishes", "not agreed terms", "what it means",
    "raising the stakes", "masking strategic weakness", "examines",
    "political pawns", "the lebanon i knew", "when will it end",
    "want to keep", "not take his oil", "likely pushing", "analysis",
    "opinion", "commentary", "explainer",
  ],
  no_explicit_location: [],
  only_mentioned_entity: [],
  unresolved_official_actor: [],
  unresolved_demonym: [],
  unresolved_turkish_suffix_location: [],
  unresolved_event_venue: [],
  multi_location_requires_policy: [],
  source_entity_not_location: [],
  background_context_only: [],
  ambiguous_competing_locations: [],
  unresolved_issuing_country: [],
  unresolved_institution_country: [],
  ambiguous_official_actor: [],
  institution_without_country_context: [],
};

function hasAny(text: string, phrases: readonly string[]): boolean {
  return phrases.some((phrase) => containsNormalizedPhrase(text, phrase));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function firstSentence(value?: string): string {
  return (value ?? "").split(/[.!?]\s/)[0] ?? "";
}

function limitedBodyText(value?: string): string | undefined {
  return value ? value.slice(0, MAX_CONTEXT_BODY_CHARS) : undefined;
}

function detectGuard(text: string): NoMarkerReason | undefined {
  for (const reason of [
    "sports_or_non_relevant_domain",
    "local_crime_not_geopolitical",
    "non_relevant_lifestyle_item",
  ] as const) {
    if (hasAny(text, GUARD_PATTERNS[reason])) return reason;
  }
  return undefined;
}

function detectAppointmentEvent(text: string): SourceEventType | undefined {
  const hasAppointment =
    APPOINTMENT_RE.test(text) ||
    hasAny(text, [
      "becomes new", "as new", "to lead", "new national security council chief",
      "new defense chief", "new defence chief", "new army chief",
      "new foreign minister", "new ambassador", "new envoy",
      "yeni gorev", "baskanligina atadi", "sef olarak atadi",
      "liderligine getirdi",
    ]);
  if (!hasAppointment) return undefined;
  if (hasAny(text, ["national security council", "security adviser", "security advisor", "milli guvenlik", "ulusal guvenlik"])) {
    return "national_security_appointment";
  }
  if (hasAny(text, ["defense chief", "defence chief", "army chief", "chief of staff", "general staff", "defense minister", "defence minister", "savunma", "genelkurmay"])) {
    return "defense_appointment";
  }
  if (hasAny(text, ["ambassador", "envoy", "foreign minister", "foreign ministry", "buyukelci", "elci", "disisleri"])) {
    return "diplomatic_appointment";
  }
  if (hasAny(text, ["prime minister", "president", "government", "minister", "bakan", "basbakan", "cumhurbaskani"])) {
    return "government_appointment";
  }
  return "official_appointment";
}

function detectEventType(text: string): SourceEventType {
  if (hasAny(text, GUARD_PATTERNS.sports_or_non_relevant_domain)) return "sports";
  if (hasAny(text, GUARD_PATTERNS.local_crime_not_geopolitical)) return "local_crime";
  if (hasAny(text, GUARD_PATTERNS.non_relevant_lifestyle_item)) return "lifestyle";
  if (hasAny(text, GUARD_PATTERNS.analysis_or_opinion_item)) return "analysis_or_opinion";
  const appointmentEvent = detectAppointmentEvent(text);
  if (appointmentEvent) return appointmentEvent;
  if (hasAny(text, ["ebola", "outbreak", "salgini", "salgin", "who warns", "dso"])) return "health_outbreak";
  if (hasAny(text, ["missile strike", "fuze saldirisi"])) return "missile_strike";
  if (hasAny(text, ["drone strike", "drone strikes", "iha saldirisi", "siha saldirisi"])) return "drone_strike";
  if (hasAny(text, ["fires on", "hostile drone", "mistaking it for hostile drone"])) return "military_incident";
  if (hasAny(text, ["strait of hormuz", "waterway", "ship attacked", "attack on ship", "vessel hit", "maritime security"])) return "strategic_waterway";
  if (hasAny(text, ["airstrike", "air strike", "strike", "strikes", "attack", "attacks", "saldiri", "saldirilarini"])) return "strike";
  if (hasAny(text, ["condemns", "condemned", "kinadi", "bears full responsibility", "responsibility for"])) return "condemnation";
  if (hasAny(text, ["warns", "warned", "sounds alarm", "uyardi", "alarm seviyesini"])) return "warning";
  if (hasAny(text, ["visits", "visited", "to visit", "heads to", "travels to", "gidecek", "ziyareti", "ziyaret edecek"])) return "diplomatic_visit";
  if (hasAny(text, ["summit", "zirve"])) return "summit";
  if (hasAny(text, ["meets with", "met with", "held talks with", "gorus", "gorustu", "gorusecek"])) return "meeting";
  if (hasAny(text, ["sanctions slash", "sanctions impact", "yaptirim etkisi"])) return "sanctions_impact";
  if (hasAny(text, ["sanctions", "yaptirim"])) return "sanctions_announcement";
  if (hasAny(text, ["official statement", "press statement", "message", "mesaji", "aciklama", "said", "says"])) return "official_statement";
  return "unknown";
}

function countriesInText(text: string): string[] {
  const found = new Set<string>();
  for (const { alias, label } of COUNTRY_ALIAS_MATCHERS) {
    if (containsNormalizedPhrase(text, alias)) found.add(label);
  }
  return [...found];
}

function findFirstCountryInText(text: string): string | undefined {
  return countriesInText(text)[0];
}

function findSourceMedia(text: string): string[] {
  const found: string[] = [];
  for (const name of SOURCE_MEDIA_SET) {
    if (containsNormalizedPhrase(text, name)) found.push(name);
  }
  return found;
}

function canonicalRole(value: string): string {
  switch (value) {
    case "pm":
    case "basbakan":
      return "Prime Minister";
    case "cumhurbaskani":
    case "president":
      return "President";
    case "foreign minister":
    case "disisleri bakani":
      return "Foreign Minister";
    case "defense minister":
    case "defence minister":
    case "savunma bakani":
      return "Defense Minister";
    case "pentagon":
    case "department of defense":
      return "Defense Department";
    case "national security council":
    case "ulusal guvenlik konseyi":
    case "milli guvenlik kurulu":
      return "National Security Council";
    default:
      return value
        .split(" ")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ");
  }
}

function applyPersonOverrides(
  text: string,
  roles: SourceEntityRoles,
  contextReasons: string[],
): void {
  for (const person of PERSON_OVERRIDES) {
    if (!hasAny(text, person.aliases)) continue;
    roles.issuingActor ??= person.actor;
    roles.issuingCountry ??= person.country;
    roles.issuingInstitution ??= person.institution;
    roles.issuingTitle ??= person.title;
    contextReasons.push(`known_actor_alias: ${person.actor} -> ${person.country}`);
    return;
  }
}

function detectCountryRole(
  text: string,
  roles: SourceEntityRoles,
  contextReasons: string[],
): void {
  if (roles.issuingCountry) return;
  const countryRole = COUNTRY_ROLE_RE.exec(text);
  const roleCountry = countryRole ? null : ROLE_COUNTRY_RE.exec(text);
  const alias = countryRole?.[2] ?? roleCountry?.[3];
  const role = countryRole?.[3] ?? roleCountry?.[2];
  if (!alias || !role) return;
  const country = COUNTRY_BY_ALIAS.get(alias);
  if (!country) return;
  roles.issuingCountry = country;
  roles.issuingTitle ??= canonicalRole(role);
  contextReasons.push(`country_demonym_role: ${alias} ${role} -> ${country}`);
}

function detectInstitutionContext(
  text: string,
  roles: SourceEntityRoles,
  contextReasons: string[],
): void {
  for (const institution of DIRECT_INSTITUTIONS) {
    if (!hasAny(text, institution.aliases)) continue;
    roles.issuingInstitution ??= institution.label;
    roles.institution ??= institution.label;
    roles.issuingCountry ??= institution.country;
    contextReasons.push(`institution_country: ${institution.label} -> ${institution.country}`);
    return;
  }

  for (const institution of GENERIC_STATE_INSTITUTIONS) {
    if (!containsNormalizedPhrase(text, institution)) continue;
    roles.institution ??= canonicalRole(institution);
    roles.issuingInstitution ??= roles.institution;
    if (roles.issuingCountry) {
      contextReasons.push(`institution_inherits_country: ${roles.institution} -> ${roles.issuingCountry}`);
    }
    return;
  }
}

function detectAppointedPerson(text: string, roles: SourceEntityRoles): void {
  const match = APPOINTED_PERSON_RE.exec(text);
  if (!match?.[1]) return;
  const blocked = new Set(["new", "the", "a", "an"]);
  const name = match[1].trim();
  if (blocked.has(name)) return;
  roles.appointedPerson ??= name;
}

function detectOfficialActor(
  text: string,
  roles: SourceEntityRoles,
  countries: readonly string[],
): void {
  if (roles.issuingCountry || countries.length === 0) return;
  for (const role of OFFICIAL_ROLE_SET) {
    if (!containsNormalizedPhrase(text, role)) continue;
    roles.issuingCountry = countries[0];
    roles.issuingTitle ??= canonicalRole(role);
    return;
  }
}

function detectIssuingInstitution(text: string, roles: SourceEntityRoles): void {
  if (roles.issuingInstitution) return;
  for (const org of INTERNATIONAL_ORG_SET) {
    if (!containsNormalizedPhrase(text, org)) continue;
    roles.issuingInstitution = org.toUpperCase();
    return;
  }
}

function detectCountryAction(text: string, roles: SourceEntityRoles): void {
  if (roles.issuingCountry) return;
  const match = COUNTRY_ACTION_RE.exec(text);
  if (match?.[2]) {
    roles.issuingCountry = COUNTRY_BY_ALIAS.get(match[2]) ?? roles.issuingCountry;
  }
}

function detectAttackRoles(text: string, roles: SourceEntityRoles): void {
  if (hasAny(text, ["israeli strike", "israeli strikes", "israilden", "soykirimci israil", "idf fires"])) {
    roles.primaryActorCountry ??= "Israel";
  }
  if (hasAny(text, ["iranian missile", "iranian strike"])) roles.primaryActorCountry ??= "Iran";
  if (hasAny(text, ["lebanese soldiers"])) {
    roles.affectedActor ??= "Lebanese soldiers";
    roles.affectedCountry ??= "Lebanon";
  }
  if (hasAny(text, ["gaza", "gazze"])) roles.affectedLocation ??= "Gaza Strip";
  if (hasAny(text, ["west bank", "bati seria"])) roles.eventLocation ??= "West Bank";
  if (hasAny(text, ["kuwait base", "in kuwait", "kuwait"])) roles.eventLocation ??= "Kuwait";
  if (hasAny(text, ["romania hit", "romanian building", "in romania"])) roles.referencedEventLocation ??= "Romania";
  if (hasAny(text, ["lubnan", "lebanon"])) roles.affectedCountry ??= roles.affectedCountry ?? "Lebanon";
}

function detectVisitOrMeeting(
  roles: SourceEntityRoles,
  eventType: SourceEventType,
  countries: readonly string[],
): void {
  if (eventType === "diplomatic_visit") {
    const destinations = countries.filter(
      (country) => country !== roles.issuingCountry,
    );
    if (destinations.length > 0) roles.destinationLocations = destinations;
  }
  if (eventType === "meeting" || eventType === "summit") {
    const counterparties = countries.filter((country) => country !== roles.issuingCountry);
    const counterparty = counterparties[0] ?? countries[0];
    if (counterparty) roles.officialCounterpartyCountry = counterparty;
  }
}

function detectStrategicAndImpact(text: string, roles: SourceEntityRoles): void {
  for (const strategic of [
    ...STRATEGIC_LOCATION_BY_LABEL.keys(),
  ]) {
    const entry = STRATEGIC_LOCATION_BY_LABEL.get(strategic);
    if (entry && hasAny(text, entry.aliases)) {
      roles.strategicLocation = strategic;
      return;
    }
  }
}

function detectSanctionsImpact(text: string, roles: SourceEntityRoles): void {
  if (hasAny(text, ["montenegro", "karadag"])) roles.impactLocation = "Montenegro";
  if (hasAny(text, ["russian investments", "russian assets"])) roles.targetActor = "Russian investments";
  if (hasAny(text, ["eu sanctions", "european union sanctions", "ab yaptirim"])) {
    roles.issuingInstitution ??= "EU";
  }
}

function detectBlamedAndPartner(text: string, roles: SourceEntityRoles): void {
  if (hasAny(text, ["russia bears", "russia after", "russia for", "russian responsibility"])) {
    roles.blamedActor ??= "Russia";
  }
  if (hasAny(text, ["japan", "japonya"])) roles.partnerCountry ??= "Japan";
  if (hasAny(text, ["south korea says", "guney kore"])) roles.reportingActorCountry ??= "South Korea";
}

function isAppointmentEvent(eventType: SourceEventType): boolean {
  return (
    eventType === "official_appointment" ||
    eventType === "government_appointment" ||
    eventType === "national_security_appointment" ||
    eventType === "defense_appointment" ||
    eventType === "diplomatic_appointment"
  );
}

export function classifySourceContext(
  item: NormalizedSourceItem,
): SourceContextClassification {
  if (item.sourceContextClassification) return item.sourceContextClassification;

  const title = item.normalizedTitleText ?? normalizeFilterText(item.title);
  const summaryFirst =
    item.normalizedSummaryFirstText ?? normalizeFilterText(firstSentence(item.summary));
  const bodyFirst =
    item.normalizedBodyFirstText ?? normalizeFilterText(firstSentence(limitedBodyText(item.bodyText)));
  const text =
    item.normalizedContextText ??
    normalizeFilterText(
      [item.title, item.summary, limitedBodyText(item.bodyText), item.sourceName]
        .filter(Boolean)
        .join(" "),
    );
  item.normalizedTitleText = title;
  item.normalizedSummaryFirstText = summaryFirst;
  item.normalizedBodyFirstText = bodyFirst;
  item.normalizedContextText = text;
  const eventType = detectEventType(text);
  const roles: SourceEntityRoles = {};
  const contextReasons: string[] = [];
  const textCountries = countriesInText(text);

  const sourceMedia = findSourceMedia(text);
  if (sourceMedia.length > 0) roles.sourceMedia = sourceMedia;

  applyPersonOverrides(text, roles, contextReasons);
  detectCountryRole(text, roles, contextReasons);
  detectOfficialActor(text, roles, textCountries);
  detectCountryAction(text, roles);
  detectIssuingInstitution(text, roles);
  detectInstitutionContext(text, roles, contextReasons);
  detectAppointedPerson(text, roles);
  detectBlamedAndPartner(text, roles);

  if (
    eventType === "strike" ||
    eventType === "attack" ||
    eventType === "drone_strike" ||
    eventType === "missile_strike" ||
    eventType === "military_incident"
  ) {
    detectAttackRoles(text, roles);
  }

  if (eventType === "health_outbreak" || eventType === "humanitarian_crisis") {
    roles.affectedCountry = findFirstCountryInText(summaryFirst) ?? findFirstCountryInText(bodyFirst) ?? roles.affectedCountry;
    if (roles.affectedCountry) contextReasons.push("summary/body health-crisis location");
  }

  detectVisitOrMeeting(roles, eventType, textCountries);
  detectStrategicAndImpact(text, roles);
  if (eventType === "sanctions_impact") detectSanctionsImpact(text, roles);

  if (!roles.affectedLocation && !roles.eventLocation && title) {
    const titleLocation = findFirstCountryInText(title);
    if (titleLocation) {
      roles.eventLocation = titleLocation;
      contextReasons.push("title location");
    }
  }

  if (!roles.affectedCountry && !roles.affectedLocation && summaryFirst) {
    const summaryLocation = findFirstCountryInText(summaryFirst);
    if (summaryLocation) roles.mentionedOnly = [summaryLocation];
  }

  const guard = detectGuard(text);
  const noMarkerReason =
    eventType === "analysis_or_opinion"
      ? "analysis_or_opinion_item"
      : isAppointmentEvent(eventType) && !roles.issuingCountry && roles.institution
        ? "institution_without_country_context"
        : isAppointmentEvent(eventType) && !roles.issuingCountry
          ? "unresolved_issuing_country"
      : guard;

  const classification = {
    eventType,
    entityRoles: roles,
    contextReasons,
    filterGuardReason: guard,
    noMarkerReason,
  };
  item.sourceContextClassification = classification;
  return classification;
}
