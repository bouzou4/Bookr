/**
 * Abstracts the passage of time so schedulers and time-based logic can be tested
 * deterministically instead of depending on the real wall clock.
 */
export interface Clock {
  /** The current instant. */
  now(): Date;
  /**
   * Resolve after a delay.
   *
   * @param ms - Milliseconds to wait.
   */
  sleep(ms: number): Promise<void>;
}
