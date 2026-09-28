// F7A exit evidence: rate-limit abuse protection for the public read API.

import { afterEach, describe, expect, it } from "vitest";
import {
  checkRateLimit,
  clientKey,
  rateLimit,
  __resetRateLimit,
} from "@/lib/backend/http/rateLimit";

function req(ip?: string): Request {
  return new Request("http://localhost/api/feeds/cyber", {
    headers: ip ? { "x-forwarded-for": ip } : {},
  });
}

afterEach(() => __resetRateLimit());

describe("clientKey", () => {
  it("uses the first X-Forwarded-For hop", () => {
    const r = new Request("http://localhost/x", {
      headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" },
    });
    expect(clientKey(r)).toBe("203.0.113.7");
  });

  it("falls back to x-real-ip then 'unknown'", () => {
    expect(
      clientKey(new Request("http://localhost/x", { headers: { "x-real-ip": "198.51.100.9" } })),
    ).toBe("198.51.100.9");
    expect(clientKey(new Request("http://localhost/x"))).toBe("unknown");
  });
});

describe("checkRateLimit", () => {
  const opts = { bucket: "t", limit: 3, windowMs: 60_000 };

  it("allows up to the limit then blocks with a retry hint", () => {
    const ip = "203.0.113.1";
    expect(checkRateLimit(req(ip), opts).allowed).toBe(true);
    expect(checkRateLimit(req(ip), opts).allowed).toBe(true);
    const third = checkRateLimit(req(ip), opts);
    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);
    const fourth = checkRateLimit(req(ip), opts);
    expect(fourth.allowed).toBe(false);
    expect(fourth.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("tracks each client independently", () => {
    for (let i = 0; i < 3; i++) checkRateLimit(req("1.1.1.1"), opts);
    expect(checkRateLimit(req("1.1.1.1"), opts).allowed).toBe(false);
    // A different IP starts fresh.
    expect(checkRateLimit(req("2.2.2.2"), opts).allowed).toBe(true);
  });

  it("keeps buckets separate so one route can't exhaust another", () => {
    const ip = "203.0.113.2";
    for (let i = 0; i < 3; i++) checkRateLimit(req(ip), { ...opts, bucket: "a" });
    expect(checkRateLimit(req(ip), { ...opts, bucket: "a" }).allowed).toBe(false);
    expect(checkRateLimit(req(ip), { ...opts, bucket: "b" }).allowed).toBe(true);
  });

  it("resets after the window elapses", () => {
    const ip = "203.0.113.3";
    // Keep enough headroom that a busy CI worker cannot cross the window
    // between the two synchronous assertions.
    const shortWindow = { bucket: "t", limit: 1, windowMs: 100 };
    expect(checkRateLimit(req(ip), shortWindow).allowed).toBe(true);
    expect(checkRateLimit(req(ip), shortWindow).allowed).toBe(false);
    return new Promise((resolve) => {
      setTimeout(() => {
        expect(checkRateLimit(req(ip), shortWindow).allowed).toBe(true);
        resolve(null);
      }, 120);
    });
  });
});

describe("rateLimit guard", () => {
  const opts = { bucket: "guard", limit: 2, windowMs: 60_000 };

  it("returns null while allowed, a 429 Response when exceeded", async () => {
    const ip = "203.0.113.4";
    expect(rateLimit(req(ip), opts)).toBeNull();
    expect(rateLimit(req(ip), opts)).toBeNull();
    const blocked = rateLimit(req(ip), opts);
    expect(blocked).toBeInstanceOf(Response);
    expect(blocked!.status).toBe(429);
    expect(blocked!.headers.get("retry-after")).toBeTruthy();
    expect(blocked!.headers.get("cache-control")).toBe("no-store");
    expect((await blocked!.json()).error).toBe("rate_limited");
  });
});
