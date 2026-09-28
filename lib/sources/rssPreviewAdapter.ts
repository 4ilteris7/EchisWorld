import http from "http";
import https from "https";
import zlib from "zlib";
import type {
  NormalizedSourceItem,
  SourceDefinition,
} from "@/data/sources/sourceTypes";

// RSS feed adapter.
//
// This adapter fetches a source feed on demand, parses a bounded set of items,
// and returns NormalizedSourceItem objects for the shared live source pipeline.

/** Maximum items returned per RSS source in a single fetch. */
export const RSS_PREVIEW_ITEMS_PER_SOURCE = 150;
const MAX_PREVIEW_ITEMS = RSS_PREVIEW_ITEMS_PER_SOURCE;
const MAX_BLOCK_SCAN = 200;
const FETCH_TIMEOUT_MS = 8000;
const MAX_TITLE_LENGTH = 240;
const RSS_DIAGNOSTIC_BODY_CHARS = 500;
/** Upper bound on a feed response body; larger bodies abort the request. */
const MAX_FEED_BYTES = 3 * 1024 * 1024;

export type RssPreviewDiagnosticCategory =
  | "fetch_failed"
  | "non_xml_response"
  | "xml_parse_failed"
  | "rss_no_items_found"
  | "item_normalization_failed";

type FeedResponse = {
  body: string;
  status: number;
  finalUrl: string;
  contentType: string;
};

export class RssPreviewDiagnosticError extends Error {
  readonly diagnosticCategory: RssPreviewDiagnosticCategory;
  readonly status?: number;
  readonly finalUrl?: string;
  readonly contentType?: string;
  readonly bodyStart?: string;
  readonly bodyKind?: BodyKind;

  constructor(
    diagnosticCategory: RssPreviewDiagnosticCategory,
    message: string,
    meta: Partial<FeedResponse> & { bodyKind?: BodyKind } = {},
  ) {
    super(message);
    this.name = "RssPreviewDiagnosticError";
    this.diagnosticCategory = diagnosticCategory;
    this.status = meta.status;
    this.finalUrl = meta.finalUrl;
    this.contentType = meta.contentType;
    this.bodyStart = meta.body?.slice(0, RSS_DIAGNOSTIC_BODY_CHARS);
    this.bodyKind = meta.bodyKind;
  }
}

type BodyKind = "rss" | "atom" | "xml" | "html" | "empty" | "other";

const NON_NEWS_PATTERNS: readonly RegExp[] = [
  /abone\s*ol/,
  /subscribe/,
  /subscription/,
  /newsletter/,
  /bildirimleri\s*ac/,
  /telefonunuzda/,
  /whatsapp/,
  /uygulamamizi\s*indirin/,
  /podcast.*abone/,
  /haberleri\s*takip\s*etmek\s*icin/,
  /bizi\s*takip\s*edin/,
  /sosyal\s*medya/,
];

function isEditorialRssItem(title: string, summary: string): boolean {
  const normalised = (title + " " + summary)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0131/g, "i");

  for (const pattern of NON_NEWS_PATTERNS) {
    if (pattern.test(normalised)) return false;
  }
  return true;
}

function stripCdata(input: string): string {
  return input.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => {
      const n = Number(code);
      return Number.isFinite(n) ? String.fromCharCode(n) : "";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => {
      const n = Number.parseInt(code, 16);
      return Number.isFinite(n) ? String.fromCharCode(n) : "";
    })
    .replace(/&amp;/g, "&");
}

function stripHtml(input: string): string {
  return input.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function tagPattern(tag: string): string {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (tag.includes(":")) return escaped;
  return `(?:[\\w.-]+:)?${escaped}`;
}

function takeTag(block: string, tag: string): string {
  const re = new RegExp(
    `<${tagPattern(tag)}\\b[^>]*>([\\s\\S]*?)<\\/${tagPattern(tag)}>`,
    "i",
  );
  const match = block.match(re);
  if (!match) return "";
  return decodeHtmlEntities(stripCdata(match[1])).trim();
}

function takeFirstTag(block: string, tags: readonly string[]): string {
  for (const tag of tags) {
    const value = takeTag(block, tag);
    if (value) return value;
  }
  return "";
}

function takeAtomLink(block: string): string {
  const alternateLink = block.match(
    /<link\b(?=[^>]*\brel\s*=\s*["']alternate["'])[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*\/?>/i,
  );
  if (alternateLink) return decodeHtmlEntities(alternateLink[1]).trim();
  const hrefMatch = block.match(/<link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*\/?>/i);
  if (hrefMatch) return hrefMatch[1];
  return takeTag(block, "link");
}

function extractBlocks(xml: string, tag: string): string[] {
  const re = new RegExp(
    `<${tagPattern(tag)}\\b[^>]*>([\\s\\S]*?)<\\/${tagPattern(tag)}>`,
    "gi",
  );
  const blocks: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = re.exec(xml)) !== null) {
    blocks.push(match[1]);
    if (blocks.length >= MAX_BLOCK_SCAN) break;
  }

  return blocks;
}

function clamp(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, Math.max(0, max - 1)).trimEnd() + "...";
}

