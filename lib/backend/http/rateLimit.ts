// In-memory fixed-window rate limiter for the public read API (F7A).
//
// Single web instance today (roadmap §17.4), so a process-local counter is the
// correct tool — a shared Redis limiter is only introduced when multiple web
// instances exist. Behind Caddy in production the client IP arrives in
// X-Forwarded-For; in local dev it is absent and all callers share one bucket,
// which is fine for the abuse-protection intent.

export type RateLimitOptions = {
  /** Max requests allowed per window per client. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Distinguishes buckets per route so limits don't bleed across endpoints. */
  bucket: string;
};

type Counter = { count: number; resetAt: number };

const counters = new Map<string, Counter>();
let lastSweep = 0;

/** Extract a best-effort client key from proxy headers. */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

function sweep(now: number): void {
  // Amortized cleanup so the map can't grow without bound under many IPs.
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, counter] of counters) {
    if (counter.resetAt <= now) counters.delete(key);
  }
}

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
  resetAt: number;
};

export function checkRateLimit(
  request: Request,
  options: RateLimitOptions,
): RateLimitResult {
  const now = Date.now();
  sweep(now);
  const key = `${options.bucket}:${clientKey(request)}`;
  const existing = counters.get(key);

  if (!existing || existing.resetAt <= now) {
    counters.set(key, { count: 1, resetAt: now + options.windowMs });
    return {
      allowed: true,
      remaining: options.limit - 1,
      retryAfterSeconds: 0,
      resetAt: now + options.windowMs,
    };
  }

  existing.count += 1;
  const allowed = existing.count <= options.limit;
  return {
    allowed,
    remaining: Math.max(0, options.limit - existing.count),
    retryAfterSeconds: allowed
      ? 0
      : Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    resetAt: existing.resetAt,
  };
}

/**
 * Convenience guard: returns a 429 Response when over the limit, else null.
 * Callers do `const limited = rateLimit(req, opts); if (limited) return limited;`.
 */
export function rateLimit(
  request: Request,
  options: RateLimitOptions,
): Response | null {
  const result = checkRateLimit(request, options);
  if (result.allowed) return null;
  return Response.json(
    { error: "rate_limited", retryAfterSeconds: result.retryAfterSeconds },
    {
      status: 429,
      headers: {
        "Cache-Control": "no-store",
        "Retry-After": String(result.retryAfterSeconds),
      },
    },
  );
}

/** Test-only: clear all counters between cases. */
export function __resetRateLimit(): void {
  counters.clear();
  lastSweep = 0;
}
