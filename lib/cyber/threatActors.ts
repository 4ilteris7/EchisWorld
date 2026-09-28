// ---------------------------------------------------------------------------
// Threat-actor lexicon.
//
// Maps named threat actors to their public attribution. Used to:
//   • produce an ORIGIN region for nation-state groups, even when the article
//     never writes the nationality adjective ("Volt Typhoon breached …" still
//     implies a China-origin signal);
//   • surface the actor on the per-item annotation (threat-context reuse).
//
// PRECISION POLICY (the user's hard requirement — no false attributions):
//   • Only `nation_state` actors with broad, well-established public
//     attribution carry an `attributedCountry`. They are the only actors that
//     add an ORIGIN region.
//   • `cybercrime` and `hacktivist` actors carry NO country. Ransomware brands
//     (LockBit, ALPHV, Cl0p, …) appear overwhelmingly in victim-focused
//     stories; tagging them to a country would pollute the origin signal.
//   • Vendor "weather" taxonomies (Microsoft Typhoon/Sandstorm/Blizzard,
//     CrowdStrike Panda/Bear/Kitten/Chollima) are included as aliases so the
//     same actor resolves regardless of which naming a feed uses.
// ---------------------------------------------------------------------------

import { normalizeText } from "./normalize";

export type ActorKind = "nation_state" | "cybercrime" | "hacktivist";

export interface ThreatActorEntry {
  canonical: string;
  kind: ActorKind;
  /** Canonical country name (must exist in geoLexicon) — nation_state only. */
  attributedCountry?: string;
  aliases: readonly string[];
}

