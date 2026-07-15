/**
 * `bookr book` — book a previously-seen slot.
 *
 * @packageDocumentation
 */

import type { Command } from "commander";
import type { BookrApp } from "@bookr/core";
import { bookRequestSchema } from "@bookr/shared";
import type { CliIO } from "../io.ts";
import type { ExitState } from "../exit-state.ts";
import { EXIT_CODES } from "../exit-codes.ts";
import { CliValidationError, reportCommandError } from "../errors.ts";
import { printItem, type Row } from "../output.ts";

/**
 * Register `bookr book <watchId> <dedupeKey> --yes`, which attempts to book a slot previously
 * surfaced by a scan or check. `--yes` is a mandatory confirmation, not a stylistic default —
 * omitting it is a validation error, never a silent no-op. A `challenged` or `failed` outcome
 * exits non-zero even though the command itself completed without throwing.
 *
 * @param program - The root commander program.
 * @param app - The application surface to drive.
 * @param io - Output streams.
 * @param exitState - Shared exit-code holder.
 */
export function registerBookCommand(program: Command, app: BookrApp, io: CliIO, exitState: ExitState): void {
  program
    .command("book")
    .description("Book a previously-seen slot within a watch")
    .argument("<watchId>", "the watch the slot belongs to")
    .argument("<dedupeKey>", "the slot's dedupe key")
    .option("--yes", "confirm the booking (required)", false)
    .action(async (watchId: string, dedupeKey: string, opts: { yes?: boolean }, command: Command) => {
      const { json } = command.optsWithGlobals<{ json?: boolean }>();
      try {
        if (!opts.yes) throw new CliValidationError("refusing to book without --yes");
        const input = bookRequestSchema.parse({ watchId, dedupeKey });
        const result = await app.booking.book(input.watchId, input.dedupeKey);
        printItem(io, Boolean(json), result as unknown as Row);
        if (result.status === "challenged" || result.status === "failed") {
          exitState.code = EXIT_CODES.error;
        }
      } catch (err) {
        reportCommandError(io, exitState, err);
      }
    });
}
