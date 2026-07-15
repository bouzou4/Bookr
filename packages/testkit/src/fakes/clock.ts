import type { Clock } from "@bookr/core";

/**
 * A deterministic {@link Clock} for tests. Time only moves when advanced explicitly or via
 * {@link FakeClock.sleep}, and every sleep duration is recorded for assertions.
 */
export class FakeClock implements Clock {
  private currentMs: number;

  /** Durations, in milliseconds, passed to {@link FakeClock.sleep}, in order. */
  readonly sleeps: number[] = [];

  /**
   * @param start - The initial instant. Defaults to a fixed date for reproducibility.
   */
  constructor(start: Date = new Date("2026-07-13T12:00:00.000Z")) {
    this.currentMs = start.getTime();
  }

  /** @returns The current instant. */
  now(): Date {
    return new Date(this.currentMs);
  }

  /**
   * Record a sleep and advance time by its duration (resolves immediately).
   *
   * @param ms - Milliseconds to "wait".
   */
  async sleep(ms: number): Promise<void> {
    this.sleeps.push(ms);
    this.currentMs += ms;
  }

  /**
   * Advance the clock without recording a sleep.
   *
   * @param ms - Milliseconds to advance.
   */
  advance(ms: number): void {
    this.currentMs += ms;
  }
}