/** Accept only http(s) URLs from feed content; anything else is dropped. */
function safeHttpUrl(value: string): string | null {
  const trimmed = (value || "").trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  return trimmed;
}

function safeIsoDate(value: string): string {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toISOString();
}

/**
 * Decode a feed response body by its Content-Encoding. Unknown or empty
 * encodings are treated as identity (plain UTF-8). Throws on malformed
 * compressed payloads so the caller can surface a fetch diagnostic.
 */
function decodeFeedBody(raw: Buffer, encoding: string): string {
  switch (encoding) {
    case "gzip":
      return zlib.gunzipSync(raw).toString("utf8");
    case "deflate":
      return zlib.inflateSync(raw).toString("utf8");
    case "br":
      return zlib.brotliDecompressSync(raw).toString("utf8");
    default:
      return raw.toString("utf8");
  }
}

/**
 * Fetch a feed URL using Node.js native http/https modules.
 * The undici-backed global fetch used by Next.js has a TLS fingerprint that
 * some CDN WAFs (e.g. HDX/ReliefWeb) flag as bot traffic. Native modules
 * use a different fingerprint and pass through without issues.
 * Follows up to 5 redirects automatically.
 */
function fetchFeed(feedUrl: string): Promise<FeedResponse> {
  return new Promise((resolve, reject) => {
    const makeRequest = (url: string, hops = 0): void => {
      if (hops > 5) {
        reject(new Error("upstream_too_many_redirects"));
        return;
      }

      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        reject(new Error("upstream_invalid_url"));
        return;
      }

      const lib = parsed.protocol === "https:" ? https : http;
      const port = parsed.port
        ? Number(parsed.port)
        : parsed.protocol === "https:"
          ? 443
          : 80;

      const req = lib.request(
        {
          hostname: parsed.hostname,
          port,
          path: parsed.pathname + parsed.search,
          method: "GET",
          headers: {
            "User-Agent": "EchisWorld/1.0",
            Accept:
              "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5",
            "Accept-Encoding": "gzip, deflate, br",
          },
        },
        (res) => {
          const { statusCode, headers: resHeaders } = res;

          // Follow redirects
          if (
            (statusCode === 301 ||
              statusCode === 302 ||
              statusCode === 307 ||
              statusCode === 308) &&
            resHeaders.location
          ) {
            res.destroy();
            const next = new URL(resHeaders.location, url).href;
            makeRequest(next, hops + 1);
            return;
          }

          const chunks: Buffer[] = [];
          let receivedBytes = 0;
          res.on("data", (chunk: Buffer) => {
            receivedBytes += chunk.length;
            if (receivedBytes > MAX_FEED_BYTES) {
              res.destroy();
              reject(new Error("upstream_body_too_large"));
              return;
            }
            chunks.push(chunk);
          });
          res.on("end", () => {
            // Some feed servers (e.g. UN News) return a compressed body even
            // without an Accept-Encoding request; Node's http module never
            // decompresses, so decode by the declared Content-Encoding here.
            const encoding = String(resHeaders["content-encoding"] ?? "")
              .trim()
              .toLowerCase();
            let body: string;
            try {
              body = decodeFeedBody(Buffer.concat(chunks), encoding);
            } catch {
              reject(new Error("upstream_decode_failed"));
              return;
            }
            resolve({
              body,
              status: statusCode ?? 0,
              finalUrl: url,
              contentType: String(resHeaders["content-type"] ?? ""),
            });
          });
          res.on("error", reject);
        },
      );

      req.setTimeout(FETCH_TIMEOUT_MS, () => {
        req.destroy(new Error("AbortError"));
      });

      req.on("error", (err: NodeJS.ErrnoException) => {
        if (err.message === "AbortError") {
          const abort = new Error("Feed request timed out");
          abort.name = "AbortError";
          reject(abort);
        } else {
          reject(err);
        }
      });

      req.end();
    };

    makeRequest(feedUrl);
  });
}

