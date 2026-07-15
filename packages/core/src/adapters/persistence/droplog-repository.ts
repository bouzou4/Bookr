/**
 * SQLite-backed implementation of {@link DropRepository}.
 *
 * @packageDocumentation
 */

import type Database from "better-sqlite3";
import type { DropEvent, DropStats } from "@bookr/shared";
import type { DropRepository } from "../../ports/repository.ts";
import { bucketForHours, HOURS_UNTIL_BUCKETS } from "./buckets.ts";

/**
 * Build the SQLite-backed {@link DropRepository}.
 *
 * @param db - The open database connection.
 * @returns A repository backed by the `droplog` table.
 */
export function createDroplogRepository(db: Database.Database): DropRepository {
  const insertStmt = db.prepare(`
    INSERT INTO droplog (
      venue_id, provider, observed_at, reservation_date, reservation_time,
      hours_until_reservation, reservation_dow, observed_dow, party_size, was_initial_release
    ) VALUES (
      @venue_id, @provider, @observed_at, @reservation_date, @reservation_time,
      @hours_until_reservation, @reservation_dow, @observed_dow, @party_size, @was_initial_release
    )
  `);
  const hoursStmt = db.prepare("SELECT hours_until_reservation FROM droplog WHERE venue_id = ?");

  return {
    record: (event: DropEvent) => {
      insertStmt.run({
        venue_id: event.venueId,
        provider: event.provider,
        observed_at: event.observedAt,
        reservation_date: event.reservationDate,
        reservation_time: event.reservationTime,
        hours_until_reservation: event.hoursUntilReservation,
        reservation_dow: event.reservationDow,
        observed_dow: event.observedDow,
        party_size: event.partySize,
        was_initial_release: event.wasInitialRelease ? 1 : 0,
      });
    },
    stats: (venueId): DropStats => {
      const rows = hoursStmt.all(venueId) as { hours_until_reservation: number }[];
      const byHoursUntilBucket: Record<string, number> = Object.fromEntries(
        HOURS_UNTIL_BUCKETS.map((label) => [label, 0]),
      );
      for (const row of rows) {
        const bucket = bucketForHours(row.hours_until_reservation);
        byHoursUntilBucket[bucket] = (byHoursUntilBucket[bucket] ?? 0) + 1;
      }
      return { venueId, sampleCount: rows.length, byHoursUntilBucket };
    },
  };
}
