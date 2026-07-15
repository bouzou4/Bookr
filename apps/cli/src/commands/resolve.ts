/**
 * `bookr resolve` — free-text/URL venue resolution.
 *
 * @packageDocumentation
 */

import type { Command } from "commander";
import type { BookrApp } from "@bookr/core";
import { venueResolveSchema } from "@bookr/shared";
import type { CliIO } from "../io.ts";
import type { ExitState } from "../exit-state.ts";
import { reportCommandError } from "../errors.ts";
import { printRows, type Row } from "../output.ts";

const VENUE_COLUMNS = ["provider", "id", "name", "slug", "city"];

/**
 * Register `bookr resolve <url|query> [--provider <p>]`, which resolves a URL, slug, or
 * free-text query to candidate venues on a provider. Defaults to `resy`.
 *
 * @param program - The root commander program.
 * @param app - The application surface to drive.
 * @param io - Output streams.
 * @param exitState - Shared exit-code holder.
 */
export function registerResolveCommand(program: Command, app: BookrApp, io: CliIO, exitState: ExitState): void {
  program
    .command("resolve")
    .description("Resolve a URL, slug, or free-text query to candidate venues")
    .argument("<query>", "URL, slug, or search text")
    .option("--provider <provider>", "booking provider", "resy")
    .action(async (query: string, opts: { provider: string }, command: Command) => {
      const { json } = command.optsWithGlobals<{ json?: boolean }>();
      try {
        const input = venueResolveSchema.parse({ provider: opts.provider, query });
        const matches = await app.venues.resolve(input.query, input.provider);
        printRows(io, Boolean(json), matches as unknown as Row[], VENUE_COLUMNS);
      } catch (err) {
        reportCommandError(io, exitState, err);
      }
    });
}
