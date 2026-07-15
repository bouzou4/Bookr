/**
 * Pure extraction logic for turning a browser's captured Resy network traffic into a
 * Bookr {@link Session}. Nothing here touches a browser, a socket, or the filesystem — it only
 * reads plain data structures, which is what makes it unit-testable from fixtures.
 *
 * @packageDocumentation
 */

import type { Session } from "@bookr/shared";

/** A single HTTP request observed by the browser, reduced to what extraction needs. */
export interface CapturedRequest {
  /** The request URL. */
  url: string;
  /** Request headers as sent. Keys are matched case-insensitively. */
  headers: Record<string, string>;
}

/** A single cookie read from the browser's cookie jar after login. */
export interface CapturedCookie {
  /** Cookie name. */
  name: string;
  /** Cookie value. */
  value: string;
  /** Cookie domain, when known. */
  domain?: string;
}

/** The Resy-specific session material Bookr's provider adapter expects in `Session.data`. */
export interface ResySessionData {
  /** The bearer auth token (sent as both `X-Resy-Auth-Token` and `X-Resy-Universal-Auth`). */
  token: string;
  /** The long-lived refresh cookie value (`production_refresh_token`). */
  refreshToken: string;
  /** The public web `api_key`, scraped from the `Authorization` header Resy's own client sends. */
  apiKey: string;
}

/** Raised when captured traffic doesn't contain everything a Resy session requires. */
export class SessionExtractionError extends Error {
  /**
   * @param missing - Names of the session pieces that could not be found.
   */
  constructor(public readonly missing: string[]) {
    super(`could not extract a Resy session: missing ${missing.join(", ")}`);
    this.name = "SessionExtractionError";
  }
}

const AUTH_TOKEN_HEADER = "x-resy-auth-token";
const UNIVERSAL_AUTH_HEADER = "x-resy-universal-auth";
const AUTHORIZATION_HEADER = "authorization";
const REFRESH_COOKIE_NAME = "production_refresh_token";
const API_KEY_PATTERN = /api_key="([^"]+)"/i;

/**
 * Look up a header value by name, ignoring case (browsers and proxies normalise casing
 * inconsistently, so captured requests should never be trusted to preserve it).
 *
 * @param headers - The request's header map.
 * @param name - The header name to find.
 * @returns The header value, or `undefined` if absent.
 */
function getHeader(headers: Record<string, string>, name: string): string | undefined {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === target) return value;
  }
  return undefined;
}

/**
 * Extract the public `api_key` Resy's own web client embeds in its `Authorization` header,
 * e.g. `ResyAPI api_key="VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5"`.
 *
 * @param headers - The request's header map.
 * @returns The api_key, or `undefined` if the header is absent or doesn't match the expected shape.
 */
function extractApiKey(headers: Record<string, string>): string | undefined {
  const authorization = getHeader(headers, AUTHORIZATION_HEADER);
  if (!authorization) return undefined;
  return API_KEY_PATTERN.exec(authorization)?.[1];
}

/**
 * Best-effort decode of a JWT's `exp` claim (seconds since epoch) into an ISO timestamp.
 * Resy's auth token is a standard three-segment JWT; if it isn't (or the claim is absent),
 * this quietly returns `undefined` rather than failing the whole extraction — the expiry is a
 * convenience, not something the rest of the session depends on.
 *
 * @param token - The JWT string.
 * @returns An ISO timestamp, or `undefined` if it can't be determined.
 */
function decodeJwtExpiry(token: string): string | undefined {
  try {
    const payloadSegment = token.split(".")[1];
    if (!payloadSegment) return undefined;
    const padded = payloadSegment.padEnd(payloadSegment.length + ((4 - (payloadSegment.length % 4)) % 4), "=");
    const json = Buffer.from(padded, "base64url").toString("utf8");
    const payload = JSON.parse(json) as { exp?: number };
    if (typeof payload.exp !== "number") return undefined;
    return new Date(payload.exp * 1000).toISOString();
  } catch {
    return undefined;
  }
}

/**
 * Assemble a Bookr {@link Session} for Resy from a browser's captured requests and cookies.
 *
 * Scans the captured requests for the first one carrying an `X-Resy-Auth-Token` header (only
 * present once the interactive login has completed), reads the paired `api_key` off that same
 * request's `Authorization` header, and reads the `production_refresh_token` cookie value from
 * the captured cookie jar.
 *
 * @param requests - Network requests observed while the human logged in.
 * @param cookies - Cookies read from the browser context after login.
 * @returns A `Session` with `provider: "resy"` and `state: "active"`, ready to push to ingest.
 * @throws A {@link SessionExtractionError} if the token, api_key, or refresh cookie is missing.
 */
export function extractResySession(requests: CapturedRequest[], cookies: CapturedCookie[]): Session {
  let token: string | undefined;
  let apiKey: string | undefined;

  for (const request of requests) {
    const candidateToken = getHeader(request.headers, AUTH_TOKEN_HEADER) ?? getHeader(request.headers, UNIVERSAL_AUTH_HEADER);
    if (!candidateToken) continue;
    token = candidateToken;
    apiKey = extractApiKey(request.headers);
    break;
  }

  // The api_key is public and sent on every call, including pre-login ones — fall back to any
  // request that carries it if the authenticated request somehow didn't.
  if (!apiKey) {
    for (const request of requests) {
      apiKey = extractApiKey(request.headers);
      if (apiKey) break;
    }
  }

  const refreshToken = cookies.find((cookie) => cookie.name === REFRESH_COOKIE_NAME)?.value;

  const missing: string[] = [];
  if (!token) missing.push("auth token (X-Resy-Auth-Token)");
  if (!apiKey) missing.push("api_key (Authorization header)");
  if (!refreshToken) missing.push(`refresh cookie (${REFRESH_COOKIE_NAME})`);
  if (!token || !apiKey || !refreshToken) throw new SessionExtractionError(missing);

  const data: ResySessionData = { token, apiKey, refreshToken };

  return {
    provider: "resy",
    state: "active",
    data,
    expiresAt: decodeJwtExpiry(token),
    updatedAt: new Date().toISOString(),
  };
}
