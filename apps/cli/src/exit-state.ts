/**
 * Mutable holder for the exit code a running CLI command should return. Commander's action
 * handlers are void/async callbacks with no return-value contract, so command registrations
 * write the outcome here instead; {@link runCli} in `cli.ts` reads it back once parsing
 * finishes without throwing.
 *
 * @packageDocumentation
 */

/** The exit code {@link runCli} will return after a successful parse. */
export interface ExitState {
  /** Defaults to 0 (success); command actions set it on failure paths. */
  code: number;
}

/**
 * Create a fresh {@link ExitState} initialised to success.
 *
 * @returns A new exit-state holder.
 */
export function createExitState(): ExitState {
  return { code: 0 };
}
