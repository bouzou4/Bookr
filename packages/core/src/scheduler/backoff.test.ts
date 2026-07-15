import { describe, expect, it } from "vitest";
import {
  DEFAULT_BACKOFF_CONFIG,
  MAX_DELAY_MS,
  backoffDelayMs,
  initialBackoffState,
  jitter,
  nextDelay,
} from "./backoff.ts";

describe("nextDelay", () => {
  it("starts at the base interval", () => {
    const s = initialBackoffState();
    expect(s).toEqual({ multiplier: 1, consecutiveChallenges: 0, paused: false });
  });

  it("doubles the multiplier on error, capped at the max", () => {
    let s = initialBackoffState();
    s = nextDelay(s, "error");
    expect(s.multiplier).toBe(2);
    s = nextDelay(s, "error");
    expect(s.multiplier).toBe(4);
    s = nextDelay(s, "error");
    expect(s.multiplier).toBe(8);
    s = nextDelay(s, "error");
    expect(s.multiplier).toBe(16);
    s = nextDelay(s, "error");
    expect(s.multiplier).toBe(DEFAULT_BACKOFF_CONFIG.maxMultiplier);
  });

  it("decays halfway toward base on success", () => {
    let s = { multiplier: 8, consecutiveChallenges: 0, paused: false };
    s = nextDelay(s, "success");
    expect(s.multiplier).toBe(4);
    s = nextDelay(s, "success");
    expect(s.multiplier).toBe(2);
    s = nextDelay(s, "success");
    expect(s.multiplier).toBe(1);
    s = nextDelay(s, "success");
    expect(s.multiplier).toBe(1);
  });

  it("pauses the provider after repeated challenges and warns via state", () => {
    let s = initialBackoffState();
    s = nextDelay(s, "challenged");
    expect(s.consecutiveChallenges).toBe(1);
    expect(s.paused).toBe(false);
    s = nextDelay(s, "challenged");
    expect(s.consecutiveChallenges).toBe(2);
    expect(s.paused).toBe(true);
  });

  it("clears the pause and challenge count on success", () => {
    const paused = { multiplier: 4, consecutiveChallenges: 3, paused: true };
    const s = nextDelay(paused, "success");
    expect(s.paused).toBe(false);
    expect(s.consecutiveChallenges).toBe(0);
  });

  it("keeps a pause through a plain error but resets challenge count", () => {
    const paused = { multiplier: 4, consecutiveChallenges: 2, paused: true };
    const s = nextDelay(paused, "error");
    expect(s.paused).toBe(true);
    expect(s.consecutiveChallenges).toBe(0);
  });

  it("respects a custom pause threshold", () => {
    const config = { maxMultiplier: 8, challengePauseThreshold: 1 };
    const s = nextDelay(initialBackoffState(), "challenged", config);
    expect(s.paused).toBe(true);
  });
});

describe("backoffDelayMs", () => {
  it("scales the base by the multiplier", () => {
    expect(backoffDelayMs({ multiplier: 4, consecutiveChallenges: 0, paused: false }, 60_000)).toBe(240_000);
  });

  it("clamps to the maximum delay", () => {
    expect(backoffDelayMs({ multiplier: 1000, consecutiveChallenges: 0, paused: false }, 60_000)).toBe(MAX_DELAY_MS);
  });
});

describe("jitter", () => {
  it("returns exactly the base delay at the rng floor", () => {
    expect(jitter(1000, 0.25, () => 0)).toBe(1000);
  });

  it("applies the full upward swing at the rng maximum, and half at the midpoint", () => {
    expect(jitter(1000, 0.25, () => 0.5)).toBe(1125);
    expect(jitter(1000, 0.25, () => 0.999999)).toBe(1250);
  });

  it("never dips below the base delay (the configured interval is a floor)", () => {
    expect(jitter(100, 2, () => 0)).toBe(100);
  });

  it("stays within the band across many samples (metronome avoidance)", () => {
    let seed = 1;
    const rng = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const base = 60_000;
    const pct = 0.25;
    const samples = Array.from({ length: 500 }, () => jitter(base, pct, rng));
    const distinct = new Set(samples);
    expect(distinct.size).toBeGreaterThan(50); // not a fixed metronome
    for (const s of samples) {
      expect(s).toBeGreaterThanOrEqual(base);
      expect(s).toBeLessThanOrEqual(base * (1 + pct));
    }
  });
});
