/**
 * The scan engine. A pass takes each in-scope watch, ensures a live provider session, fetches
 * current availability, filters it to the watch's venue-local date range and time window, dedupes
 * against previously-seen openings, alerts on genuinely new or re-freed slots, logs drop timing,
 * and optionally auto-books. Disappearance is tracked between passes so a slot that vanishes and
 * later returns re-alerts.
 *
 * @packageDocumentation
 */

import { formatDedupeKey } from "@bookr/shared";
import type { ResourceType, ScanReport, SeatingSummary, Slot, Watch } from "@bookr/shared";
import { ProviderError } from "../errors.ts";
import { createDropLogger, type DropLogger } from "../droplog/drop-logger.ts";
import { passesSeatingGate, resolveAcceptableSeats } from "../seating/gate.ts";
import { layoutSignature } from "../seating/signature.ts";
import { summarizeSeatMap } from "../seating/summary.ts";
import type { ServiceContext } from "./context.ts";
import { attemptBook } from "./booking.ts";
import { classify, ensureLiveSession, getProvider } from "./session.ts";
import { isWithinDateRange, isWithinWindow, resolveDateRange } from "./time.ts";

/**
 * How long activity-log events are retained. The log grows every pass (a `pass-complete` row per
 * cycle), so a full pass prunes anything older than this to keep it bounded over months.
 */
const ACTIVITY_RETENTION_DAYS = 90;

/** The scan surface of the application. */
export interface ScanService {
  /**
   * Run a single scan pass.
   *
   * @param watchId - If given, scan only that watch; otherwise all enabled watches.
   * @returns A summary of the pass.
   */
  runOnce(watchId?: string): Promise<ScanReport>;
}

/** Alert titles per inventory category — "Table available" reads wrong for a cinema. */
const ALERT_TITLES: Record<ResourceType, string> = {
  table: "Table available",
  bedroom: "Room available",
  screening: "Seats available",
  event: "Tickets available",
};

/** Whether a slot's tier (`kind`) matches one of the watch's acceptable tiers. */
function matchesTiers(tiers: string[] | undefined, kind: string | undefined): boolean {
  if (!tiers?.length) return true;
  if (!kind) return false;
  const haystack = kind.toLowerCase();
  return tiers.some((tier) => haystack.includes(tier.toLowerCase()));
}

/** A one-line description of the best open block, for alert copy. */
function seatingLine(seating: SeatingSummary): string {
  const best = seating.blocks[0];
  const blockPart = best ? `; best: ${String(best.size)} adjacent, row ${best.row} (${best.position}, ${best.depth})` : "";
  return ` — ${String(seating.percentTaken)}% full${blockPart}`;
}

function slotDedupeKey(watch: Watch, slot: Slot): string {
  return (
    slot.dedupeKey ||
    formatDedupeKey({
      provider: slot.provider,
      venueId: slot.venueId,
      date: slot.date,
      start: slot.start,
      partySize: watch.partySize,
      kind: slot.kind,
    })
  );
}

/**
 * Build the scan service. Disappearance is tracked durably: each present slot's `lastSeenAt` is
 * refreshed as it is observed, and at the end of a full pass every entry not touched since the
 * pass began is marked absent. Because that state lives in the repository rather than in memory,
 * a slot that vanishes and later returns still re-alerts across a restart.
 *
 * @param ctx - The service context.
 * @returns The {@link ScanService}.
 */