export const THREAT_ACTORS: readonly ThreatActorEntry[] = [
  // ── China-attributed ─────────────────────────────────────────────────────
  { canonical: "Volt Typhoon", kind: "nation_state", attributedCountry: "China", aliases: ["volt typhoon", "vanguard panda", "bronze silhouette"] },
  { canonical: "Salt Typhoon", kind: "nation_state", attributedCountry: "China", aliases: ["salt typhoon", "ghostemperor", "famoussparrow"] },
  { canonical: "Flax Typhoon", kind: "nation_state", attributedCountry: "China", aliases: ["flax typhoon", "ethereal panda"] },
  { canonical: "Silk Typhoon", kind: "nation_state", attributedCountry: "China", aliases: ["silk typhoon", "hafnium"] },
  { canonical: "APT41", kind: "nation_state", attributedCountry: "China", aliases: ["apt41", "winnti", "barium", "wicked panda", "brass typhoon", "double dragon"] },
  { canonical: "APT40", kind: "nation_state", attributedCountry: "China", aliases: ["apt40", "leviathan", "mulberry typhoon", "kryptonite panda", "gingham typhoon"] },
  { canonical: "APT10", kind: "nation_state", attributedCountry: "China", aliases: ["apt10", "stone panda", "menupass", "potassium", "purpleurchin"] },
  { canonical: "Mustang Panda", kind: "nation_state", attributedCountry: "China", aliases: ["mustang panda", "earth preta", "bronze president", "stately taurus", "twill typhoon"] },
  { canonical: "GALLIUM", kind: "nation_state", attributedCountry: "China", aliases: ["gallium", "granite typhoon", "softcell"] },
  { canonical: "Storm-0558", kind: "nation_state", attributedCountry: "China", aliases: ["storm-0558"] },

  // ── Russia-attributed ────────────────────────────────────────────────────
  { canonical: "APT28", kind: "nation_state", attributedCountry: "Russia", aliases: ["apt28", "fancy bear", "sofacy", "forest blizzard", "sednit", "strontium", "pawn storm"] },
  { canonical: "APT29", kind: "nation_state", attributedCountry: "Russia", aliases: ["apt29", "cozy bear", "midnight blizzard", "nobelium", "cloaked ursa", "the dukes", "bluebravo"] },
  { canonical: "Sandworm", kind: "nation_state", attributedCountry: "Russia", aliases: ["sandworm", "voodoo bear", "seashell blizzard", "telebots", "iridium", "blackenergy"] },
  { canonical: "Turla", kind: "nation_state", attributedCountry: "Russia", aliases: ["turla", "snake malware", "venomous bear", "secret blizzard", "waterbug", "uroburos"] },
  { canonical: "Gamaredon", kind: "nation_state", attributedCountry: "Russia", aliases: ["gamaredon", "primitive bear", "aqua blizzard", "armageddon", "shuckworm"] },
  { canonical: "Star Blizzard", kind: "nation_state", attributedCountry: "Russia", aliases: ["star blizzard", "cold river", "callisto", "seaborgium"] },

  // ── North Korea-attributed ───────────────────────────────────────────────
  { canonical: "Lazarus Group", kind: "nation_state", attributedCountry: "North Korea", aliases: ["lazarus group", "lazarus", "hidden cobra", "diamond sleet", "zinc", "labyrinth chollima"] },
  { canonical: "BlueNoroff", kind: "nation_state", attributedCountry: "North Korea", aliases: ["bluenoroff", "apt38", "stardust chollima", "sapphire sleet", "ta444"] },
  { canonical: "Kimsuky", kind: "nation_state", attributedCountry: "North Korea", aliases: ["kimsuky", "apt43", "velvet chollima", "emerald sleet", "thallium", "black banshee"] },
  { canonical: "Andariel", kind: "nation_state", attributedCountry: "North Korea", aliases: ["andariel", "onyx sleet", "silent chollima", "plutonium"] },
  { canonical: "ScarCruft", kind: "nation_state", attributedCountry: "North Korea", aliases: ["scarcruft", "apt37", "ricochet chollima", "reaper group", "inkysquid"] },

  // ── Iran-attributed ──────────────────────────────────────────────────────
  { canonical: "APT33", kind: "nation_state", attributedCountry: "Iran", aliases: ["apt33", "elfin", "refined kitten", "peach sandstorm", "holmium"] },
  { canonical: "APT34", kind: "nation_state", attributedCountry: "Iran", aliases: ["apt34", "oilrig", "helix kitten", "hazel sandstorm", "cobalt gypsy"] },
  { canonical: "APT35", kind: "nation_state", attributedCountry: "Iran", aliases: ["apt35", "charming kitten", "phosphorus", "mint sandstorm", "magic hound", "newscaster"] },
  { canonical: "MuddyWater", kind: "nation_state", attributedCountry: "Iran", aliases: ["muddywater", "static kitten", "mango sandstorm", "mercury", "seedworm"] },
  { canonical: "Pioneer Kitten", kind: "nation_state", attributedCountry: "Iran", aliases: ["pioneer kitten", "fox kitten", "lemon sandstorm", "parisite", "unc757"] },

  // ── Other nation-state ───────────────────────────────────────────────────
  { canonical: "APT32", kind: "nation_state", attributedCountry: "Vietnam", aliases: ["apt32", "oceanlotus", "ocean lotus", "canvas cyclone", "sealotus"] },
  { canonical: "Transparent Tribe", kind: "nation_state", attributedCountry: "Pakistan", aliases: ["transparent tribe", "apt36", "mythic leopard", "earth karkaddan"] },
  { canonical: "SideWinder", kind: "nation_state", attributedCountry: "India", aliases: ["sidewinder", "rattlesnake", "razor tiger"] },
  { canonical: "Patchwork", kind: "nation_state", attributedCountry: "India", aliases: ["patchwork", "dropping elephant", "hangover group"] },

  // ── Cybercrime (NO country — kept for actor annotation only) ──────────────
  { canonical: "LockBit", kind: "cybercrime", aliases: ["lockbit"] },
  { canonical: "ALPHV/BlackCat", kind: "cybercrime", aliases: ["alphv", "blackcat", "black cat ransomware"] },
  { canonical: "Cl0p", kind: "cybercrime", aliases: ["cl0p", "clop ransomware", "ta505"] },
  { canonical: "Black Basta", kind: "cybercrime", aliases: ["black basta", "blackbasta"] },
  { canonical: "Play", kind: "cybercrime", aliases: ["play ransomware", "playcrypt"] },
  { canonical: "Akira", kind: "cybercrime", aliases: ["akira ransomware"] },
  { canonical: "RansomHub", kind: "cybercrime", aliases: ["ransomhub"] },
  { canonical: "Qilin", kind: "cybercrime", aliases: ["qilin", "agenda ransomware"] },
  { canonical: "Medusa", kind: "cybercrime", aliases: ["medusa ransomware"] },
  { canonical: "Rhysida", kind: "cybercrime", aliases: ["rhysida"] },
  { canonical: "Scattered Spider", kind: "cybercrime", aliases: ["scattered spider", "octo tempest", "unc3944", "muddled libra"] },
  { canonical: "Conti", kind: "cybercrime", aliases: ["conti ransomware", "wizard spider"] },
  { canonical: "REvil", kind: "cybercrime", aliases: ["revil", "sodinokibi"] },
  { canonical: "Lapsus$", kind: "cybercrime", aliases: ["lapsus$", "lapsus"] },

  // ── Hacktivist (NO country) ──────────────────────────────────────────────
  { canonical: "KillNet", kind: "hacktivist", aliases: ["killnet"] },
  { canonical: "Anonymous Sudan", kind: "hacktivist", aliases: ["anonymous sudan"] },
  { canonical: "Predatory Sparrow", kind: "hacktivist", aliases: ["predatory sparrow", "gonjeshke darande"] },
] as const;

export interface NormalizedActor extends ThreatActorEntry {
  normAliases: readonly string[];
}

export const NORMALIZED_ACTORS: readonly NormalizedActor[] = THREAT_ACTORS.map((a) => ({
  ...a,
  // Longest aliases first so multi-word names win over substrings.
  normAliases: a.aliases.map((x) => normalizeText(x)).sort((x, y) => y.length - x.length),
}));
