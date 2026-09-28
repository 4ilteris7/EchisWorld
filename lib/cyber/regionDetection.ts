// ---------------------------------------------------------------------------
// Region detection with attacker / victim role attribution.
//
// THE CORE PROBLEM this solves:
//   "Chinese hackers target Taiwan" mentions two countries. A naive
//   country-name counter records both as equal. That is wrong: China is the
//   attacker ORIGIN, Taiwan is the affected TARGET. This module reads the
//   sentence context around every geographic mention and assigns it a role:
//
//     origin  — attacker home   ("Chinese hackers", "Volt Typhoon",
//                                 "attributed to Russia", "targeted by Iran")
//     target  — victim/affected ("target Taiwan", "Taiwanese firms",
//                                 "Ukraine was breached", "against US banks")
//     neutral — mentioned, role unclear
//
// Detection is deterministic context matching over normalized text — no AI,
// no network. Confidence bands reflect how strong the surrounding evidence is.
// ---------------------------------------------------------------------------

import type {
  ActorHit,
  CountryHit,
  GeoRole,
  RegionId,
  SignalConfidence,
} from "./types";
import { normalizeText, findTermSpans } from "./normalize";
import {
  NORMALIZED_COUNTRIES,
  NORMALIZED_REGION_DIRECT,
  COUNTRY_BY_NAME,
  type NormalizedCountry,
} from "./geoLexicon";
import { NORMALIZED_ACTORS } from "./threatActors";

// ── Geo token index ─────────────────────────────────────────────────────────

interface GeoToken {
  term: string;
  country: NormalizedCountry;
  isDemonym: boolean;
}

// All country aliases + demonyms as flat tokens, longest first (so multi-word
// "north korea" wins over any fragment and span de-dup prefers the longer one).
const GEO_TOKENS: GeoToken[] = (() => {
  const tokens: GeoToken[] = [];
  for (const c of NORMALIZED_COUNTRIES) {
    for (const a of c.normAliases) tokens.push({ term: a, country: c, isDemonym: false });
    for (const d of c.normDemonyms) tokens.push({ term: d, country: c, isDemonym: true });
  }
  return tokens.sort((a, b) => b.term.length - a.term.length);
})();

// ── Context regexes (precision-tuned) ───────────────────────────────────────
// `before` regexes are anchored with `$` (they test the text ENDING right at
// the geo mention). `after` regexes are anchored with `^` (text STARTING right
// after the geo mention). Windows are sliced ±64 chars around the span.

const WINDOW = 64;

/** Actor noun that, following a demonym, marks the demonym's country as origin. */
const ACTOR_NOUN_AFTER =
  /^[ -](?:state[ -]sponsored |government[ -]backed |nation[ -]state |military |cyber |elite )*(?:apt\b|advanced persistent threat|hackers?\b|hacking (?:group|crew|team|unit)|threat actors?\b|threat group|cyber ?spies?\b|cyber ?espionage|cyber ?criminals?\b|operatives?\b|spies\b|cyber army|cyber unit|intelligence (?:group|operatives|service))/;

/** Geo immediately followed by a "-linked / -backed / -sponsored" tail → origin. */
const ORIGIN_TAIL_AFTER =
  /^[ -](?:linked|backed|sponsored|aligned|affiliated|nexus|controlled|directed|state[ -]sponsored|state[ -]backed|speaking)\b/;

