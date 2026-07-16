/**
 * `bookr watch` — watch CRUD (`add`, `list`, `rm`, `enable`).
 *
 * @packageDocumentation
 */

import type { Command } from "commander";
import type { BookrApp } from "@bookr/core";
import { watchInputSchema } from "@bookr/shared";
import type { CliIO } from "../io.ts";
import type { ExitState } from "../exit-state.ts";
import { CliNotFoundError, CliValidationError, reportCommandError } from "../errors.ts";
import { printItem, printRows, type Row } from "../output.ts";
import { parseWindow } from "../validate.ts";

const WATCH_COLUMNS = ["id", "label", "provider", "partySize", "resourceType", "enabled", "autobook"];

/** Raw flags accepted by `bookr watch add`, before zod validation. */
interface AddOpts {
  provider: string;
  label: string;
  venueId: string;
  venueSlug?: string;
  resourceType: string;
  partySize: string;
  dateStart?: string;
  dateEnd?: string;
  rollingDays?: string;
  window: string;
  timezone: string;
  item?: string;
  tiers?: string;
  seats?: string;
  zones?: string;
  depths?: string;
  autobook: boolean;
  disabled: boolean;
}

/** Split a comma-separated flag into a trimmed list, or undefined when absent/empty. */
function csv(value: string | undefined): string[] | undefined {
  const items = value
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return items?.length ? items : undefined;
}

/**
 * Register `bookr watch add|list|rm|enable`, the watch-management subcommand group.
 *
 * @param program - The root commander program.
 * @param app - The application surface to drive.
 * @param io - Output streams.
 * @param exitState - Shared exit-code holder.
 */
export function registerWatchCommand(program: Command, app: BookrApp, io: CliIO, exitState: ExitState): void {
  const watch = program.command("watch").description("Manage reservation watches");

  watch
    .command("add")
    .description("Create a new watch")
    .requiredOption("--provider <provider>", "booking provider")
    .requiredOption("--label <label>", "human-friendly label")
    .requiredOption("--venue-id <id>", "provider venue id")
    .option("--venue-slug <slug>", "provider venue slug")
    .option("--resource-type <type>", "inventory category", "table")
    .requiredOption("--party-size <n>", "number of guests")
    .option("--date-start <date>", "fixed range start, YYYY-MM-DD")
    .option("--date-end <date>", "fixed range end, YYYY-MM-DD")
    .option("--rolling-days <n>", "rolling window length in days, from venue-local today")
    .requiredOption("--window <HH:MM-HH:MM>", "acceptable seating window")
    .requiredOption("--timezone <tz>", "IANA timezone, e.g. America/New_York")
    .option("--item <query>", "specific film/event within the venue (title match)")
    .option("--tiers <list>", "acceptable tiers, comma-separated (e.g. \"imax,dolby\" or \"bar counter\")")
    .option("--seats <list>", "acceptable seat names, comma-separated (e.g. \"F5,F6,F7\")")
    .option("--zones <list>", "acceptable seat zones: left,center,right")
    .option("--depths <list>", "acceptable seat depths: front,middle,back")
    .option("--autobook", "attempt to auto-book matches (capability-gated)", false)
    .option("--disabled", "create the watch disabled instead of enabled", false)
    .action(async (opts: AddOpts, command: Command) => {
      const { json } = command.optsWithGlobals<{ json?: boolean }>();
      try {
        let dateRange: { start: string; end: string } | { rollingDays: number };
        if (opts.rollingDays !== undefined) {
          dateRange = { rollingDays: Number(opts.rollingDays) };
        } else if (opts.dateStart && opts.dateEnd) {
          dateRange = { start: opts.dateStart, end: opts.dateEnd };
        } else {
          throw new CliValidationError("provide --rolling-days, or both --date-start and --date-end");
        }
        const seats = csv(opts.seats);
        const zones = csv(opts.zones);
        const depths = csv(opts.depths);
        const seating = seats || zones || depths ? { seats, zones, depths } : undefined;
        const input = watchInputSchema.parse({
          provider: opts.provider,
          label: opts.label,
          venue: { id: opts.venueId, slug: opts.venueSlug },
          resourceType: opts.resourceType,
          item: opts.item ? { query: opts.item } : undefined,
          tiers: csv(opts.tiers),
          seating,
          partySize: Number(opts.partySize),
          dateRange,
          timeWindow: parseWindow(opts.window),
          timezone: opts.timezone,
          autobook: opts.autobook,
          enabled: !opts.disabled,
        });
        const created = app.watches.create(input);
        printItem(io, Boolean(json), created as unknown as Row);
      } catch (err) {
        reportCommandError(io, exitState, err);
      }
    });

  watch
    .command("list")
    .description("List all watches")
    .action((_opts: unknown, command: Command) => {
      const { json } = command.optsWithGlobals<{ json?: boolean }>();
      printRows(io, Boolean(json), app.watches.list() as unknown as Row[], WATCH_COLUMNS);
    });

  watch
    .command("rm")
    .description("Delete a watch")
    .argument("<id>", "watch id")
    .action((id: string, _opts: unknown, command: Command) => {
      const { json } = command.optsWithGlobals<{ json?: boolean }>();
      try {
        if (!app.watches.get(id)) throw new CliNotFoundError(`watch not found: ${id}`);
        app.watches.remove(id);
        if (json) printItem(io, true, { removed: id });
        else io.stdout.write(`removed ${id}\n`);
      } catch (err) {
        reportCommandError(io, exitState, err);
      }
    });

  watch
    .command("enable")
    .description("Enable a watch (pass --off to disable it instead)")
    .argument("<id>", "watch id")
    .option("--off", "disable instead of enable", false)
    .action((id: string, opts: { off?: boolean }, command: Command) => {
      const { json } = command.optsWithGlobals<{ json?: boolean }>();
      try {
        if (!app.watches.get(id)) throw new CliNotFoundError(`watch not found: ${id}`);
        const updated = app.watches.setEnabled(id, !opts.off);
        printItem(io, Boolean(json), updated as unknown as Row);
      } catch (err) {
        reportCommandError(io, exitState, err);
      }
    });
}
