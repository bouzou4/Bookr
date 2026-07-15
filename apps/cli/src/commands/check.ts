/**
 * `bookr check` — ad-hoc availability lookup.
 *
 * @packageDocumentation
 */

import type { Command } from "commander";
import type { BookrApp } from "@bookr/core";
import { availabilityCheckSchema } from "@bookr/shared";
import type { CliIO } from "../io.ts";
import type { ExitState } from "../exit-state.ts";
import { reportCommandError } from "../errors.ts";
import { printRows, type Row } from "../output.ts";
import { parseWindow } from "../validate.ts";

const SLOT_COLUMNS = ["date", "start", "resourceType", "kind", "exclusive", "dedupeKey"];

/**
 * Register `bookr check <venue> <date> <party> [--window HH:MM-HH:MM] [--provider <p>]`, which
 * checks live availability without creating a watch. `<venue>` is the provider's venue id (see
 * `bookr resolve` to find one). The provider defaults to `resy`, the only fully-supported
 * provider at launch.
 *
 * @param program - The root commander program.
 * @param app - The application surface to drive.
 * @param io - Output streams.
 * @param exitState - Shared exit-code holder.
 */
export function registerCheckCommand(program: Command, app: BookrApp, io: CliIO, exitState: ExitState): void {
  program
    .command("check")
    .description("Check live availability for a venue/date/party without creating a watch")
    .argument("<venue>", "provider venue id")
    .argument("<date>", "reservation date, YYYY-MM-DD")
    .argument("<party>", "party size")
    .option("--window <HH:MM-HH:MM>", "restrict to a seating window")
    .option("--provider <provider>", "booking provider", "resy")
    .action(
      async (
        venue: string,
        date: string,
        party: string,
        opts: { window?: string; provider: string },
        command: Command,
      ) => {
        const { json } = command.optsWithGlobals<{ json?: boolean }>();
        try {
          const input = availabilityCheckSchema.parse({
            provider: opts.provider,
            venueId: venue,
            date,
            partySize: Number(party),
            window: opts.window ? parseWindow(opts.window) : undefined,
          });
          const slots = await app.availability.check(input);
          printRows(io, Boolean(json), slots as unknown as Row[], SLOT_COLUMNS);
        } catch (err) {
          reportCommandError(io, exitState, err);
        }
      },
    );
}
