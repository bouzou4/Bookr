/**
 * Process exit codes the `bookr` CLI returns. Anything that shells out to `bookr` (cron jobs,
 * CI, ad-hoc scripts) can branch on these instead of scraping human-readable output.
 *
 * @packageDocumentation
 */

/** The exit codes `bookr` can return, keyed by meaning. */
export const EXIT_CODES = {
  /** The command completed with no errors. */
  ok: 0,
  /** An unexpected error was thrown while executing the command, or a booking attempt failed/was challenged. */
  error: 1,
  /** The supplied arguments failed validation before the application layer was called. */
  invalidInput: 2,
  /** The referenced watch or other resource does not exist. */
  notFound: 3,
} as const;

/** One of the exit codes in {@link EXIT_CODES}. */
export type ExitCode = (typeof EXIT_CODES)[keyof typeof EXIT_CODES];
