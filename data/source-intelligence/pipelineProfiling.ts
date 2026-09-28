import type { SourcePipelineProfile } from "./sourceIntelligenceTypes";

let eventEntityDetectionMs = 0;
let geoDecisionEngineMs = 0;
let cheapPrefilterRejectedCount = 0;
let fullContextProcessedCount = 0;
let geoProcessedCount = 0;

export function resetPipelineStageProfile(): void {
  eventEntityDetectionMs = 0;
  geoDecisionEngineMs = 0;
  cheapPrefilterRejectedCount = 0;
  fullContextProcessedCount = 0;
  geoProcessedCount = 0;
}

export function addEventEntityDetectionMs(ms: number): void {
  eventEntityDetectionMs += ms;
}

export function addGeoDecisionEngineMs(ms: number): void {
  geoDecisionEngineMs += ms;
}

export function incrementCheapPrefilterRejectedCount(): void {
  cheapPrefilterRejectedCount += 1;
}

export function incrementFullContextProcessedCount(): void {
  fullContextProcessedCount += 1;
}

export function incrementGeoProcessedCount(): void {
  geoProcessedCount += 1;
}

export function readPipelineStageProfile() {
  return {
    eventEntityDetectionMs,
    geoDecisionEngineMs,
    cheapPrefilterRejectedCount,
    fullContextProcessedCount,
    geoProcessedCount,
  };
}

export function logSourceIntelProfile(
  label: string,
  profile: Partial<SourcePipelineProfile> & Record<string, number | undefined>,
): void {
  const compact = Object.fromEntries(
    Object.entries(profile)
      .flatMap(([key, value]) =>
        typeof value === "number" ? [[key, Number(value.toFixed(1))]] : [],
      ),
  );
  console.info(`[source-intel:perf] ${label}`, compact);
}
