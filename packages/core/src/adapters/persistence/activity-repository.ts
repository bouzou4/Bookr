/**
 * SQLite-backed implementation of {@link ActivityRepository}.
 *
 * @packageDocumentation
 */

import type Database from "better-sqlite3";
import type { ActivityEvent, ActivityType, ProviderName } from "@bookr/shared";
import type { ActivityQuery, ActivityRepository } from "../../ports/repository.ts";
import type { Clock } from "../../ports/clock.ts";

interface ActivityRow {
  id: number;
  at: string;
  type: string;
  provider: string | null;
  watch_id: string | null;
  detail: string | null;
  data: string | null;
}

function rowToEvent(row: ActivityRow): ActivityEvent {
  return {
    id: row.id,
    at: row.at,
    type: row.type as ActivityType,
    provider: (row.provider as ProviderName | null) ?? undefined,
    watchId: row.watch_id ?? undefined,
    detail: row.detail ?? undefined,
    data: row.data !== null ? (JSON.parse(row.data) as unknown) : undefined,
  };
}

/**
 * Build the SQLite-backed {@link ActivityRepository}.
 *
 * The port's `prune` takes no reference time, so the supplied {@link Clock} stands in for
 * "now" when computing the age cutoff; tests can inject a fake clock for deterministic
 * boundary checks.
 *
 * @param db - The open database connection.
 * @param clock - Source of the current time for `prune`.
 * @returns A repository backed by the `activity` table.
 */
export function createActivityRepository(
  db: Database.Database,
  clock: Clock,
): ActivityRepository {
  const insertStmt = db.prepare(`
    INSERT INTO activity (at, type, provider, watch_id, detail, data)
    VALUES (@at, @type, @provider, @watch_id, @detail, @data)
  `);
  const allTimesStmt = db.prepare("SELECT id, at FROM activity");
  const deleteByIdStmt = db.prepare("DELETE FROM activity WHERE id = ?");

  return {
    record: (event) => {
      insertStmt.run({
        at: event.at,
        type: event.type,
        provider: event.provider ?? null,
        watch_id: event.watchId ?? null,
        detail: event.detail ?? null,
        data: event.data !== undefined ? JSON.stringify(event.data) : null,
      });
    },
    recent: (query?: ActivityQuery) => {
      const type: ActivityType | null = query?.type ?? null;
      const limit = query?.limit ?? -1;
      const rows = db
        .prepare(
          `SELECT * FROM activity
           WHERE (@type IS NULL OR type = @type)
           ORDER BY at DESC, id DESC
           LIMIT @limit`,
        )
        .all({ type, limit }) as ActivityRow[];
      return rows.map(rowToEvent);
    },
    prune: (olderThanDays) => {
      const cutoffMs = clock.now().getTime() - olderThanDays * 24 * 60 * 60 * 1000;
      const rows = allTimesStmt.all() as { id: number; at: string }[];
      const staleIds = rows
        .filter((row) => new Date(row.at).getTime() < cutoffMs)
        .map((row) => row.id);
      if (staleIds.length === 0) return;
      const deleteMany = db.transaction((ids: number[]) => {
        for (const id of ids) deleteByIdStmt.run(id);
      });
      deleteMany(staleIds);
    },
  };
}
