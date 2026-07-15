/**
 * The polling scheduler. It drives scan passes on a jittered cadence derived from the injected
 * {@link Clock}, enforces single-flight (a slow pass never overlaps the next tick), keeps
 * per-provider/venue backoff so a struggling venue slows without dragging the others, and pauses a
 * provider that repeatedly hits login challenges — warning once — until a session is handed over.
 *
 * @packageDocumentation
 */

import type { Config } from "@bookr/shared";
import type { Clock } from "../ports/clock.ts";
import type { Notifier } from "../ports/notifier.ts";
import type { Repository } from "../ports/repository.ts";
import type { ScanService } from "../services/scan.ts";
import {
  DEFAULT_BACKOFF_CONFIG,
  backoffDelayMs,
  initialBackoffState,
  jitter,
  nextDelay,
  type BackoffConfig,
  type BackoffState,
  type PassOutcome,
} from "./backoff.ts";
import { distinctVenueKeys } from "./stagger.ts";

/** Dependencies the scheduler runs on. */
export interface SchedulerDeps {
  /** The scan service whose `runOnce` a tick invokes. */
  scan: ScanService;
  /** Persistence, used to map watches to venues and enumerate enabled watches. */
  repository: Repository;
  /** Notifier for the one-shot "provider paused" warning. */
  notifier: Notifier;
  /** Time source driving the cadence. */
  clock: Clock;
  /** Deployment configuration (base interval and jitter). */
  config: Config;
  /** Randomness for jitter in `[0, 1)`; defaults to `Math.random`. */
  rng?: () => number;
  /** Backoff limits; defaults to {@link DEFAULT_BACKOFF_CONFIG}. */
  backoffConfig?: BackoffConfig;
}

/**
 * A polling scheduler with single-flight passes, per-venue backoff, and jittered cadence. Satisfies
 * the application's `scheduler` surface (`start` / `stop` / `running`) and exposes `pass` for hosts
 * that want to trigger a single pass on demand.
 */
export class Scheduler {
  private readonly scan: ScanService;
  private readonly repository: Repository;
  private readonly notifier: Notifier;
  private readonly clock: Clock;
  private readonly rng: () => number;
  private readonly backoffConfig: BackoffConfig;
  private readonly baseMs: number;
  private readonly jitterPct: number;

  private readonly backoffStates = new Map<string, BackoffState>();
  private readonly pausedNotified = new Set<string>();
  private inFlight = false;
  private isRunning = false;
  private loopPromise: Promise<void> = Promise.resolve();

  /**
   * @param deps - The scheduler's dependencies.
   */
  constructor(deps: SchedulerDeps) {
    this.scan = deps.scan;
    this.repository = deps.repository;
    this.notifier = deps.notifier;
    this.clock = deps.clock;
    this.rng = deps.rng ?? Math.random;
    this.backoffConfig = deps.backoffConfig ?? DEFAULT_BACKOFF_CONFIG;
    this.baseMs = deps.config.pollIntervalSeconds * 1000;
    this.jitterPct = deps.config.pollJitterPct;
  }

  /** Start the polling loop. A no-op if already running. */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.loopPromise = this.loop();
  }

  /** Request the loop to stop after the current pass. */
  stop(): void {
    this.isRunning = false;
  }

  /** @returns Whether the loop is currently running. */
  running(): boolean {
    return this.isRunning;
  }

  /**
   * Await the loop's completion, if it is stopping. Useful for tests and graceful shutdown.
   *
   * @returns A promise that resolves when the loop has exited.
   */
  async drain(): Promise<void> {
    await this.loopPromise;
  }

  /**
   * The current backoff state for a provider/venue, if one has been recorded.
   *
   * @param provider - Provider name.
   * @param venueId - Provider venue id.
   * @returns The backoff state, or undefined.
   */
  stateFor(provider: string, venueId: string): BackoffState | undefined {
    return this.backoffStates.get(`${provider}:${venueId}`);
  }

  /**
   * Run a single scan pass now, respecting single-flight (returns immediately if a pass is already
   * in progress) and updating per-venue backoff from the result.
   *
   * @returns A promise that resolves when the pass and its bookkeeping complete.
   */
  async pass(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      const report = await this.scan.runOnce();
      await this.updateBackoff(report);
    } finally {
      this.inFlight = false;
    }
  }

  private enabledVenueKeys(): string[] {
    return distinctVenueKeys(
      this.repository.watches
        .list()
        .filter((w) => w.enabled)
        .map((w) => ({ provider: w.provider, venueId: w.venue.id })),
    );
  }

  private async updateBackoff(report: Awaited<ReturnType<ScanService["runOnce"]>>): Promise<void> {
    const outcomeByVenue = new Map<string, PassOutcome>();
    for (const key of this.enabledVenueKeys()) outcomeByVenue.set(key, "success");

    for (const error of report.errors) {
      const watch = this.repository.watches.get(error.watchId);
      if (!watch) continue;
      const key = `${watch.provider}:${watch.venue.id}`;
      if (outcomeByVenue.get(key) === "challenged") continue;
      outcomeByVenue.set(key, error.class === "challenged" ? "challenged" : "error");
    }

    for (const [key, outcome] of outcomeByVenue) {
      const previous = this.backoffStates.get(key) ?? initialBackoffState();
      const state = nextDelay(previous, outcome, this.backoffConfig);
      this.backoffStates.set(key, state);
      if (state.paused && !this.pausedNotified.has(key)) {
        this.pausedNotified.add(key);
        await this.notifier.notify("warning", {
          title: "Provider paused",
          body: `Repeated login challenges paused ${key}. Hand over a fresh session to resume scanning.`,
        });
      } else if (!state.paused) {
        this.pausedNotified.delete(key);
      }
    }
  }

  private nextSleepMs(): number {
    let delay = this.baseMs;
    for (const state of this.backoffStates.values()) {
      delay = Math.max(delay, backoffDelayMs(state, this.baseMs));
    }
    return jitter(delay, this.jitterPct, this.rng);
  }

  private async loop(): Promise<void> {
    while (this.isRunning) {
      await this.pass();
      if (!this.isRunning) break;
      await this.clock.sleep(this.nextSleepMs());
    }
  }
}

/**
 * Construct a {@link Scheduler}.
 *
 * @param deps - The scheduler's dependencies.
 * @returns The scheduler instance.
 */
export function createScheduler(deps: SchedulerDeps): Scheduler {
  return new Scheduler(deps);
}
