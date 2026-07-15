/**
 * Database file lifecycle: resolving the on-disk path, opening the connection with sane
 * pragmas, and bringing the schema up to date.
 *
 * @packageDocumentation
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { runMigrations } from "./migrations.ts";

/** Options for opening the SQLite-backed repository's database. */
export interface OpenDbOptions {
  /**
   * Directory the database file lives in; created if missing. Pass the literal string
   * `":memory:"` to use an in-memory database instead (useful for tests).
   */
  dataDir: string;
  /** Database filename within `dataDir`. Defaults to `"bookr.sqlite3"`. */
  filename?: string;
}

/**
 * Resolve the on-disk (or in-memory) path a database should be opened at, creating the
 * containing directory when needed.
 *
 * @param opts - Directory and filename options.
 * @returns A path suitable for the `better-sqlite3` constructor.
 */
export function resolveDbPath(opts: OpenDbOptions): string {
  if (opts.dataDir === ":memory:") return ":memory:";
  mkdirSync(opts.dataDir, { recursive: true });
  return join(opts.dataDir, opts.filename ?? "bookr.sqlite3");
}

/**
 * Open (creating if absent) the Bookr SQLite database: enables WAL journaling and foreign
 * keys, then runs any pending schema migrations.
 *
 * @param opts - Directory and filename options.
 * @returns The ready-to-use database connection.
 */
export function openDb(opts: OpenDbOptions): Database.Database {
  const path = resolveDbPath(opts);
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  runMigrations(db);
  return db;
}
