import type { Pool } from "pg";
import { candidateSourceDefinitions } from "@/data/sources/sourceDefinitions";
import { getSourceDefinition } from "@/data/source-intelligence/sourceRegistry";
import type { SourceDefinition as LegacySourceDefinition, SourceTargetScreen } from "@/data/sources/sourceTypes";
import type { SourceDefinition as IntelSourceDefinition } from "@/data/source-intelligence/sourceIntelligenceTypes";
import {
  CANONICAL_SOURCE_MANIFEST,
  type CanonicalSourceManifestEntry,
} from "@/lib/backend/sources/manifest";
import {
  listPersonalSources,
  personalSourceToIntelDefinition,
  personalSourceToLegacyDefinition,
  personalSourceToManifestEntry,
  type PersonalSource,
} from "@/lib/backend/sources/personalSources";

export type EffectiveSourceCatalog = {
  personalSources: PersonalSource[];
  entries: CanonicalSourceManifestEntry[];
  entryById: Map<string, CanonicalSourceManifestEntry>;
  legacyById: Map<string, LegacySourceDefinition>;
  intelById: Map<string, IntelSourceDefinition>;
  sourceIdsForScreen: (screen: SourceTargetScreen) => string[];
  sourceNameById: Map<string, string>;
};

export async function loadEffectiveSourceCatalog(
  pool: Pool,
): Promise<EffectiveSourceCatalog> {
  const personalSources = await listPersonalSources(pool);
  const livePersonal = personalSources.filter((source) => source.enabled);
  const entries = [
    ...CANONICAL_SOURCE_MANIFEST,
    ...livePersonal.map(personalSourceToManifestEntry),
  ];
  const legacyById = new Map<string, LegacySourceDefinition>(
    candidateSourceDefinitions.map((source) => [source.id, source]),
  );
  const intelById = new Map<string, IntelSourceDefinition>();
  for (const entry of CANONICAL_SOURCE_MANIFEST) {
    const definition = getSourceDefinition(entry.sourceId);
    if (definition) intelById.set(entry.sourceId, definition);
  }
  for (const source of livePersonal) {
    legacyById.set(source.sourceId, personalSourceToLegacyDefinition(source));
    intelById.set(source.sourceId, personalSourceToIntelDefinition(source));
  }
  return {
    personalSources,
    entries,
    entryById: new Map(entries.map((entry) => [entry.sourceId, entry])),
    legacyById,
    intelById,
    sourceIdsForScreen: (screen) => entries
      .filter((entry) => entry.targetScreens.includes(screen))
      .map((entry) => entry.sourceId),
    sourceNameById: new Map(entries.map((entry) => [entry.sourceId, entry.name])),
  };
}

