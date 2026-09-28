// Hardened upstream fetcher (F2B) — the only path the collector may use to
// talk to source endpoints. Roadmap §10.3 requirements implemented here:
//   - https-only, no arbitrary URLs (callers pass manifest endpoints)
//   - private/loopback/link-local addresses rejected, including on redirects
//   - bounded redirect count, response size and total duration
//   - conditional GET (If-None-Match / If-Modified-Since) with 304 handling
//   - no cookies, fixed UA, no secrets in errors
//
// Server-only module.

import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

export type SafeFetchOptions = {
  etag?: string;
  lastModified?: string;
  timeoutMs?: number;
  maxBodyBytes?: number;
  maxRedirects?: number;
  accept?: string;
  /**
   * Test hook: allow http + LOOPBACK targets for local fixture servers.
   * All other private ranges (RFC1918, link-local/metadata, CGNAT, ULA)
   * stay blocked even in this mode, so redirect-safety tests stay honest.
   */
  allowPrivateHosts?: boolean;
};

export type SafeFetchResult = {
  status: number;
  notModified: boolean;
  body?: string;
  etag?: string;
  lastModified?: string;
  contentType?: string;
  /** Parsed from the response Cache-Control header when present (§8.1 hint). */
  cacheControlMaxAgeSeconds?: number;
  finalUrl: string;
  redirects: number;
  durationMs: number;
  bytes: number;
};

export type SafeFetchErrorCode =
  | "invalid_url"
  | "insecure_scheme"
  | "private_address_blocked"
  | "redirect_limit_exceeded"
  | "redirect_invalid"
  | "body_too_large"
  | "timeout"
  | "network_error"
  | "upstream_error";

export class SafeFetchError extends Error {
  readonly code: SafeFetchErrorCode;
  readonly status?: number;

  constructor(code: SafeFetchErrorCode, detail?: string, status?: number) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "SafeFetchError";
    this.code = code;
    this.status = status;
  }
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BODY_BYTES = 3 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 5;
const USER_AGENT = "EchisWorld-Collector/1.0 (+https://github.com/4ilteris7/EchisWorld)";

// ── Address safety ──────────────────────────────────────────────────────────

function isPrivateIpv4(ip: string): boolean {
  const octets = ip.split(".").map(Number);
  if (octets.length !== 4 || octets.some((n) => Number.isNaN(n))) return true;
  const [a, b] = octets;
  if (a === 0 || a === 10 || a === 127) return true; // this-net, private, loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 169 && b === 254) return true; // link-local / metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::" || lower === "::1") return true;
  if (lower.startsWith("fe80:")) return true; // link-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA
  if (lower.startsWith("::ffff:")) {
    return isPrivateIpv4(lower.slice("::ffff:".length));
  }
  return false;
}

export function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isPrivateIpv4(ip);
  if (family === 6) return isPrivateIpv6(ip);
  return true; // not an IP literal → caller must resolve first
}

/**
 * Validate one hop's URL: https-only (http allowed only for private-host test
 * mode), and the hostname must not be, or resolve to, a private address.
 */
async function assertSafeHop(
  rawUrl: string,
  options: SafeFetchOptions,
  redirectHop: boolean,
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SafeFetchError(
      redirectHop ? "redirect_invalid" : "invalid_url",
      "unparseable url",
    );
  }

  const allowLoopback = options.allowPrivateHosts === true;
  const schemeOk =
    url.protocol === "https:" || (allowLoopback && url.protocol === "http:");
  if (!schemeOk) {
    throw new SafeFetchError(
      redirectHop ? "redirect_invalid" : "insecure_scheme",
      url.protocol,
    );
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const isLoopback =
    hostname === "localhost" ||
    /^127\./.test(hostname) ||
    hostname === "::1";
  if (allowLoopback && isLoopback) return url;

  if (isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      throw new SafeFetchError("private_address_blocked", "ip literal");
    }
    return url;
  }
  if (allowLoopback) return url;

  let addresses;
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new SafeFetchError("network_error", "dns_lookup_failed");
  }
  if (addresses.length === 0) {
    throw new SafeFetchError("network_error", "dns_no_records");
  }
  for (const { address } of addresses) {
    if (isPrivateAddress(address)) {
      throw new SafeFetchError("private_address_blocked", "resolves to private range");
    }
  }
  return url;
}