export function createScanService(ctx: ServiceContext): ScanService {
  const dropLogger: DropLogger = createDropLogger(ctx.repository.droplog, ctx.clock);

  // Serialize passes so an on-demand scan (e.g. a dashboard "scan now") can never overlap a
  // scheduled pass and race the `seen` upserts into duplicate alerts or a double book. Callers
  // queue behind the in-flight pass rather than being dropped, so a manual scan still runs.
  let tail: Promise<unknown> = Promise.resolve();
  function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const result = tail.then(fn, fn);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async function scanWatch(watch: Watch, report: ScanReport): Promise<void> {
    const provider = getProvider(ctx, watch.provider);
    let session;
    try {
      session = await ensureLiveSession(ctx, provider);
    } catch (err) {
      report.errors.push({
        watchId: watch.id,
        class: classify(provider, err),
        detail: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    let slots: Slot[];
    try {
      slots = await provider.find(watch, session);
    } catch (err) {
      const errorClass = classify(provider, err);
      ctx.repository.activity.record({
        at: ctx.clock.now().toISOString(),
        type: "error",
        provider: provider.name,
        watchId: watch.id,
        detail: err instanceof Error ? err.message : String(err),
      });
      report.errors.push({ watchId: watch.id, class: errorClass, detail: err instanceof Error ? err.message : String(err) });
      return;
    }

    const range = resolveDateRange(watch.dateRange, watch.timezone, ctx.clock.now());
    const matching = slots.filter(
      (s) =>
        isWithinDateRange(s.date, range) &&
        isWithinWindow(s.start, watch.timeWindow) &&
        matchesTiers(watch.tiers, s.kind),
    );

    for (const slot of matching) {
      // The acceptable-seat gate. Adapters ship the full map and never gate themselves; policy
      // lives here because resolving the cached per-theater preference needs the repository.
      // A gated-out slot is not upserted to `seen`, so a sold-out (for *your* seats) showtime
      // stays absent and re-alerts the moment an acceptable block frees up.
      let seating = slot.seating;
      if (slot.seatMap) {
        const cached = ctx.repository.seatPrefs.get(
          watch.provider,
          watch.venue.id,
          layoutSignature(slot.seatMap),
        )?.seats;
        const acceptable = resolveAcceptableSeats(watch.seating, slot.seatMap, cached);
        seating = summarizeSeatMap(slot.seatMap, acceptable);
        if (!passesSeatingGate(seating, watch.partySize)) continue;
      }
      // Downstream consumers (deep links, drop log, autobook) see the masked summary — the best
      // block in the alert and the pre-selected seats in the link must be the user's seats.
      const gated: Slot = seating === slot.seating ? slot : { ...slot, seating };

      const key = slotDedupeKey(watch, slot);
      const nowIso = ctx.clock.now().toISOString();
      const entry = ctx.repository.seen.get(key);
      const isNew = !entry;
      const reappeared = entry?.disappearedAt != null;

      if (isNew || reappeared) {
        if (isNew) report.newSlots += 1;
        ctx.repository.seen.upsert({
          key,
          firstSeenAt: entry?.firstSeenAt ?? nowIso,
          lastSeenAt: nowIso,
          notifiedAt: nowIso,
        });
        dropLogger.record({ ...gated, dedupeKey: key }, watch);
        ctx.repository.activity.record({
          at: nowIso,
          type: "slot-found",
          provider: provider.name,
          watchId: watch.id,
          detail: `${slot.date} ${slot.start}${slot.exclusive ? " (exclusive)" : ""}`,
          data: { dedupeKey: key },
        });
        const delivery = await ctx.notifier.notify("urgent", {
          title: `${ALERT_TITLES[slot.resourceType]} — ${watch.label}`,
          body:
            `${watch.partySize} on ${slot.date} at ${slot.start}` +
            `${slot.kind ? ` (${slot.kind})` : ""}${seating ? seatingLine(seating) : ""}`,
          link: provider.bookingUrl(watch, gated),
        });
        if (delivery.delivered) {
          report.notified += 1;
          ctx.repository.activity.record({ at: nowIso, type: "notified", provider: provider.name, watchId: watch.id });
        } else {
          // The alert this product exists for did not land — record it loudly instead of counting
          // it as delivered, so a silent channel outage is visible in the activity log.
          ctx.repository.activity.record({
            at: nowIso,
            type: "notify-failed",
            provider: provider.name,
            watchId: watch.id,
            detail: delivery.detail ?? "notification delivery failed",
          });
        }

        if (watch.autobook && provider.capabilities.autobook) {
          try {
            const result = await attemptBook(ctx, provider, watch, { ...gated, dedupeKey: key }, session);
            if (result.status === "booked") report.booked += 1;
          } catch {
            // Booking failures never abort a pass; attemptBook and providers record the detail.
          }
        }
      } else {
        ctx.repository.seen.upsert({
          key,
          firstSeenAt: entry.firstSeenAt,
          lastSeenAt: nowIso,
          notifiedAt: entry.notifiedAt,
        });
      }
    }
  }

  return {
    runOnce: (watchId?: string): Promise<ScanReport> =>
      runExclusive(async () => {
        const startedAt = ctx.clock.now().toISOString();
        const report: ScanReport = {
          startedAt,
          finishedAt: startedAt,
          watchesScanned: 0,
          newSlots: 0,
          notified: 0,
          booked: 0,
          errors: [],
        };

        const watches = watchId
          ? [ctx.repository.watches.get(watchId)].filter((w): w is Watch => w != null)
          : ctx.repository.watches.list().filter((w) => w.enabled);

        for (const watch of watches) {
          report.watchesScanned += 1;
          try {
            await scanWatch(watch, report);
          } catch (err) {
            const detail = err instanceof Error ? err.message : String(err);
            const errorClass = err instanceof ProviderError ? err.errorClass : "other";
            report.errors.push({ watchId: watch.id, class: errorClass, detail });
          }
        }

        // On a full pass every enabled watch was scanned, so any entry not observed since the pass
        // began is genuinely absent — mark it disappeared to arm the reappearance re-alert. A
        // single-watch pass cannot make that judgement about other watches' entries, so it is skipped.
        if (!watchId) {
          ctx.repository.seen.markAbsent(startedAt, ctx.clock.now().toISOString());
          // Keep the ever-growing activity log bounded; a single indexed delete per full pass.
          ctx.repository.activity.prune(ACTIVITY_RETENTION_DAYS);
        }

        ctx.repository.seen.sweep(ctx.clock.now().toISOString());
        report.finishedAt = ctx.clock.now().toISOString();
        ctx.runtime.lastPassAt = report.finishedAt;
        ctx.repository.activity.record({
          at: report.finishedAt,
          type: "pass-complete",
          detail: `${report.watchesScanned} watches, ${report.newSlots} new, ${report.notified} notified`,
          data: { newSlots: report.newSlots, notified: report.notified, booked: report.booked, errors: report.errors.length },
        });
        return report;
      }),
  };
}
