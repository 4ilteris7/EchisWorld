// ---------------------------------------------------------------------------
// Policy Dossier lexicon.
//
//   weight 3 = strong, specific phrase
//   weight 2 = solid signal
//   weight 1 = weak/contextual signal
// ---------------------------------------------------------------------------

import type { PolicySeverity, PolicyTopic } from "../../types/policy";
import { POLICY_TOPICS } from "../../types/policy";
import { normalizeText } from "../cyber/normalize";

type Pattern = readonly [term: string, weight: number];

export interface NormPattern {
  term: string;
  weight: number;
}

interface TopicEntry {
  topic: PolicyTopic;
  patterns: readonly Pattern[];
}

export const TOPIC_PATTERNS: readonly TopicEntry[] = [
  {
    topic: "Diplomacy",
    patterns: [
      ["diplomatic talks", 3], ["foreign minister", 3], ["bilateral talks", 3],
      ["peace talks", 3], ["shuttle diplomacy", 3], ["normalization talks", 3],
      ["summit", 2], ["diplomacy", 2], ["diplomatic", 2], ["envoy", 2],
      ["ambassador", 2], ["delegation", 2], ["mediation", 2], ["negotiation", 2],
      ["dialogue", 2], ["treaty", 2], ["bilateral", 1], ["visit", 1],
    ],
  },
  {
    topic: "Defense & Security",
    patterns: [
      ["defense ministry", 3], ["security agreement", 3], ["military exercise", 3],
      ["border security", 3], ["air defense", 3], ["missile defense", 3],
      ["defense", 2], ["defence", 2], ["security", 2], ["military", 2],
      ["troop", 2], ["army", 2], ["navy", 2], ["air force", 2],
      ["counterterrorism", 2], ["intelligence", 2], ["nato", 2],
      ["border", 1], ["patrol", 1],
    ],
  },
  {
    topic: "Economy & Sanctions",
    patterns: [
      ["sanctions package", 3], ["export controls", 3], ["trade restrictions", 3],
      ["frozen assets", 3], ["dual-use technology", 3], ["economic sanctions", 3],
      ["sanction", 2], ["sanctions", 2], ["tariff", 2], ["embargo", 2],
      ["finance ministry", 2], ["central bank", 2], ["trade", 2],
      ["economy", 2], ["economic", 2], ["investment", 2], ["aid package", 2],
      ["market", 1], ["export", 1],
    ],
  },
  {
    topic: "Intl. Organizations",
    patterns: [
      ["un security council", 3], ["united nations", 3], ["european union", 3],
      ["international organization", 3], ["international organisation", 3],
      ["security council", 3], ["world bank", 3], ["member states", 2],
      ["coalition", 2], ["osce", 2], ["asean", 2], ["african union", 2],
      ["arab league", 2], ["imf", 2], ["opec", 2], ["u.n.", 2], ["un", 2],
      ["e.u.", 2], ["eu", 2],
    ],
  },
  {
    topic: "Official Statements",
    patterns: [
      ["official statement", 3], ["joint statement", 3], ["press release", 3],
      ["ministry said", 3], ["government said", 3], ["spokesperson said", 3],
      ["president said", 3], ["prime minister said", 3], ["statement", 2],
      ["briefing", 2], ["communique", 2], ["spokesperson", 2],
      ["official", 2], ["according to", 1], ["announced", 1], ["said", 1],
    ],
  },
  {
    topic: "Energy",
    patterns: [
      ["energy security", 3], ["oil pipeline", 3], ["gas pipeline", 3],
      ["nuclear plant", 3], ["power grid", 3], ["lng terminal", 3],
      ["energy", 2], ["oil", 2], ["gas", 2], ["pipeline", 2], ["crude", 2],
      ["lng", 2], ["electricity", 2], ["refinery", 2], ["tanker", 2],
      ["gas supply", 2], ["transit", 1], ["reserves", 1],
    ],
  },
  {
    topic: "Crisis & Conflict",
    patterns: [
      ["emergency session", 3], ["state of emergency", 3], ["border clash", 3],
      ["air strike", 3], ["airstrike", 3], ["missile strike", 3],
      ["humanitarian crisis", 3], ["armed conflict", 3], ["mobilization", 3],
      ["ultimatum", 3], ["ceasefire", 2], ["clash", 2], ["strike", 2],
      ["attack", 2], ["war", 2], ["invasion", 2], ["crisis", 2],
      ["conflict", 2], ["unrest", 2], ["violence", 2], ["evacuation", 2],
      ["blockade", 2], ["truce", 2], ["casualty", 2], ["escalation", 2],
    ],
  },
];

export const TOPIC_ORDER = POLICY_TOPICS;

export const SEVERITY_ESCALATION: readonly Pattern[] = [
  ["state of emergency", 3], ["emergency session", 3], ["missile strike", 3],
  ["air strike", 3], ["airstrike", 3], ["military buildup", 3],
  ["mobilization", 3], ["ultimatum", 3], ["invasion", 3], ["blockade", 3],
  ["clash", 2], ["strike", 2], ["attack", 2], ["war", 2], ["crisis", 2],
  ["conflict", 2], ["violence", 2], ["unrest", 2], ["evacuation", 2],
  ["urgent", 2], ["breaking", 1],
];

export const SEVERITY_MAGNITUDE: readonly Pattern[] = [
  ["nationwide", 3], ["multi-state", 3], ["large-scale", 3],
  ["widespread", 3], ["regional", 2], ["global", 2], ["major", 2],
  ["billion", 2], ["millions", 2], ["thousands", 2], ["hundreds", 2],
  ["dozens", 1],
];

export const SEVERITY_DEESCALATION: readonly Pattern[] = [
  ["ceasefire agreement", 3], ["talks resume", 3], ["peace talks", 3],
  ["de-escalation", 3], ["agreement", 2], ["ceasefire", 2], ["truce", 2],
  ["dialogue", 2], ["negotiations", 2], ["restraint", 2],
  ["diplomatic solution", 2], ["calm", 1],
];

export const RELEVANCE_CORE: readonly string[] = [
  "policy", "politics", "political", "geopolitics", "geopolitical",
  "foreign affairs", "foreign ministry", "ministry", "government",
  "parliament", "president", "prime minister", "minister", "election",
  "diplomacy", "diplomatic", "bilateral", "summit", "talks", "treaty",
  "sanction", "sanctions", "security", "defense", "defence", "military",
  "border", "crisis", "conflict", "war", "ceasefire", "energy",
  "pipeline", "trade", "embargo", "united nations", "security council",
  "european union", "official statement", "spokesperson",
];

function normPatterns(patterns: readonly Pattern[]): NormPattern[] {
  return patterns
    .map(([term, weight]) => ({ term: normalizeText(term), weight }))
    .sort((a, b) => b.term.length - a.term.length);
}

export const NORM_TOPICS = TOPIC_PATTERNS.map((entry) => ({
  ...entry,
  norm: normPatterns(entry.patterns),
}));

export const NORM_ESCALATION = normPatterns(SEVERITY_ESCALATION);
export const NORM_MAGNITUDE = normPatterns(SEVERITY_MAGNITUDE);
export const NORM_DEESCALATION = normPatterns(SEVERITY_DEESCALATION);
export const NORM_RELEVANCE = RELEVANCE_CORE.map((term) => normalizeText(term)).sort(
  (a, b) => b.length - a.length,
);

export const SEVERITY_RANK: Record<PolicySeverity, number> = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};