// ── Fetcher ─────────────────────────────────────────────────────────────────

/**
 * Fetch a source endpoint with conditional headers and hard safety limits.
 * Throws SafeFetchError for transport/safety failures; returns normally for
 * any HTTP status (callers map statuses to collector outcomes).
 */
export async function safeFetch(
  rawUrl: string,
  options: SafeFetchOptions = {},
): Promise<SafeFetchResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;

  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let currentUrl = await assertSafeHop(rawUrl, options, false);
    let redirects = 0;

    for (;;) {
      let response: Response;
      try {
        response = await fetch(currentUrl, {
          method: "GET",
          redirect: "manual",
          signal: controller.signal,
          headers: {
            "User-Agent": USER_AGENT,
            Accept:
              options.accept ??
              "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5",
            ...(options.etag ? { "If-None-Match": options.etag } : {}),
            ...(options.lastModified
              ? { "If-Modified-Since": options.lastModified }
              : {}),
          },
        });
      } catch (err) {
        if (controller.signal.aborted) throw new SafeFetchError("timeout");
        throw new SafeFetchError(
          "network_error",
          err instanceof Error ? err.name : undefined,
        );
      }

      // Redirect hop
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        const location = response.headers.get("location");
        if (!location) {
          throw new SafeFetchError("redirect_invalid", "missing location header");
        }
        redirects += 1;
        if (redirects > maxRedirects) {
          throw new SafeFetchError("redirect_limit_exceeded");
        }
        currentUrl = await assertSafeHop(
          new URL(location, currentUrl).href,
          options,
          true,
        );
        continue;
      }

      const durationOf = () => Math.round(performance.now() - started);
      const maxAgeMatch = (response.headers.get("cache-control") ?? "").match(
        /max-age=(\d+)/i,
      );
      const cacheControlMaxAgeSeconds = maxAgeMatch
        ? Number(maxAgeMatch[1])
        : undefined;

      if (response.status === 304) {
        await response.body?.cancel();
        return {
          status: 304,
          notModified: true,
          etag: response.headers.get("etag") ?? options.etag,
          lastModified:
            response.headers.get("last-modified") ?? options.lastModified,
          contentType: response.headers.get("content-type") ?? undefined,
          cacheControlMaxAgeSeconds,
          finalUrl: currentUrl.href,
          redirects,
          durationMs: durationOf(),
          bytes: 0,
        };
      }

      // Read the body with a hard size cap; declared Content-Length is only a
      // hint — the stream itself is what gets enforced.
      const declared = Number(response.headers.get("content-length") ?? "0");
      if (declared > maxBodyBytes) {
        await response.body?.cancel();
        throw new SafeFetchError("body_too_large", "content-length");
      }

      const chunks: Uint8Array[] = [];
      let received = 0;
      if (response.body) {
        const reader = response.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          received += value.byteLength;
          if (received > maxBodyBytes) {
            await reader.cancel();
            throw new SafeFetchError("body_too_large", "stream");
          }
          chunks.push(value);
        }
      }
      const body = Buffer.concat(chunks).toString("utf8");

      return {
        status: response.status,
        notModified: false,
        body,
        etag: response.headers.get("etag") ?? undefined,
        lastModified: response.headers.get("last-modified") ?? undefined,
        contentType: response.headers.get("content-type") ?? undefined,
        cacheControlMaxAgeSeconds,
        finalUrl: currentUrl.href,
        redirects,
        durationMs: durationOf(),
        bytes: received,
      };
    }
  } finally {
    clearTimeout(timer);
  }
}
