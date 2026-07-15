/**
 * Pushes a captured {@link Session} to Bookr's ingest endpoint. Kept independent of any browser
 * automation so it can be exercised in tests against a mocked HTTP layer.
 *
 * @packageDocumentation
 */

import type { ProviderName, Session } from "@bookr/shared";

/** A `fetch`-compatible function; overridable in tests to route through a mocked dispatcher. */
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Options controlling how {@link pushSession} makes its HTTP request. */
export interface PushSessionOptions {
  /** The `fetch` implementation to use. Defaults to the global `fetch`. */
  fetchImpl?: FetchLike;
}

/** Raised when the ingest endpoint rejects a pushed session. */
export class SessionPushError extends Error {
  /**
   * @param status - The HTTP status code the endpoint responded with.
   * @param body - The response body text, for diagnostics.
   */
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`ingest request failed with status ${status}: ${body}`);
    this.name = "SessionPushError";
  }
}

/**
 * POST a captured session to `{baseUrl}/api/ingest/:provider`, authenticated with the ingest
 * bearer token. This is the same endpoint Bookr's own credential-refresh flow calls into when a
 * provider session is handed over out of band.
 *
 * @param baseUrl - The base URL of the running Bookr server (e.g. `https://bookr.example.com`).
 * @param ingestToken - The shared ingest bearer token (`INGEST_TOKEN` on the server).
 * @param provider - The provider the session belongs to.
 * @param session - The session blob to hand over.
 * @param options - Optional overrides, e.g. a mocked `fetch` for tests.
 * @throws A {@link SessionPushError} if the server responds with a non-2xx status.
 */
export async function pushSession(
  baseUrl: string,
  ingestToken: string,
  provider: ProviderName,
  session: Session,
  options: PushSessionOptions = {},
): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = new URL(`/api/ingest/${provider}`, baseUrl).toString();

  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${ingestToken}`,
    },
    body: JSON.stringify({ session }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new SessionPushError(response.status, body);
  }
}
