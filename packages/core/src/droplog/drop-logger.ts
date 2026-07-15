/**
 * Drop-timing logger. Every time a slot is observed appearing, one {@link DropEvent} is recorded
 * capturing how far ahead of the reservation the opening surfaced and the day-of-week context.
 * Aggregated over weeks these events reveal each venue's cancellation-release rhythm, which a
 * future heuristic can turn into per-venue poll cadence. All time arithmetic is venue-local.
 *
 * @packageDocumentation
 */

import type { DropEvent, DropStats, Slot, Watch } from "@bookr/shared";
import type { Clock } from "../ports/clock.ts";
import type { DropRepository } from "../ports/repository.ts";
import { HOUR_MS, dayOfWeek, venueLocalDate, zonedWallTimeToInstant } from "../services/time.ts";

/**
 * Build a {@link DropEvent} describing a slot observed at a given instant. Hours-until-reservation
 * and day-of-week fields are computed against the watch's venue-local timezone.
 *
 * @param slot - The observed slot.
 * @param watch - The watch it was found for (supplies timezone and party size).
 * @param observedAt - The instant the slot was observed.
 * @returns The drop event.
 */
export function buildDropEvent(slot: Slot, watch: Watch, observedAt: Date): DropEvent {
  const reservationInstant = zonedWallTimeToInstant(slot.date, slot.start, watch.timezone);
  const hoursUntilReservation = (reservationInstant.getTime() - observedAt.getTime()) / HOUR_MS;
  return {
    venueId: slot.venueId,
    provider: slot.provider,
    observedAt: observedAt.toISOString(),
    reservationDate: slot.date,
    reservationTime: slot.start,
    hoursUntilReservation,
    reservationDow: dayOfWeek(slot.date),
    observedDow: dayOfWeek(venueLocalDate(observedAt, watch.timezone)),
    partySize: watch.partySize,
    // Per-venue initial-release windows are not yet modelled; refine once release times are learned.
    wasInitialRelease: false,
  };
}

/** Records slot appearances and reports aggregated drop timing per venue. */
export interface DropLogger {
  /**
   * Record that a slot was observed appearing (using the clock's current time as the observation).
   *
   * @param slot - The observed slot.
   * @param watch - The watch it was found for.
   */
  record(slot: Slot, watch: Watch): void;
  /**
   * Aggregate drop statistics for a venue.
   *
   * @param venueId - Provider venue id.
   * @returns The aggregated stats.
   */
  stats(venueId: string): DropStats;
}

/**
 * Build a {@link DropLogger} over a drop repository and clock.
 *
 * @param repository - Drop-log persistence.
 * @param clock - Time source for the observation timestamp.
 * @returns The drop logger.
 */
export function createDropLogger(repository: DropRepository, clock: Clock): DropLogger {
  return {
    record: (slot: Slot, watch: Watch): void => {
      repository.record(buildDropEvent(slot, watch, clock.now()));
    },
    stats: (venueId: string): DropStats => repository.stats(venueId),
  };
}
