/**
 * The `better-sqlite3`-backed {@link Repository} implementation: a single database file (WAL
 * journaling, versioned migrations run on open) backing all five sub-repositories.
 *
 * @packageDocumentation
 */

import type Database from "better-sqlite3";
import type { Repository } from "../../ports/repository.ts";
import type { Clock } from "../../ports/clock.ts";
import { openDb, type OpenDbOptions } from "./db.ts";
import { createWatchesRepository } from "./watches-repository.ts";
import { createSessionsRepository } from "./sessions-repository.ts";
import { createSeenRepository } from "./seen-repository.ts";
import { createActivityRepository } from "./activity-repository.ts";
import { createDroplogRepository } from "./droplog-repository.ts";

/** The system clock, used unless a test injects a fake one. */
const systemClock: Clock = {
  now: () => new Date(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** Options for {@link createSqliteRepository}. */
export interface SqliteRepositoryOptions extends OpenDbOptions {
  /**
   * Clock used where the {@link Repository} port has no explicit reference time (currently
   * only `activity.prune`). Defaults to the system clock; tests may inject a fake one.
   */
  clock?: Clock;
}

/** A {@link Repository} backed by SQLite, plus lifecycle control over the underlying connection. */
export interface SqliteRepository extends Repository {
  /** Close the underlying database connection, flushing WAL to the main file. */
  close(): void;
  /** The underlying `better-sqlite3` connection, for advanced/administrative use. */
  readonly raw: Database.Database;
}

/**
 * Open (creating if necessary) a SQLite database under `opts.dataDir` and build the full
 * {@link Repository} surface on top of it. Enables WAL mode and applies any pending schema
 * migrations before returning.
 *
 * @param opts - Where the database lives and, optionally, which clock to use for `prune`.
 * @returns The ready-to-use repository.
 */
export function createSqliteRepository(opts: SqliteRepositoryOptions): SqliteRepository {
  const db = openDb(opts);
  const clock = opts.clock ?? systemClock;

  return {
    watches: createWatchesRepository(db),
    sessions: createSessionsRepository(db),
    seen: createSeenRepository(db),
    activity: createActivityRepository(db, clock),
    droplog: createDroplogRepository(db),
    close: () => db.close(),
    raw: db,
  };
}
