/**
 * Versioned schema migrations for the SQLite-backed {@link Repository} adapter.
 *
 * @packageDocumentation
 */

import type Database from "better-sqlite3";

/** A single forward-only schema migration. */
export interface Migration {
  /** Monotonically increasing version number. Applied in ascending order. */
  version: number;
  /** Short human-readable description, useful in logs. */
  description: string;
  /**
   * Apply the migration's schema changes.
   *
   * @param db - The open database connection.
   */
  up: (db: Database.Database) => void;
}

/**
 * All schema migrations, in application order. Each bump of `version` must be additive and
 * safe to run against a database already at a later version (the runner skips those).
 */
export const migrations: Migration[] = [
  {
    version: 1,
    description: "initial schema: watches, sessions, seen, activity, droplog",
    up: (db) => {
      db.exec(`
        CREATE TABLE watches (
          id TEXT PRIMARY KEY,
          provider TEXT NOT NULL,
          label TEXT NOT NULL,
          venue_id TEXT NOT NULL,
          venue_slug TEXT,
          resource_type TEXT NOT NULL,
          party_size INTEGER NOT NULL,
          date_range_start TEXT,
          date_range_end TEXT,
          date_range_rolling_days INTEGER,
          time_window_start TEXT NOT NULL,
          time_window_end TEXT NOT NULL,
          timezone TEXT NOT NULL,
          autobook INTEGER NOT NULL,
          enabled INTEGER NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE sessions (
          provider TEXT PRIMARY KEY,
          state TEXT NOT NULL,
          data TEXT NOT NULL,
          expires_at TEXT,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE seen (
          key TEXT PRIMARY KEY,
          first_seen_at TEXT NOT NULL,
          last_seen_at TEXT NOT NULL,
          notified_at TEXT,
          disappeared_at TEXT
        );

        CREATE TABLE activity (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          at TEXT NOT NULL,
          type TEXT NOT NULL,
          provider TEXT,
          watch_id TEXT,
          detail TEXT,
          data TEXT
        );
        CREATE INDEX idx_activity_at ON activity (at DESC);
        CREATE INDEX idx_activity_type ON activity (type);

        CREATE TABLE droplog (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          venue_id TEXT NOT NULL,
          provider TEXT NOT NULL,
          observed_at TEXT NOT NULL,
          reservation_date TEXT NOT NULL,
          reservation_time TEXT NOT NULL,
          hours_until_reservation REAL NOT NULL,
          reservation_dow INTEGER NOT NULL,
          observed_dow INTEGER NOT NULL,
          party_size INTEGER NOT NULL,
          was_initial_release INTEGER NOT NULL
        );
        CREATE INDEX idx_droplog_venue ON droplog (venue_id);
      `);
    },
  },
];

/**
 * Apply every migration newer than the database's current `user_version`, in order, each
 * inside its own transaction. Safe to call on every startup: a database already at the latest
 * version is left untouched.
 *
 * @param db - The open database connection.
 */
export function runMigrations(db: Database.Database): void {
  const current = db.pragma("user_version", { simple: true }) as number;
  const pending = migrations
    .filter((m) => m.version > current)
    .sort((a, b) => a.version - b.version);

  for (const migration of pending) {
    const apply = db.transaction(() => {
      migration.up(db);
      db.pragma(`user_version = ${migration.version}`);
    });
    apply();
  }
}
