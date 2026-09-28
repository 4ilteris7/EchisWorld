// Adaptive per-source polling decisions (F2C) — pure functions, no I/O.
// Implements roadmap §8.1/§8.3: every source keeps its own effective interval
// inside its manifest [min, max] window, driven by observed results:
//
//   new items            → shrink toward min
//   repeated no-change   → grow toward max
//   RSS ttl / max-age    → lower bound on cadence (never poll faster)
//   API quota            → interval floor from the 80% budget share
//   errors               → exponential backoff, capped, without losing cadence
//   429 Retry-After      → respected as a hard minimum delay
//
// Every delay gets deterministic-injectable jitter (±10%) so restarts do not
// synchronize the whole fleet (§8.4). Callers persist the returned state to
// source_runtime_state; nothing here mutates anything.

import type { SourceScheduleProfile } from "@/lib/backend/sources/manifest";

export type ScheduleReason =
  | "bootstrap"
  | "observed_cadence"
  | "rss_hint"
  | "quota"
  | "backoff"
  | "manual_override";

export type FetchOutcome =
  | { kind: "new_items"; newItems: number; parsedItems: number }
  | { kind: "unchanged" }
  | { kind: "not_modified" }
  | {
      kind: "error";
      category: "temporary" | "blocked" | "rate_limited";
      retryAfterSeconds?: number;
    };

export type ScheduleState = {
  effectivePollIntervalSeconds: number;
  unchangedStreak: number;
  consecutiveFailures: number;
  observedPublishIntervalSeconds?: number;
  rssTtlHintSeconds?: number;
  cacheControlMaxAgeSeconds?: number;
};

export type ScheduleDecision = {
  effectivePollIntervalSeconds: number;
  /** Seconds until the next attempt (backoff + jitter applied). */
  nextPollDelaySeconds: number;
  scheduleReason: ScheduleReason;
  unchangedStreak: number;
  consecutiveFailures: number;
};

const SHRINK_FACTOR = 0.7;
const GROW_FACTOR = 1.5;
const UNCHANGED_STREAK_BEFORE_GROW = 3;
const MAX_BACKOFF_SECONDS = 6 * 60 * 60;
const JITTER_RATIO = 0.1;
/** Scheduler may consume at most this share of a documented daily budget. */
const BUDGET_SAFETY_SHARE = 0.8;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Interval floor implied by a daily request budget (§8.1 quota rule). */
export function quotaIntervalFloorSeconds(
  profile: SourceScheduleProfile,
): number | undefined {
  const budget = profile.dailyRequestBudget?.requestsPerDay;
  if (!budget || budget <= 0) return undefined;
  return Math.ceil(86_400 / (budget * BUDGET_SAFETY_SHARE));
}

/** Cadence lower bound from upstream freshness hints (§8.1). */
function hintFloorSeconds(state: ScheduleState): number | undefined {
  const hints = [
    state.rssTtlHintSeconds,
    state.cacheControlMaxAgeSeconds,
  ].filter((v): v is number => typeof v === "number" && v > 0);
  if (hints.length === 0) return undefined;
  return Math.max(...hints);
}

/**
 * Decide the next effective interval and delay for one source after a fetch.
 * `rng` returns [0,1) and exists so tests are fully deterministic; production
 * callers omit it.
 */
export function decideNextPoll(
  profile: SourceScheduleProfile,
  state: ScheduleState,
  outcome: FetchOutcome,
  rng: () => number = Math.random,
): ScheduleDecision {
  const min = profile.minPollIntervalSeconds;
  const max = profile.maxPollIntervalSeconds;
  let effective = clamp(state.effectivePollIntervalSeconds, min, max);
  let reason: ScheduleReason = "observed_cadence";
  let unchangedStreak = state.unchangedStreak;
  let consecutiveFailures = state.consecutiveFailures;

  // ── Error path: backoff without rewriting the learned cadence ────────────
  if (outcome.kind === "error") {
    consecutiveFailures += 1;
    const backoffBase = Math.max(effective, min);
    let backoff = Math.min(
      MAX_BACKOFF_SECONDS,
      backoffBase * 2 ** Math.min(consecutiveFailures, 6),
    );
    if (outcome.category === "rate_limited" && outcome.retryAfterSeconds) {
      backoff = Math.max(backoff, outcome.retryAfterSeconds);
    }
    return {
      effectivePollIntervalSeconds: effective,
      nextPollDelaySeconds: withJitter(backoff, rng),
      scheduleReason: "backoff",
      unchangedStreak,
      consecutiveFailures,
    };
  }

  // ── Success paths ────────────────────────────────────────────────────────
  consecutiveFailures = 0;

  if (outcome.kind === "new_items" && outcome.newItems > 0) {
    unchangedStreak = 0;
    const ratio =
      outcome.parsedItems > 0 ? outcome.newItems / outcome.parsedItems : 0;
    // Busy feeds shrink faster; a trickle shrinks gently.
    const factor = ratio >= 0.5 ? SHRINK_FACTOR : 0.85;
    effective = clamp(Math.round(effective * factor), min, max);
  } else {
    // unchanged / not_modified / zero new items
    unchangedStreak += 1;
    if (unchangedStreak >= UNCHANGED_STREAK_BEFORE_GROW) {
      effective = clamp(Math.round(effective * GROW_FACTOR), min, max);
    }
  }

  // Observed publish cadence pulls the interval toward "half the publish
  // rhythm" so we neither hammer a daily feed nor lag a busy wire.
  if (state.observedPublishIntervalSeconds) {
    const target = clamp(
      Math.round(state.observedPublishIntervalSeconds / 2),
      min,
      max,
    );
    effective = Math.round((effective + target) / 2);
  }

  // Freshness hints are a hard cadence floor.
  const hintFloor = hintFloorSeconds(state);
  if (hintFloor && effective < hintFloor) {
    effective = clamp(hintFloor, min, max);
    reason = "rss_hint";
  }

  // Quota floor wins over everything else when it is the binding constraint.
  const quotaFloor = quotaIntervalFloorSeconds(profile);
  if (quotaFloor && effective < quotaFloor) {
    effective = clamp(quotaFloor, min, Math.max(max, quotaFloor));
    reason = "quota";
  }

  return {
    effectivePollIntervalSeconds: effective,
    nextPollDelaySeconds: withJitter(effective, rng),
    scheduleReason: reason,
    unchangedStreak,
    consecutiveFailures,
  };
}

/** ±10% deterministic-injectable jitter (§8.4). */
export function withJitter(seconds: number, rng: () => number): number {
  const offset = (rng() * 2 - 1) * JITTER_RATIO;
  return Math.max(1, Math.round(seconds * (1 + offset)));
}

/** Initial state for a source that has never been polled (bootstrap). */
export function bootstrapState(profile: SourceScheduleProfile): ScheduleState {
  return {
    effectivePollIntervalSeconds: profile.basePollIntervalSeconds,
    unchangedStreak: 0,
    consecutiveFailures: 0,
  };
}
