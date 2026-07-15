/**
 * The polling backoff state machine and delay maths, kept pure so cadence is unit-testable. A
 * successful pass decays toward the base interval; any failure doubles the interval (capped);
 * repeated login challenges pause the provider entirely. Jitter breaks the metronome so passes
 * never form a predictable, fingerprintable cadence.
 *
 * @packageDocumentation
 */

/** The outcome of a scan pass for one provider/venue, driving the next delay. */
export type PassOutcome = "success" | "error" | "challenged";

/** The evolving backoff state for a single provider/venue. */
export interface BackoffState {
  /** Current interval multiplier applied to the base cadence (`1`, `2`, `4`, …). */
  multiplier: number;
  /** How many challenges have occurred in a row. */
  consecutiveChallenges: number;
  /** True once repeated challenges have paused this provider until a session is handed over. */
  paused: boolean;
}

/** Tunable limits for the backoff state machine. */
export interface BackoffConfig {
  /** Largest interval multiplier the exponential backoff may reach. */
  maxMultiplier: number;
  /** Number of consecutive challenges that pauses the provider. */
  challengePauseThreshold: number;
}

/** Default backoff limits: cap at 16× base (~16 min at a 60 s base), pause after two challenges. */
export const DEFAULT_BACKOFF_CONFIG: BackoffConfig = {
  maxMultiplier: 16,
  challengePauseThreshold: 2,
};

/** Hard ceiling on any single delay, regardless of multiplier and base (about twenty minutes). */
export const MAX_DELAY_MS = 20 * 60 * 1000;

/**
 * The starting backoff state: base cadence, no failures, not paused.
 *
 * @returns A fresh {@link BackoffState}.
 */
export function initialBackoffState(): BackoffState {
  return { multiplier: 1, consecutiveChallenges: 0, paused: false };
}

/**
 * Advance the backoff state for a provider/venue given the latest pass outcome.
 *
 * @param state - The current state.
 * @param outcome - What the last pass reported.
 * @param config - Backoff limits (defaults to {@link DEFAULT_BACKOFF_CONFIG}).
 * @returns The next state.
 */
export function nextDelay(
  state: BackoffState,
  outcome: PassOutcome,
  config: BackoffConfig = DEFAULT_BACKOFF_CONFIG,
): BackoffState {
  switch (outcome) {
    case "success":
      // Decay halfway back toward the base interval and clear any pause.
      return { multiplier: Math.max(1, Math.floor(state.multiplier / 2)), consecutiveChallenges: 0, paused: false };
    case "error":
      return {
        multiplier: Math.min(state.multiplier * 2, config.maxMultiplier),
        consecutiveChallenges: 0,
        paused: state.paused,
      };
    case "challenged": {
      const consecutiveChallenges = state.consecutiveChallenges + 1;
      return {
        multiplier: Math.min(state.multiplier * 2, config.maxMultiplier),
        consecutiveChallenges,
        paused: state.paused || consecutiveChallenges >= config.challengePauseThreshold,
      };
    }
  }
}

/**
 * The concrete delay a backoff state implies, before jitter, clamped to {@link MAX_DELAY_MS}.
 *
 * @param state - The backoff state.
 * @param baseMs - The base cadence in milliseconds.
 * @returns The delay in milliseconds.
 */
export function backoffDelayMs(state: BackoffState, baseMs: number): number {
  return Math.min(baseMs * state.multiplier, MAX_DELAY_MS);
}

/**
 * Add upward jitter of up to `pct` to a delay, so passes never land on a fixed metronome yet
 * never dip below the base cadence. Jitter is one-sided (`[ms, ms * (1 + pct)]`) so the configured
 * interval is a floor: the rate-limit design depends on passes never firing faster than the base.
 *
 * @param ms - The base delay in milliseconds.
 * @param pct - Maximum upward jitter fraction in `[0, 1]` (e.g. `0.25` for up to +25%).
 * @param rng - Source of randomness in `[0, 1)`; defaults to `Math.random`.
 * @returns The jittered delay in milliseconds (never below `ms`).
 */
export function jitter(ms: number, pct: number, rng: () => number = Math.random): number {
  return Math.round(ms * (1 + rng() * pct));
}
