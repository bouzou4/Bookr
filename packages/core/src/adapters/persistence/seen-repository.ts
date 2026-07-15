/**
 * SQLite-backed implementation of {@link SeenRepository}, including the dedupe-retention sweep.
 *
 * @packageDocumentation
 */

import type Database from "better-sqlite3";
import type { SeenEntry } from "@bookr/shared";
import type { SeenRepository } from "../../ports/repository.ts";
import { parseDedupeKey } from "./dedupe-key.ts";

/** How long a seen entry is retained after it was last observed, absent an earlier reservation date. */
const RETENTION_MS = 14 * 24 * 60 * 60 * 1000;

interface SeenRow {
  key: string;
  first_seen_at: string;
  last_seen_at: string;
  notified_at: string | null;
  disappeared_at: string | null;
}

function rowToEntry(row: SeenRow): SeenEntry {
  return {
    key: row.key,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    notifiedAt: row.notified_at ?? undefined,
    disappearedAt: row.disappeared_at ?? undefined,
  };
}

/** Normalise an ISO timestamp or plain date string to its `YYYY-MM-DD` calendar date. */
function toCalendarDate(iso: string): string {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime()) ? iso.slice(0, 10) : parsed.toISOString().slice(0, 10);
}

/**
 * Build the SQLite-backed {@link SeenRepository}.
 *
 * `sweep` drops an entry once either condition holds: its dedupe key's embedded reservation
 * date (the third `:`-delimited segment, see {@link parseDedupeKey}) is strictly before `now`'s
 * calendar date, or it was last observed more than 14 days before `now`.
 *
 * @param db - The open database connection.
 * @returns A repository backed by the `seen` table.
 */
export function createSeenRepository(db: Database.Database): SeenRepository {
  const getStmt = db.prepare("SELECT * FROM seen WHERE key = ?");
  const upsertStmt = db.prepare(`
    INSERT INTO seen (key, first_seen_at, last_seen_at, notified_at, disappeared_at)
    VALUES (@key, @first_seen_at, @last_seen_at, @notified_at, @disappeared_at)
    ON CONFLICT(key) DO UPDATE SET
      first_seen_at = excluded.first_seen_at,
      last_seen_at = excluded.last_seen_at,
      notified_at = excluded.notified_at,
      disappeared_at = excluded.disappeared_at
  `);
  const allKeysStmt = db.prepare("SELECT key, last_seen_at FROM seen");
  const deleteStmt = db.prepare("DELETE FROM seen WHERE key = ?");

  return {
    get: (key) => {
      const row = getStmt.get(key) as SeenRow | undefined;
      return row ? rowToEntry(row) : undefined;
    },
    upsert: (entry) => {
      upsertStmt.run({
        key: entry.key,
        first_seen_at: entry.firstSeenAt,
        last_seen_at: entry.lastSeenAt,
        notified_at: entry.notifiedAt ?? null,
        disappeared_at: entry.disappearedAt ?? null,
      });
    },
    sweep: (now) => {
      const nowMs = new Date(now).getTime();
      const cutoffMs = nowMs - RETENTION_MS;
      const nowDate = toCalendarDate(now);

      const rows = allKeysStmt.all() as { key: string; last_seen_at: string }[];
      const staleKeys = rows
        .filter((row) => {
          const tooOld = new Date(row.last_seen_at).getTime() < cutoffMs;
          const parsed = parseDedupeKey(row.key);
          const pastReservation = parsed !== undefined && parsed.reservationDate < nowDate;
          return tooOld || pastReservation;
        })
        .map((row) => row.key);

      if (staleKeys.length === 0) return;
      const deleteMany = db.transaction((keys: string[]) => {
        for (const key of keys) deleteStmt.run(key);
      });
      deleteMany(staleKeys);
    },
  };
}
