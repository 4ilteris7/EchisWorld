// F2C exit evidence: deterministic scheduler tests (fixed rng, no clocks).

import { describe, expect, it } from "vitest";
import {
  bootstrapState,
  decideNextPoll,
  quotaIntervalFloorSeconds,
  withJitter,
  type ScheduleState,
} from "@/lib/backend/collector/schedule";
import type { SourceScheduleProfile } from "@/lib/backend/sources/manifest";

// rng()=0.5 → jitter offset exactly 0; every expectation stays exact.
const noJitter = () => 0.5;

const rssProfile: SourceScheduleProfile = {
  scheduleMode: "adaptive",
  cadenceClass: "normal_news",
  minPollIntervalSeconds: 600,
  basePollIntervalSeconds: 900,
  maxPollIntervalSeconds: 3600,
};

const quotaProfile: SourceScheduleProfile = {
  scheduleMode: "quota_limited",
  cadenceClass: "quota_api",
  minPollIntervalSeconds: 600,
  basePollIntervalSeconds: 900,
  maxPollIntervalSeconds: 3600,
  dailyRequestBudget: { requestsPerDay: 96, assumed: false },
};

function state(patch: Partial<ScheduleState> = {}): ScheduleState {
  return { ...bootstrapState(rssProfile), ...patch };
}

describe("decideNextPoll — cadence adaptation (§8.1)", () => {
  it("bootstraps at the base interval", () => {
    expect(bootstrapState(rssProfile).effectivePollIntervalSeconds).toBe(900);
  });

  it("shrinks toward min when a burst of new items arrives", () => {
    const d = decideNextPoll(
      rssProfile,
      state(),
      { kind: "new_items", newItems: 30, parsedItems: 40 },
      noJitter,
    );
    expect(d.effectivePollIntervalSeconds).toBe(630); // 900 × 0.7
    expect(d.unchangedStreak).toBe(0);
    expect(d.scheduleReason).toBe("observed_cadence");
  });

  it("never drops below the manifest minimum", () => {
    const s = state({ effectivePollIntervalSeconds: 600 });
    const d = decideNextPoll(
      rssProfile,
      s,
      { kind: "new_items", newItems: 40, parsedItems: 40 },
      noJitter,
    );
    expect(d.effectivePollIntervalSeconds).toBe(600);
  });

  it("grows only after a streak of unchanged polls", () => {
    let s = state();
    for (const expected of [900, 900, 1350]) {
      const d = decideNextPoll(rssProfile, s, { kind: "unchanged" }, noJitter);
      expect(d.effectivePollIntervalSeconds).toBe(expected);
      s = {
        ...s,
        effectivePollIntervalSeconds: d.effectivePollIntervalSeconds,
        unchangedStreak: d.unchangedStreak,
      };
    }
  });

  it("caps growth at the manifest maximum", () => {
    const d = decideNextPoll(
      rssProfile,
      state({ effectivePollIntervalSeconds: 3000, unchangedStreak: 5 }),
      { kind: "not_modified" },
      noJitter,
    );
    expect(d.effectivePollIntervalSeconds).toBe(3600);
  });

  it("pulls toward half the observed publish rhythm", () => {
    const d = decideNextPoll(
      rssProfile,
      state({ observedPublishIntervalSeconds: 4000 }),
      { kind: "new_items", newItems: 2, parsedItems: 40 },
      noJitter,
    );
    // trickle shrink: 900×0.85=765 → blend with target 2000 → 1383
    expect(d.effectivePollIntervalSeconds).toBe(1383);
  });

  it("treats RSS ttl / max-age hints as a cadence floor", () => {
    const d = decideNextPoll(
      rssProfile,
      state({ rssTtlHintSeconds: 1800 }),
      { kind: "new_items", newItems: 40, parsedItems: 40 },
      noJitter,
    );
    expect(d.effectivePollIntervalSeconds).toBe(1800);
    expect(d.scheduleReason).toBe("rss_hint");
  });
});

describe("decideNextPoll — quota (§8.1)", () => {
  it("computes the 80% budget interval floor", () => {
    // 96/day × 0.8 = 76.8 → ceil(86400 / 76.8) = 1125 s
    expect(quotaIntervalFloorSeconds(quotaProfile)).toBe(1125);
  });

  it("never schedules faster than the quota floor", () => {
    const d = decideNextPoll(
      quotaProfile,
      { ...bootstrapState(quotaProfile), effectivePollIntervalSeconds: 600 },
      { kind: "new_items", newItems: 40, parsedItems: 40 },
      noJitter,
    );
    expect(d.effectivePollIntervalSeconds).toBe(1125);
    expect(d.scheduleReason).toBe("quota");
  });
});

describe("decideNextPoll — failure backoff (§8.3)", () => {
  it("backs off exponentially while keeping the learned cadence", () => {
    let s = state();
    const delays: number[] = [];
    for (let i = 0; i < 4; i++) {
      const d = decideNextPoll(
        rssProfile,
        s,
        { kind: "error", category: "temporary" },
        noJitter,
      );
      delays.push(d.nextPollDelaySeconds);
      expect(d.effectivePollIntervalSeconds).toBe(900); // cadence untouched
      expect(d.scheduleReason).toBe("backoff");
      s = { ...s, consecutiveFailures: d.consecutiveFailures };
    }
    expect(delays).toEqual([1800, 3600, 7200, 14400]); // 900×2^n
  });

  it("caps backoff at six hours", () => {
    const d = decideNextPoll(
      rssProfile,
      state({ consecutiveFailures: 10 }),
      { kind: "error", category: "temporary" },
      noJitter,
    );
    expect(d.nextPollDelaySeconds).toBe(6 * 60 * 60);
  });

  it("respects Retry-After as a hard minimum", () => {
    const d = decideNextPoll(
      rssProfile,
      state(),
      { kind: "error", category: "rate_limited", retryAfterSeconds: 7200 },
      noJitter,
    );
    expect(d.nextPollDelaySeconds).toBe(7200);
  });

  it("a success resets the failure counter", () => {
    const d = decideNextPoll(
      rssProfile,
      state({ consecutiveFailures: 4 }),
      { kind: "not_modified" },
      noJitter,
    );
    expect(d.consecutiveFailures).toBe(0);
  });
});

describe("withJitter (§8.4)", () => {
  it("spreads delays within ±10% deterministically", () => {
    expect(withJitter(1000, () => 0.5)).toBe(1000);
    expect(withJitter(1000, () => 0)).toBe(900);
    expect(withJitter(1000, () => 0.9999)).toBeLessThanOrEqual(1100);
    expect(withJitter(1000, () => 0.9999)).toBeGreaterThan(1090);
  });
});
