/**
 * SQLite-backed implementation of {@link SessionRepository}.
 *
 * @packageDocumentation
 */

import type Database from "better-sqlite3";
import type { ProviderName, Session, SessionState } from "@bookr/shared";
import type { SessionRepository } from "../../ports/repository.ts";

interface SessionRow {
  provider: string;
  state: string;
  data: string;
  expires_at: string | null;
  updated_at: string;
}

function rowToSession(row: SessionRow): Session {
  return {
    provider: row.provider as ProviderName,
    state: row.state as SessionState,
    data: JSON.parse(row.data) as unknown,
    expiresAt: row.expires_at ?? undefined,
    updatedAt: row.updated_at,
  };
}

/**
 * Build the SQLite-backed {@link SessionRepository}. One row per provider; `put` upserts.
 *
 * @param db - The open database connection.
 * @returns A repository backed by the `sessions` table.
 */
export function createSessionsRepository(db: Database.Database): SessionRepository {
  const getStmt = db.prepare("SELECT * FROM sessions WHERE provider = ?");
  const putStmt = db.prepare(`
    INSERT INTO sessions (provider, state, data, expires_at, updated_at)
    VALUES (@provider, @state, @data, @expires_at, @updated_at)
    ON CONFLICT(provider) DO UPDATE SET
      state = excluded.state,
      data = excluded.data,
      expires_at = excluded.expires_at,
      updated_at = excluded.updated_at
  `);

  return {
    get: (provider) => {
      const row = getStmt.get(provider) as SessionRow | undefined;
      return row ? rowToSession(row) : undefined;
    },
    put: (session) => {
      putStmt.run({
        provider: session.provider,
        state: session.state,
        data: JSON.stringify(session.data ?? null),
        expires_at: session.expiresAt ?? null,
        updated_at: session.updatedAt,
      });
    },
  };
}
