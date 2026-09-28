// API-source bridge (F5): maps quota-limited API sources to their existing
// server adapters (lib/sources/*Adapter.ts) so the worker collects them
// directly — the browser and the public Next routes are no longer part of
// the collection path.
//
// Keys come from process.env (worker starts with --env-file-if-exists=
// .env.local locally; real env on the VPS). Keys never reach logs or payloads.

import type {
  NormalizedSourceItem as LegacyScreenItem,
  SourceDefinition as LegacyScreenSourceDefinition,
} from "@/data/sources/sourceTypes";
import { fetchCurrentsArticles } from "@/lib/sources/currentsAdapter";
import { fetchFinlightArticles } from "@/lib/sources/finlightAdapter";
import { fetchFreeNewsArticles } from "@/lib/sources/freenewsAdapter";
import { fetchGdeltArticles } from "@/lib/sources/gdeltAdapter";
import { fetchNewsdataArticles } from "@/lib/sources/newsdataAdapter";
import { fetchWorldNewsArticles } from "@/lib/sources/worldnewsAdapter";

export type ApiSourceFetcher = (
  source: LegacyScreenSourceDefinition,
) => Promise<LegacyScreenItem[]>;

/** sourceId → adapter. RSS sources (incl. reliefweb-crises) use safeFetch. */
export const API_SOURCE_FETCHERS: Record<string, ApiSourceFetcher> = {
  "currents-geopolitical": (source) => fetchCurrentsArticles(source),
  "newsdata-geopolitical": (source) => fetchNewsdataArticles(source),
  "worldnews-geopolitical": (source) => fetchWorldNewsArticles(source),
  "freenews-geopolitical": (source) => fetchFreeNewsArticles(source),
  "finlight-geopolitical": (source) => fetchFinlightArticles(source),
  "gdelt-geopolitical": (source) => fetchGdeltArticles(source, "24h"),
};