/** Geo's intelligence service → origin ("Russia's GRU", "Iran's IRGC"). */
const ORIGIN_INTEL_AFTER =
  /^(?:'s)?[ ](?:gru|svr|fsb|mss|irgc|rgb|intelligence|military intelligence|cyber army|cyber command|state security|spy agency)\b/;

/** Attribution / provenance phrase ending right before the geo → origin. */
const ORIGIN_BEFORE =
  /(?:attributed to|blamed on|blamed|linked to|tied to|operated by|carried out by|conducted by|orchestrated by|run by|backed by|sponsored by|hackers? from|actors? from|attackers? from|hackers? based in|actors? based in|based in|operating (?:from|out of)|originating (?:from|in)|stemming from|emanating from|out of)\s+(?:the\s+)?$/;

/** Passive-voice attack ("… was targeted by", "breached by") → geo is origin. */
const ORIGIN_PASSIVE_BY_BEFORE =
  /(?:targeted|attacked|hit|breached|compromised|hacked|struck|infiltrated|disrupted|backed|sponsored|operated|run|orchestrated|launched)\s+by\s+(?:the\s+|suspected\s+|alleged(?:ly)?\s+)*$/;

/** Active targeting verb ending right before the geo → geo is target. */
const TARGET_VERB_BEFORE =
  /(?:^|[^a-z])(?:targets?|targeting|targeted|hits?|hitting|attacks?|attacking|attacked|breach(?:es|ing|ed)?|compromis(?:e|es|ing|ed)|infiltrat(?:e|es|ing|ed)|strikes?|struck|striking|hacks?|hacking|hacked|disrupt(?:s|ing|ed)?|infect(?:s|ing|ed)?|spying on|spied on|aimed at|directed at|deployed against|launched against)\s+(?:the\s+|a\s+|an\s+|several\s+|multiple\s+|various\s+|numerous\s+|dozens of\s+|some\s+){0,2}$/;

/** Victim preposition ending right before the geo → target. */
const TARGET_PREP_BEFORE =
  /(?:^|[^a-z])(?:against|across|throughout|affecting|impacting|victims in|aimed at|directed at|focused on|campaign against|operations? against|espionage against|attacks? on|assault on|raids? on)\s+(?:the\s+|\w+\s+){0,2}$/;

/** Victim noun following the geo → target (attack context required, see below). */
const VICTIM_NOUN_CORE =
  "government|governments|govt|agency|agencies|ministry|ministries|firm|firms|company|companies|organization|organizations|organisation|organisations|business|businesses|enterprise|enterprises|user|users|customer|customers|citizen|citizens|resident|residents|national|nationals|hospital|hospitals|clinic|clinics|bank|banks|university|universities|school|schools|infrastructure|network|networks|systems|entity|entities|institution|institutions|sector|industry|industries|military|defense|defence|telecom|telecoms|grid|utilities|servers|developers|users";

/** Country-name form: victim noun must be (almost) immediate. */
const VICTIM_NOUN_AFTER_NAME = new RegExp(`^(?:'s)?[ ](?:${VICTIM_NOUN_CORE})\\b`);
/** Demonym form: allow up to two adjectives ("Taiwanese chip firms"). */
const VICTIM_NOUN_AFTER_DEMONYM = new RegExp(`^[ ](?:[a-z][a-z-]+ ){0,2}(?:${VICTIM_NOUN_CORE})\\b`);

/** Geo followed by passive victim verb → target ("Ukraine was breached"). */
const VICTIM_VERB_AFTER =
  /^(?:'s [a-z]+)?[ ](?:was|were|is|are|got|has been|have been|had been)\s+(?:also\s+|recently\s+|reportedly\s+|allegedly\s+)*(?:targeted|hit|breached|attacked|hacked|compromised|infiltrated|struck|disrupted|affected|impacted|victimi[sz]ed|exposed|leaked)\b|^[ ](?:fell victim|came under attack|suffered (?:a|an|from) (?:breach|cyber ?attack|ransomware|hack|intrusion|data breach))/;

/** Whole-item attack context — gates the weaker victim-noun rule. */
const ATTACK_CONTEXT_RE =
  /(?:^|[^a-z])(?:breach|breached|hack|hacked|hacking|attack|attacked|cyberattack|ransomware|malware|compromis|infiltrat|target|targeted|exploit|exploited|stole|stolen|steal|leak|leaked|exposed|exposing|espionage|spy|spying|backdoor|intrusion|victim|phishing|trojan|wiper|breach|data breach)/;

// ── Case-sensitive abbreviation pre-tagging ─────────────────────────────────
// "US" / "U.S." are extremely common for the United States but collide with
// the pronoun "us" once lowercased. We resolve the ambiguity BEFORE
// normalization using letter case: only the fully-uppercase country forms are
// rewritten to the safe alias "usa". Lowercase "us" / sentence-initial "Us"
// (the pronoun) are left untouched and therefore never match a country.
const US_ABBREV_RE = /\bU\.S\.A\.?|\bU\.S\.|\bUSA\b|\bUS\b/g;

function preTagAbbreviations(raw: string): string {
  return raw.replace(US_ABBREV_RE, " usa ");
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function strongerRole(a: GeoRole, b: GeoRole): GeoRole {
  // target > origin > neutral for a single mention's primary role.
  const rank: Record<GeoRole, number> = { target: 3, origin: 2, neutral: 1 };
  return rank[a] >= rank[b] ? a : b;
}

function strongerConfidence(a: SignalConfidence, b: SignalConfidence): SignalConfidence {
  const rank: Record<SignalConfidence, number> = { high: 3, medium: 2, low: 1 };
  return rank[a] >= rank[b] ? a : b;
}

interface RoleVerdict {
  role: GeoRole;
  confidence: SignalConfidence;
  evidence: string;
}

/** Classify one geo mention from its surrounding context. */
function classifyMention(
  before: string,
  after: string,
  token: GeoToken,
  hasAttackContext: boolean,
): RoleVerdict {
  // ORIGIN (checked first — attacker attribution is the high-value signal).
  if (token.isDemonym && ACTOR_NOUN_AFTER.test(after)) {
    return { role: "origin", confidence: "high", evidence: `${token.term} <actor>` };
  }
  if (ORIGIN_TAIL_AFTER.test(after)) {
    return { role: "origin", confidence: "high", evidence: `${token.term}-linked` };
  }
  if (ORIGIN_INTEL_AFTER.test(after)) {
    return { role: "origin", confidence: "high", evidence: `${token.term}'s intel service` };
  }
  if (ORIGIN_PASSIVE_BY_BEFORE.test(before)) {
    return { role: "origin", confidence: "high", evidence: `… by ${token.term}` };
  }
  if (ORIGIN_BEFORE.test(before)) {
    return { role: "origin", confidence: "high", evidence: `attributed → ${token.term}` };
  }

  // TARGET.
  if (TARGET_VERB_BEFORE.test(before)) {
    return { role: "target", confidence: "high", evidence: `<verb> ${token.term}` };
  }
  if (VICTIM_VERB_AFTER.test(after)) {
    return { role: "target", confidence: "high", evidence: `${token.term} was attacked` };
  }
  if (TARGET_PREP_BEFORE.test(before)) {
    return { role: "target", confidence: "medium", evidence: `against ${token.term}` };
  }
  const victimRe = token.isDemonym ? VICTIM_NOUN_AFTER_DEMONYM : VICTIM_NOUN_AFTER_NAME;
  if (victimRe.test(after) && hasAttackContext) {
    return { role: "target", confidence: "medium", evidence: `${token.term} <victim>` };
  }

  // NEUTRAL.
  return {
    role: "neutral",
    confidence: token.isDemonym ? "low" : "medium",
    evidence: token.term,
  };
}

export interface GeoDetectionResult {
  countries: CountryHit[];
  regionDirect: Array<{
    regionId: RegionId;
    roles: GeoRole[];
    primaryRole: GeoRole;
    confidence: SignalConfidence;
    evidence: string;
  }>;
  actors: ActorHit[];
}

/**
 * Detect geographic signals + actors for a single item.
 * `title` is weighted implicitly: it is placed first and separated from the
 * summary by a sentence boundary so verb/object windows never cross it.
 */
export function detectGeoSignals(title: string, summary = ""): GeoDetectionResult {
  const text = `${normalizeText(preTagAbbreviations(title))} . ${normalizeText(
    preTagAbbreviations(summary),
  )}`.trim();
  const hasAttackContext = ATTACK_CONTEXT_RE.test(text);

  // Per-country accumulator: country name → roles/confidence/evidence.
  const byCountry = new Map<
    string,
    { country: NormalizedCountry; roles: Set<GeoRole>; confidence: SignalConfidence; evidence: string; primaryRole: GeoRole }
  >();

  const claimed: Array<{ start: number; end: number }> = [];
  const overlapsClaimed = (s: number, e: number) =>
    claimed.some((c) => s < c.end && e > c.start);

  // 1) Country/demonym mentions with role classification.
  for (const token of GEO_TOKENS) {
    const spans = findTermSpans(text, token.term);
    for (const span of spans) {
      // Longest-first ordering means a shorter token overlapping an already
      // claimed longer span (same or different country) is skipped.
      if (overlapsClaimed(span.start, span.end)) continue;
      claimed.push(span);

      const before = text.slice(Math.max(0, span.start - WINDOW), span.start);
      const after = text.slice(span.end, span.end + WINDOW);
      const verdict = classifyMention(before, after, token, hasAttackContext);

      const key = token.country.name;
      const acc = byCountry.get(key);
      if (acc) {
        acc.roles.add(verdict.role);
        acc.confidence = strongerConfidence(acc.confidence, verdict.confidence);
        acc.primaryRole = strongerRole(acc.primaryRole, verdict.role);
        if (verdict.role !== "neutral" && acc.evidence.length < 60) {
          acc.evidence = `${acc.evidence}; ${verdict.evidence}`;
        }
      } else {
        byCountry.set(key, {
          country: token.country,
          roles: new Set([verdict.role]),
          confidence: verdict.confidence,
          primaryRole: verdict.role,
          evidence: verdict.evidence,
        });
      }
    }
  }

  // 2) Threat actors → origin signal for nation-state groups.
  const actors: ActorHit[] = [];
  for (const actor of NORMALIZED_ACTORS) {
    let matched = "";
    for (const alias of actor.normAliases) {
      const spans = findTermSpans(text, alias);
      if (spans.length > 0) {
        matched = alias;
        break;
      }
    }
    if (!matched) continue;

    const attributed = actor.attributedCountry
      ? COUNTRY_BY_NAME.get(actor.attributedCountry)
      : undefined;
    actors.push({
      name: actor.canonical,
      kind: actor.kind,
      attributedCountry: actor.attributedCountry,
      attributedRegionId: attributed?.regionId,
      evidence: matched,
    });

    if (actor.kind === "nation_state" && attributed) {
      const key = attributed.name;
      const acc = byCountry.get(key);
      if (acc) {
        acc.roles.add("origin");
        acc.confidence = "high";
        acc.primaryRole = strongerRole(acc.primaryRole, "origin");
      } else {
        byCountry.set(key, {
          country: attributed,
          roles: new Set<GeoRole>(["origin"]),
          confidence: "high",
          primaryRole: "origin",
          evidence: `actor:${actor.canonical}`,
        });
      }
    }
  }

  // 3) Direct macro-region mentions (Europe, Middle East, …).
  const regionDirect: GeoDetectionResult["regionDirect"] = [];
  for (const rd of NORMALIZED_REGION_DIRECT) {
    for (const term of rd.terms) {
      const spans = findTermSpans(text, term);
      let verdict: RoleVerdict | null = null;
      for (const span of spans) {
        if (overlapsClaimed(span.start, span.end)) continue;
        claimed.push(span);
        const before = text.slice(Math.max(0, span.start - WINDOW), span.start);
        const after = text.slice(span.end, span.end + WINDOW);
        // Region-direct words behave like a demonym for victim-noun purposes.
        const v = classifyMention(before, after, { term, country: null as never, isDemonym: true }, hasAttackContext);
        verdict = verdict ? { ...v, role: strongerRole(verdict.role, v.role) } : v;
      }
      if (verdict) {
        regionDirect.push({
          regionId: rd.regionId,
          roles: [verdict.role],
          primaryRole: verdict.role,
          confidence: verdict.confidence === "low" ? "low" : "medium",
          evidence: verdict.evidence,
        });
      }
    }
  }

  const countries: CountryHit[] = Array.from(byCountry.values()).map((acc) => ({
    country: acc.country.name,
    regionId: acc.country.regionId,
    roles: Array.from(acc.roles),
    primaryRole: acc.primaryRole,
    confidence: acc.confidence,
    evidence: acc.evidence,
  }));

  return { countries, regionDirect, actors };
}
