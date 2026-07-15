/**
 * CLI-specific error types and the shared handler that turns any thrown command error into
 * stderr output plus an {@link ExitState} update. Centralising this keeps every command's
 * `catch` block a one-liner and keeps the exit-code mapping in a single place to audit.
 *
 * @packageDocumentation
 */

import { ZodError } from "zod";
import type { ExitState } from "./exit-state.ts";
import { EXIT_CODES } from "./exit-codes.ts";
import type { CliIO } from "./io.ts";

/**
 * Thrown for CLI-specific input problems not already covered by a `@bookr/shared` zod schema —
 * for example a malformed `--window` flag or a missing `--yes` confirmation.
 */
export class CliValidationError extends Error {}

/** Thrown when a referenced resource (a watch id, most commonly) does not exist. */
export class CliNotFoundError extends Error {}

/**
 * Render an error to a single human-readable line, flattening zod issues into `path: message`.
 *
 * @param err - The error to describe.
 * @returns A one-line description.
 */
function describe(err: unknown): string {
  if (err instanceof ZodError) {
    return err.issues.map((issue) => `${issue.path.join(".") || "(input)"}: ${issue.message}`).join("; ");
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Report a command's thrown error to stderr and set the matching exit code: schema/validation
 * failures and missing-resource errors get their own codes (see {@link EXIT_CODES}) so callers
 * can branch on exit status alone.
 *
 * @param io - Output streams.
 * @param exitState - Shared exit-code holder to update.
 * @param err - The error the command action caught.
 */
export function reportCommandError(io: CliIO, exitState: ExitState, err: unknown): void {
  io.stderr.write(`error: ${describe(err)}\n`);
  if (err instanceof ZodError || err instanceof CliValidationError) {
    exitState.code = EXIT_CODES.invalidInput;
  } else if (err instanceof CliNotFoundError) {
    exitState.code = EXIT_CODES.notFound;
  } else {
    exitState.code = EXIT_CODES.error;
  }
}
