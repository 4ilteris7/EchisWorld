import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type {
  SourceDefinition as LegacySourceDefinition,
  SourceLanguage,
  SourceRegionScope,
  SourceTargetScreen,
} from "@/data/sources/sourceTypes";
import type { SourceDefinition as IntelSourceDefinition } from "@/data/source-intelligence/sourceIntelligenceTypes";
import type { CanonicalSourceManifestEntry } from "@/lib/backend/sources/manifest";

export type PersonalConnectorType = "rss" | "json";
export type PersonalSourceCategory = "global" | "cyber" | "defense" | "policy";

export type PersonalSource = {
  sourceId: string;
  name: string;
  connectorType: PersonalConnectorType;
  endpoint: string;
  category: PersonalSourceCategory;
  language: SourceLanguage;
  regionScope: SourceRegionScope;
  enabled: boolean;
  lastValidatedAt: string;
  validationItemCount: number;
  lastValidationError?: string;
  createdAt: string;
  updatedAt: string;
};

export type CreatePersonalSourceInput = Omit<
  PersonalSource,
  "sourceId" | "enabled" | "lastValidatedAt" | "validationItemCount" | "lastValidationError" | "createdAt" | "updatedAt"
> & { validationItemCount: number };

type PersonalSourceRow = {
  source_id: string;
  name: string;
  connector_type: PersonalConnectorType;
  endpoint: string;
  category: PersonalSourceCategory;
  language: SourceLanguage;
  region_scope: SourceRegionScope;
  enabled: boolean;
  last_validated_at: Date;
  validation_item_count: number;
  last_validation_error: string | null;
  created_at: Date;
  updated_at: Date;
};

function fromRow(row: PersonalSourceRow): PersonalSource {
  return {
    sourceId: row.source_id,
    name: row.name,
    connectorType: row.connector_type,
    endpoint: row.endpoint,
    category: row.category,
    language: row.language,
    regionScope: row.region_scope,
    enabled: row.enabled,
    lastValidatedAt: row.last_validated_at.toISOString(),
    validationItemCount: row.validation_item_count,
    lastValidationError: row.last_validation_error ?? undefined,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

const SELECT_COLUMNS = `source_id, name, connector_type, endpoint, category,
  language, region_scope, enabled, last_validated_at, validation_item_count,
  last_validation_error, created_at, updated_at`;

export async function listPersonalSources(pool: Pool): Promise<PersonalSource[]> {
  const { rows } = await pool.query<PersonalSourceRow>(
    `SELECT ${SELECT_COLUMNS} FROM personal_sources
      WHERE deleted_at IS NULL ORDER BY created_at DESC`,
  );
  return rows.map(fromRow);
}

export async function createPersonalSource(
  pool: Pool,
  input: CreatePersonalSourceInput,
): Promise<PersonalSource> {
  const sourceId = `personal-${randomUUID()}`;
  const { rows } = await pool.query<PersonalSourceRow>(
    `INSERT INTO personal_sources
       (source_id, name, connector_type, endpoint, category, language,
        region_scope, validation_item_count)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING ${SELECT_COLUMNS}`,
    [sourceId, input.name, input.connectorType, input.endpoint, input.category,
      input.language, input.regionScope, input.validationItemCount],
  );
  return fromRow(rows[0]);
}

export async function setPersonalSourceEnabled(
  pool: Pool,
  sourceId: string,
  enabled: boolean,
): Promise<PersonalSource | null> {
  const { rows } = await pool.query<PersonalSourceRow>(
    `UPDATE personal_sources SET enabled = $2, updated_at = now()
      WHERE source_id = $1 AND deleted_at IS NULL
      RETURNING ${SELECT_COLUMNS}`,
    [sourceId, enabled],
  );
  return rows[0] ? fromRow(rows[0]) : null;
}

export async function deletePersonalSource(
  pool: Pool,
  sourceId: string,
): Promise<boolean> {
  const result = await pool.query(
    `UPDATE personal_sources
        SET enabled = false, deleted_at = now(), updated_at = now()
      WHERE source_id = $1 AND deleted_at IS NULL`,
    [sourceId],
  );
  return (result.rowCount ?? 0) > 0;
}

export function targetScreensForPersonalSource(
  category: PersonalSourceCategory,
): SourceTargetScreen[] {
  if (category === "cyber") return ["monitor", "cyber_news"];
  if (category === "defense") return ["monitor", "defense_industry"];
  if (category === "policy") return ["monitor", "policy"];
  return ["monitor"];
}

function categoryLabel(category: PersonalSourceCategory): string {
  return {
    global: "Global Events",
    cyber: "Cyber",
    defense: "Defense Industry",
    policy: "Policy",
  }[category];
}

export function personalSourceToLegacyDefinition(
  source: PersonalSource,
): LegacySourceDefinition {
  return {
    id: source.sourceId,
    name: source.name,
    category: categoryLabel(source.category),
    accessType: source.connectorType === "rss" ? "rss" : "api",
    candidateStatus: "candidate_test",
    sourceStatus: "public_news_source",
    verificationStatus: "source_reported",
    sourceBasis: "single_public_source",
    extractionMethod: source.connectorType === "rss" ? "rss_feed" : "api_result",
    baseUrl: new URL(source.endpoint).origin,
    candidateFeedUrl: source.connectorType === "rss" ? source.endpoint : undefined,
    language: source.language,
    regionScope: source.regionScope,
    targetScreens: targetScreensForPersonalSource(source.category),
    sourceProfile: "general_news",
    markerLocationStrategy: "item_location",
    notes: "Installation-local public source.",
  };
}

export function personalSourceToIntelDefinition(
  source: PersonalSource,
): IntelSourceDefinition {
  return {
    id: source.sourceId,
    name: source.name,
    sourceType: "global_news",
    collectionMethod: source.connectorType === "rss" ? "rss" : "api",
    language: source.language,
    endpoint: source.endpoint,
    feedUrl: source.connectorType === "rss" ? source.endpoint : undefined,
    sourceStatus: source.enabled ? "active" : "disabled",
    markerLocationStrategy: "item_location",
    legacyCategory: categoryLabel(source.category),
    legacyRegionScope: source.regionScope,
    origin: "personal",
  };
}

export function personalSourceToManifestEntry(
  source: PersonalSource,
): CanonicalSourceManifestEntry {
  return {
    sourceId: source.sourceId,
    name: source.name,
    collectionMethod: source.connectorType === "rss" ? "rss" : "api",
    endpoint: source.endpoint,
    targetScreens: targetScreensForPersonalSource(source.category),
    language: source.language,
    regionScope: source.regionScope,
    sourceProfile: "general_news",
    critical: false,
    schedule: {
      scheduleMode: "adaptive",
      cadenceClass: source.connectorType === "rss" ? "normal_news" : "quota_api",
      minPollIntervalSeconds: 10 * 60,
      basePollIntervalSeconds: 15 * 60,
      maxPollIntervalSeconds: 60 * 60,
    },
    limits: { timeoutMs: 12_000, maxBodyBytes: 2 * 1024 * 1024, maxItems: 100 },
  };
}

