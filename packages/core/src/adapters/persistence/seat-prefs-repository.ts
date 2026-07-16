/**
 * SQLite-backed implementation of {@link SeatPrefRepository}.
 *
 * @packageDocumentation
 */

import type Database from "better-sqlite3";
import type { ProviderName, SeatPrefEntry } from "@bookr/shared";
import type { SeatPrefRepository } from "../../ports/repository.ts";

interface SeatPrefRow {
  provider: string;
  venue_id: string;
  layout_key: string;
  seats: string;
  updated_at: string;
}

function rowToEntry(row: SeatPrefRow): SeatPrefEntry {
  return {
    provider: row.provider as ProviderName,
    venueId: row.venue_id,
    layoutKey: row.layout_key,
    seats: JSON.parse(row.seats) as string[],
    updatedAt: row.updated_at,
  };
}

/**
 * Build the SQLite-backed {@link SeatPrefRepository}.
 *
 * @param db - The open database connection.
 * @returns A repository backed by the `seat_prefs` table.
 */
export function createSeatPrefsRepository(db: Database.Database): SeatPrefRepository {
  const getStmt = db.prepare("SELECT * FROM seat_prefs WHERE provider = ? AND venue_id = ? AND layout_key = ?");
  const putStmt = db.prepare(`
    INSERT INTO seat_prefs (provider, venue_id, layout_key, seats, updated_at)
    VALUES (@provider, @venue_id, @layout_key, @seats, @updated_at)
    ON CONFLICT (provider, venue_id, layout_key)
    DO UPDATE SET seats = @seats, updated_at = @updated_at
  `);

  return {
    get: (provider, venueId, layoutKey) => {
      const row = getStmt.get(provider, venueId, layoutKey) as SeatPrefRow | undefined;
      return row ? rowToEntry(row) : undefined;
    },
    put: (entry) => {
      putStmt.run({
        provider: entry.provider,
        venue_id: entry.venueId,
        layout_key: entry.layoutKey,
        seats: JSON.stringify(entry.seats),
        updated_at: entry.updatedAt,
      });
    },
  };
}
