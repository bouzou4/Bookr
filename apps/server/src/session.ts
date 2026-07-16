/**
 * Session middleware wiring: an `express-session` instance backed by a SQLite store, issuing a
 * hardened `__Host-bookr.sid` cookie. The store persists across restarts so a logged-in
 * operator is not signed out by a redeploy.
 *
 * @packageDocumentation
 */

import path from "node:path";
import Database from "better-sqlite3";
import session from "express-session";
import type { RequestHandler } from "express";
import SqliteStoreFactory from "better-sqlite3-session-store";
import { sessionCookieName, type ServerConfig } from "./config.ts";

/** Fields Bookr stores on a session. */
declare module "express-session" {
  interface SessionData {
    /** True once the operator has authenticated with the dashboard password. */
    authenticated?: boolean;
  }
}

/** How long a session cookie remains valid before re-login is required (14 days). */
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/** How often the store sweeps expired session rows (1 hour). */
const STORE_PRUNE_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Build the session middleware for the given configuration. The cookie is HttpOnly, `SameSite=lax`,
 * scoped to `/`, and (by default) `Secure` — the flags the `__Host-` prefix mandates.
 *
 * @param config - Server configuration supplying the secret, cookie security, and store path.
 * @returns The configured `express-session` request handler.
 */
export function createSessionMiddleware(config: ServerConfig): RequestHandler {
  const SqliteStore = SqliteStoreFactory(session);
  const dbPath =
    config.sessionDbPath ?? path.join(config.dataDir ?? "./data", "sessions.sqlite");
  const client = new Database(dbPath);

  const store = new SqliteStore({
    client,
    expired: { clear: config.sessionPrune ?? true, intervalMs: STORE_PRUNE_INTERVAL_MS },
  });

  const cookieSecure = config.cookieSecure ?? true;
  return session({
    name: sessionCookieName(cookieSecure),
    secret: config.sessionSecret,
    store,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: cookieSecure,
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_TTL_MS,
    },
  });
}
