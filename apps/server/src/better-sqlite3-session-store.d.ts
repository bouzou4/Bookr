/**
 * Ambient type shim for `better-sqlite3-session-store`, which ships no declarations. It exposes a
 * factory that takes the `express-session` module and returns a `Store` subclass constructor.
 *
 * @packageDocumentation
 */

declare module "better-sqlite3-session-store" {
  import type expressSession from "express-session";
  import type { Store } from "express-session";

  /** Options accepted by the SQLite session store constructor. */
  interface SqliteStoreOptions {
    /** A `better-sqlite3` database instance. */
    client: unknown;
    /** Expired-row cleanup behaviour. */
    expired?: {
      /** Whether to periodically delete expired sessions. */
      clear?: boolean;
      /** Cleanup interval in milliseconds. */
      intervalMs?: number;
    };
  }

  /** Constructor for the SQLite-backed session store. */
  type SqliteStoreConstructor = new (options: SqliteStoreOptions) => Store;

  /**
   * Build a SQLite session store class bound to the given `express-session` module.
   *
   * @param session - The `express-session` module (provides the base `Store`).
   * @returns A `Store` subclass constructor.
   */
  export default function connectSqlite3(session: typeof expressSession): SqliteStoreConstructor;
}
