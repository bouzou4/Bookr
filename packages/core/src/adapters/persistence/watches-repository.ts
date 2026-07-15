/**
 * SQLite-backed implementation of {@link WatchRepository}.
 *
 * @packageDocumentation
 */

import type Database from "better-sqlite3";
import type { DateRange, ResourceType, Watch } from "@bookr/shared";
import type { WatchRepository } from "../../ports/repository.ts";

interface WatchRow {
  id: string;
  provider: string;
  label: string;
  venue_id: string;
  venue_slug: string | null;
  resource_type: string;
  party_size: number;
  date_range_start: string | null;
  date_range_end: string | null;
  date_range_rolling_days: number | null;
  time_window_start: string;
  time_window_end: string;
  timezone: string;
  autobook: number;
  enabled: number;
  created_at: string;
  updated_at: string;
}

function toDateRange(row: WatchRow): DateRange {
  if (row.date_range_rolling_days !== null) {
    return { rollingDays: row.date_range_rolling_days };
  }
  return { start: row.date_range_start ?? "", end: row.date_range_end ?? "" };
}

function rowToWatch(row: WatchRow): Watch {
  return {
    id: row.id,
    provider: row.provider as Watch["provider"],
    label: row.label,
    venue: { id: row.venue_id, slug: row.venue_slug ?? undefined },
    resourceType: row.resource_type as ResourceType,
    partySize: row.party_size,
    dateRange: toDateRange(row),
    timeWindow: { start: row.time_window_start, end: row.time_window_end },
    timezone: row.timezone,
    autobook: row.autobook === 1,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Split a {@link DateRange} into the nullable fixed/rolling columns the schema stores. */
function splitDateRange(range: DateRange): {
  start: string | null;
  end: string | null;
  rollingDays: number | null;
} {
  if ("rollingDays" in range) {
    return { start: null, end: null, rollingDays: range.rollingDays };
  }
  return { start: range.start, end: range.end, rollingDays: null };
}

/** Flatten a {@link Watch} into the bind-parameter shape the prepared statements expect. */
function watchToParams(watch: Watch): Record<string, unknown> {
  const range = splitDateRange(watch.dateRange);
  return {
    id: watch.id,
    provider: watch.provider,
    label: watch.label,
    venue_id: watch.venue.id,
    venue_slug: watch.venue.slug ?? null,
    resource_type: watch.resourceType,
    party_size: watch.partySize,
    date_range_start: range.start,
    date_range_end: range.end,
    date_range_rolling_days: range.rollingDays,
    time_window_start: watch.timeWindow.start,
    time_window_end: watch.timeWindow.end,
    timezone: watch.timezone,
    autobook: watch.autobook ? 1 : 0,
    enabled: watch.enabled ? 1 : 0,
    created_at: watch.createdAt,
    updated_at: watch.updatedAt,
  };
}

/**
 * Build the SQLite-backed {@link WatchRepository}.
 *
 * @param db - The open database connection.
 * @returns A repository backed by the `watches` table.
 */
export function createWatchesRepository(db: Database.Database): WatchRepository {
  const listStmt = db.prepare("SELECT * FROM watches ORDER BY created_at ASC");
  const getStmt = db.prepare("SELECT * FROM watches WHERE id = ?");
  const insertStmt = db.prepare(`
    INSERT INTO watches (
      id, provider, label, venue_id, venue_slug, resource_type, party_size,
      date_range_start, date_range_end, date_range_rolling_days,
      time_window_start, time_window_end, timezone, autobook, enabled, created_at, updated_at
    ) VALUES (
      @id, @provider, @label, @venue_id, @venue_slug, @resource_type, @party_size,
      @date_range_start, @date_range_end, @date_range_rolling_days,
      @time_window_start, @time_window_end, @timezone, @autobook, @enabled, @created_at, @updated_at
    )
  `);
  const updateStmt = db.prepare(`
    UPDATE watches SET
      provider = @provider, label = @label, venue_id = @venue_id, venue_slug = @venue_slug,
      resource_type = @resource_type, party_size = @party_size,
      date_range_start = @date_range_start, date_range_end = @date_range_end,
      date_range_rolling_days = @date_range_rolling_days,
      time_window_start = @time_window_start, time_window_end = @time_window_end,
      timezone = @timezone, autobook = @autobook, enabled = @enabled,
      created_at = @created_at, updated_at = @updated_at
    WHERE id = @id
  `);
  const removeStmt = db.prepare("DELETE FROM watches WHERE id = ?");

  return {
    list: () => (listStmt.all() as WatchRow[]).map(rowToWatch),
    get: (id) => {
      const row = getStmt.get(id) as WatchRow | undefined;
      return row ? rowToWatch(row) : undefined;
    },
    create: (watch) => {
      insertStmt.run(watchToParams(watch));
      return watch;
    },
    update: (watch) => {
      updateStmt.run(watchToParams(watch));
      return watch;
    },
    remove: (id) => {
      removeStmt.run(id);
    },
  };
}
