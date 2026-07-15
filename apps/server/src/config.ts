/**
 * Configuration accepted by {@link createServer}. These are the runtime knobs the HTTP layer
 * needs: the single-user dashboard password, the ingest bearer token, the session-cookie
 * secret, and where to keep session and static-asset state. Everything here is deployment
 * data supplied by the composition root — never hard-coded in source.
 *
 * @packageDocumentation
 */

/** Runtime configuration for the Express application returned by {@link createServer}. */
export interface ServerConfig {
  /**
   * Secret used to sign the session cookie. Must be a strong, non-empty value in production;
   * an empty secret is rejected at construction time.
   */
  sessionSecret: string;
  /**
   * The single dashboard password. Compared against the submitted password in constant time.
   * When empty, every login attempt fails (the dashboard is effectively locked).
   */
  uiPassword: string;
  /**
   * Bearer token guarding `POST /api/ingest/:provider`. Compared in constant time. When empty,
   * every ingest attempt fails.
   */
  ingestToken: string;
  /**
   * Directory in which to store the SQLite session database. Ignored when
   * {@link ServerConfig.sessionDbPath} is set. Defaults to `./data`.
   */
  dataDir?: string;
  /**
   * Explicit path to the SQLite session database file. Use `":memory:"` for ephemeral stores
   * (e.g. tests). When unset, a `sessions.sqlite` file under {@link ServerConfig.dataDir} is used.
   */
  sessionDbPath?: string;
  /**
   * Absolute path to the built single-page-application directory to serve. When unset, no
   * static assets or SPA fallback are mounted (API-only mode).
   */
  webRoot?: string;
  /**
   * Value for Express's `trust proxy` setting. Defaults to `1` (trust exactly one hop — the
   * reverse proxy that terminates TLS).
   */
  trustProxy?: number | boolean;
  /**
   * Whether the session cookie carries the `Secure` attribute. Defaults to `true`; the
   * `__Host-` cookie prefix requires it. Set to `false` only for local plaintext testing.
   */
  cookieSecure?: boolean;
  /**
   * Whether the session store periodically deletes expired rows on a background timer. Defaults
   * to `true`. Disable when the embedding process manages its own lifecycle (e.g. short-lived
   * test runs) to avoid leaving a timer open.
   */
  sessionPrune?: boolean;
}

/** Name of the single-user session cookie. The `__Host-` prefix pins it to this host over HTTPS. */
export const SESSION_COOKIE_NAME = "__Host-bookr.sid";