function detectAtom(xml: string): boolean {
  if (/<feed\b[^>]*xmlns\s*=\s*"http:\/\/www\.w3\.org\/2005\/Atom"/i.test(xml)) {
    return true;
  }
  return /<(?:[\w.-]+:)?entry\b/i.test(xml) && !/<(?:[\w.-]+:)?item\b/i.test(xml);
}

function detectBodyKind(body: string): BodyKind {
  const text = body.replace(/^\uFEFF/, "").trimStart();
  if (!text) return "empty";
  if (/^(?:<!doctype\s+html\b|<html\b)/i.test(text)) return "html";
  if (/<(?:[\w.-]+:)?rss\b/i.test(text) || /<(?:[\w.-]+:)?rdf\b/i.test(text)) {
    return "rss";
  }
  if (/<(?:[\w.-]+:)?feed\b/i.test(text)) return "atom";
  if (/^<\?xml\b/i.test(text) || /^</.test(text)) return "xml";
  return "other";
}

function isLikelyXmlContentType(contentType: string): boolean {
  return /\b(?:xml|rss|atom)\b/i.test(contentType);
}

function isDevelopment(): boolean {
  return process.env.NODE_ENV === "development";
}

function logRssDiagnostic(
  source: SourceDefinition,
  response: Partial<FeedResponse>,
  diagnosticCategory: RssPreviewDiagnosticCategory,
  bodyKind: BodyKind,
  extra?: Record<string, unknown>,
): void {
  if (!isDevelopment()) return;
  const body = response.body ?? "";
  console.warn("[rss-preview]", {
    sourceId: source.id,
    sourceName: source.name,
    feedUrl: source.candidateFeedUrl,
    status: response.status ?? null,
    finalUrl: response.finalUrl ?? null,
    contentType: response.contentType ?? null,
    bodyStart: body.slice(0, RSS_DIAGNOSTIC_BODY_CHARS),
    bodyKind,
    startsWithXmlRssAtom: bodyKind === "xml" || bodyKind === "rss" || bodyKind === "atom",
    startsWithHtml: bodyKind === "html",
    diagnosticCategory,
    ...extra,
  });
}

function makeRssError(
  source: SourceDefinition,
  response: Partial<FeedResponse>,
  diagnosticCategory: RssPreviewDiagnosticCategory,
  bodyKind: BodyKind,
  message: string = diagnosticCategory,
  extra?: Record<string, unknown>,
): RssPreviewDiagnosticError {
  logRssDiagnostic(source, response, diagnosticCategory, bodyKind, extra);
  return new RssPreviewDiagnosticError(diagnosticCategory, message, {
    ...response,
    bodyKind,
  });
}

