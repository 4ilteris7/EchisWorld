import type { SourceFilterDomain } from "../sourceIntelligenceTypes";

export const FILTER_ACCEPTANCE_THRESHOLD = 25;
export const STRONG_MARKER_THRESHOLD = 70;

export const domainTags: Record<SourceFilterDomain, string> = {
  diplomacy: "Diplomacy",
  official_statement: "Official Statement",
  conflict: "Conflict",
  peace_process: "Peace Process",
  crisis: "Crisis",
  sanctions_law: "Sanctions / Law",
  border_territory: "Border / Territory",
  humanitarian: "Humanitarian",
  instability: "Instability",
  international_org: "International Org",
};

export const strongTriggerGroups = new Set([
  "diplomacy.hard",
  "officialStatement.hard",
  "conflict.hard",
  "peaceProcess.hard",
  "sanctionsLaw.hard",
  "borderTerritory.hard",
  "crisisHumanitarian.hard",
  "internationalOrganizations",
]);

export function scoreGroup(groupName: string): number {
  if (groupName.endsWith(".hard")) return 25;
  if (groupName.endsWith(".institutions") || groupName.endsWith(".actors")) return 10;
  if (groupName.endsWith(".geography")) return 12;
  if (groupName === "internationalOrganizations") return 12;
  if (groupName === "geopoliticalRegions") return 8;
  return 8;
}
