/**
 * `bookr scan` — run a single scan pass.
 *
 * @packageDocumentation
 */

import type { Command } from "commander";
import type { BookrApp } from "@bookr/core";
import type { CliIO } from "../io.ts";
import type { ExitState } from "../exit-state.ts";
import { EXIT_CODES } from "../exit-codes.ts";
import { reportCommandError } from "../errors.ts";
import { printItem, printTable, type Row } from "../output.ts";

/**
 * Register `bookr scan [--watch <id>]`, which scans one watch or all enabled watches and
 * reports the resulting {@link ScanReport}. Exits non-zero if the pass recorded any per-watch
 * errors, even though the command itself completed.
 *
 * @param program - The root commander program.
 * @param app - The application surface to drive.
 * @param io - Output streams.
 * @param exitState - Shared exit-code holder.
 */
export function registerScanCommand(program: Command, app: BookrApp, io: CliIO, exitState: ExitState): void {
  program
    .command("scan")
    .description("Run a single scan pass over one watch or all enabled watches")
    .option("--watch <id>", "scan only this watch id")
    .action(async (opts: { watch?: string }, command: Command) => {
      const { json } = command.optsWithGlobals<{ json?: boolean }>();
      try {
        const report = await app.scan.runOnce(opts.watch);
        if (json) {
          printItem(io, true, report as unknown as Row);
        } else {
          printItem(io, false, {
            startedAt: report.startedAt,
            finishedAt: report.finishedAt,
            watchesScanned: report.watchesScanned,
            newSlots: report.newSlots,
            notified: report.notified,
            booked: report.booked,
            errors: report.errors.length,
          });
          if (report.errors.length > 0) {
            io.stdout.write("\n");
            printTable(io, report.errors as unknown as Row[], ["watchId", "class", "detail"]);
          }
        }
        if (report.errors.length > 0) exitState.code = EXIT_CODES.error;
      } catch (err) {
        reportCommandError(io, exitState, err);
      }
    });
}
