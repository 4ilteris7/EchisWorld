import { getPool } from "@/lib/backend/db/pool";
import { extractReadableArticle, type ExtractedArticle } from "@/lib/backend/content/extractArticle";
import { rateLimit } from "@/lib/backend/http/rateLimit";
import { safeFetch } from "@/lib/backend/collector/safeFetch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_MAX_ENTRIES = 100;
const MAX_URL_LENGTH = 2_048;
const articleCache = new Map<string, { expiresAt: number; article: ExtractedArticle }>();

function normalizedArticleUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > MAX_URL_LENGTH) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password) return null;
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

function readCachedArticle(url: string): ExtractedArticle | null {
  const cached = articleCache.get(url);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    articleCache.delete(url);
    return null;
  }
  return cached.article;
}

function cacheArticle(url: string, article: ExtractedArticle): void {
  if (articleCache.size >= CACHE_MAX_ENTRIES) {
    const oldestKey = articleCache.keys().next().value as string | undefined;
    if (oldestKey) articleCache.delete(oldestKey);
  }
  articleCache.set(url, { expiresAt: Date.now() + CACHE_TTL_MS, article });
}

async function isCollectedReportUrl(url: string, originalUrl: string): Promise<boolean> {
  const result = await getPool("web").query(
    `SELECT 1
       FROM collected_items
      WHERE url = $1 OR canonical_url = $1 OR url = $2 OR canonical_url = $2
      LIMIT 1`,
    [url, originalUrl],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function POST(request: Request): Promise<Response> {
  const limited = rateLimit(request, {
    bucket: "report-content",
    limit: 20,
    windowMs: 60_000,
  });
  if (limited) return limited;
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > 4_096) {
    return Response.json({ error: "request_too_large" }, { status: 413 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: "invalid_request" }, { status: 400 });
  }
  const rawUrl = payload && typeof payload === "object" && "url" in payload
    ? (payload as { url?: unknown }).url
    : null;
  const url = normalizedArticleUrl(rawUrl);
  if (!url) {
    return Response.json({ error: "invalid_url" }, { status: 400 });
  }
  const originalUrl = typeof rawUrl === "string" ? rawUrl.trim() : url;

  const cached = readCachedArticle(url);
  if (cached) {
    return Response.json(
      { article: cached, cached: true },
      { headers: { "Cache-Control": "private, max-age=300" } },
    );
  }

  try {
    if (!(await isCollectedReportUrl(url, originalUrl))) {
      return Response.json({ error: "unknown_report_url" }, { status: 404 });
    }
  } catch {
    return Response.json(
      { error: "storage_unreachable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const result = await safeFetch(url, {
      timeoutMs: 10_000,
      maxBodyBytes: 4 * 1024 * 1024,
      maxRedirects: 5,
      accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
    });
    const contentType = result.contentType?.toLocaleLowerCase() ?? "";
    if (
      result.status < 200 ||
      result.status >= 300 ||
      !result.body ||
      (contentType && !contentType.includes("text/html") && !contentType.includes("application/xhtml+xml"))
    ) {
      return Response.json({ error: "source_content_unavailable" }, { status: 422 });
    }

    const article = extractReadableArticle(result.body, result.finalUrl);
    if (!article) {
      return Response.json({ error: "article_text_unavailable" }, { status: 422 });
    }
    cacheArticle(url, article);
    return Response.json(
      { article, cached: false },
      { headers: { "Cache-Control": "private, max-age=300" } },
    );
  } catch {
    return Response.json(
      { error: "source_fetch_failed" },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
