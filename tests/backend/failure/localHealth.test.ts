import { afterEach, describe, expect, it, vi } from "vitest";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/lib/backend/db/pool", () => ({ getPool: () => ({ query }) }));
import { GET } from "@/app/api/health/route";

afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });

describe("local readiness distinguishes collection from source coverage", () => {
  it("reports ready with a current worker even when a feed is partial", async () => {
    vi.stubEnv("ECHIS_BUILD_ID", "local");
    query.mockResolvedValueOnce({ rows: [{ active: true }] })
      .mockResolvedValueOnce({ rows: [{ feed: "global", state: "partial", ageSeconds: 90 }] });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      storage: "ready", worker: "running",
      feeds: [{ feed: "global", generatedState: "partial", ageSeconds: 90 }],
    });
    expect(query.mock.calls[0][1]).toEqual(["local"]);
  });

  it("does not declare restored payloads ready without a local worker", async () => {
    query.mockResolvedValueOnce({ rows: [{ active: false }] })
      .mockResolvedValueOnce({ rows: [{ feed: "global", state: "fresh", ageSeconds: 9999 }] });
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ storage: "ready", worker: "unavailable" });
  });

  it("does not expose database errors or credentials", async () => {
    query.mockRejectedValueOnce(new Error("credential-that-must-not-leak"));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unavailable", storage: "unavailable" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
});