export function parseRssPreviewItemsFromXml(
  source: SourceDefinition,
  xml: string,
  collectedAt = new Date().toISOString(),
): NormalizedSourceItem[] {
  const bodyKind = detectBodyKind(xml);
  const isAtom = bodyKind === "atom" || detectAtom(xml);
  const hasFeedRoot =
    isAtom ||
    /<(?:[\w.-]+:)?rss\b/i.test(xml) ||
    /<(?:[\w.-]+:)?rdf\b/i.test(xml);
  if (!hasFeedRoot) {
    throw makeRssError(
      source,
      { body: xml },
      "xml_parse_failed",
      bodyKind,
      "rss_root_not_found",
    );
  }

  const blocks = isAtom
    ? extractBlocks(xml, "entry")
    : extractBlocks(xml, "item");

  if (blocks.length === 0) {
    throw makeRssError(
      source,
      { body: xml },
      "rss_no_items_found",
      bodyKind,
      "rss_no_items_found",
    );
  }

  const items: NormalizedSourceItem[] = [];
  let malformedCount = 0;

  for (let index = 0; index < blocks.length && items.length < MAX_PREVIEW_ITEMS; index++) {
    const block = blocks[index];

    try {
      const titleRaw = takeFirstTag(block, ["title"]);
      const titleText = stripHtml(titleRaw);
      if (!titleText) {
        malformedCount += 1;
        continue;
      }
      const title = clamp(titleText, MAX_TITLE_LENGTH);

      const linkRaw = isAtom
        ? takeAtomLink(block)
        : takeFirstTag(block, ["link"]);
      const url = safeHttpUrl(linkRaw) ?? source.baseUrl;

      const summaryRaw = takeFirstTag(block, [
        "description",
        "summary",
        "content:encoded",
        "encoded",
        "content",
      ]);
      const summary = stripHtml(summaryRaw);

      if (
        !source.targetScreens.includes("cyber_news") &&
        !isEditorialRssItem(title, summary)
      ) {
        continue;
      }

      const dateRaw = takeFirstTag(block, [
        "pubDate",
        "published",
        "updated",
        "dc:date",
        "date",
      ]);
      const publishedAt = safeIsoDate(dateRaw);

      let identifier = takeFirstTag(block, ["guid", "id"]);
      if (!identifier) identifier = url && url !== source.baseUrl ? url : "";
      const id =
        identifier && identifier.length > 0
          ? `${source.id}::${identifier}`
          : `${source.id}::${index}::${publishedAt || collectedAt}`;

      items.push({
        id,
        sourceId: source.id,
        sourceName: source.name,
        title,
        summary,
        url,
        publishedAt,
        collectedAt,
        sourceType: "rss",
        sourceStatus: source.sourceStatus,
        verificationStatus: source.sourceProfile === "official_diplomatic"
          ? "official_entry"
          : "source_reported",
        sourceBasis: source.sourceProfile === "official_diplomatic"
          ? "single_official_source"
          : "single_public_source",
        extractionMethod: "rss_summary",
        sourceLanguage: source.language,
        relatedCountries: [],
        relatedRegions: [source.regionScope],
        category: source.category,
        isSample: false,
        sourceProfile: source.sourceProfile,
        markerLocationStrategy: source.markerLocationStrategy,
        sourceLocationForMarker: source.sourceLocation
          ? {
              lat: source.sourceLocation.lat,
              lng: source.sourceLocation.lng,
              locationName: source.sourceLocation.label,
            }
          : undefined,
      });
    } catch {
      malformedCount += 1;
    }
  }

  if (items.length === 0) {
    throw makeRssError(
      source,
      { body: xml },
      malformedCount > 0 ? "item_normalization_failed" : "rss_no_items_found",
      bodyKind,
      malformedCount > 0 ? "item_normalization_failed" : "rss_no_items_found",
      { blockCount: blocks.length, malformedCount },
    );
  }

  if (malformedCount > 0 && isDevelopment()) {
    console.warn("[rss-preview] skipped malformed RSS items", {
      sourceId: source.id,
      sourceName: source.name,
      feedUrl: source.candidateFeedUrl,
      malformedCount,
      parsedCount: items.length,
    });
  }

  return items;
}

export async function fetchRssPreview(
  source: SourceDefinition,
): Promise<NormalizedSourceItem[]> {
  if (!source.candidateFeedUrl) {
    throw new Error("missing_feed_url");
  }

  let response: FeedResponse;
  try {
    response = await fetchFeed(source.candidateFeedUrl);
  } catch (error) {
    const message = error instanceof Error ? error.message : "fetch_failed";
    throw makeRssError(
      source,
      { finalUrl: source.candidateFeedUrl },
      "fetch_failed",
      "other",
      message,
    );
  }

  const bodyKind = detectBodyKind(response.body);
  if (response.status < 200 || response.status >= 300) {
    throw makeRssError(
      source,
      response,
      "fetch_failed",
      bodyKind,
      `upstream_${response.status}`,
    );
  }

  if (
    bodyKind === "html" ||
    bodyKind === "empty" ||
    bodyKind === "other" ||
    (bodyKind === "xml" && !isLikelyXmlContentType(response.contentType))
  ) {
    throw makeRssError(
      source,
      response,
      "non_xml_response",
      bodyKind,
      "non_xml_response",
    );
  }

  try {
    return parseRssPreviewItemsFromXml(
      source,
      response.body,
      new Date().toISOString(),
    );
  } catch (error) {
    if (error instanceof RssPreviewDiagnosticError) {
      logRssDiagnostic(
        source,
        response,
        error.diagnosticCategory,
        error.bodyKind ?? bodyKind,
      );
    }
    throw error;
  }
}
