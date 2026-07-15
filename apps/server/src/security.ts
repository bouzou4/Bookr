/**
 * Authentication primitives for the HTTP layer: a constant-time secret comparison, the
 * cookie-session guard for the dashboard API, and the bearer-token guard for the ingest
 * endpoint. Kept separate from routing so the comparison discipline is easy to audit.
 *
 * @packageDocumentation
 */

import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";

/**
 * Compare two secrets without leaking their content through timing. Unequal lengths short-circuit
 * to `false` (length is not itself secret here), and equal-length inputs are compared with
 * `crypto.timingSafeEqual`. An empty expected value never matches, so an unset secret locks the
 * guarded resource.
 *
 * @param expected - The configured secret. An empty string always fails.
 * @param actual - The value supplied by the caller.
 * @returns True only when both are non-empty and byte-for-byte equal.
 */
export function safeEqual(expected: string, actual: string): boolean {
  if (expected.length === 0) return false;
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(actual, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Middleware that rejects requests lacking an authenticated session with `401`. Mount it ahead
 * of every cookie-authenticated route.
 *
 * @returns The guard request handler.
 */
export function requireSession(): RequestHandler {
  return (req, res, next) => {
    if (req.session.authenticated === true) {
      next();
      return;
    }
    res.status(401).json({ error: "authentication required" });
  };
}

/**
 * Middleware guarding the ingest endpoint with a bearer token compared in constant time. This
 * path is intentionally NOT cookie-authenticated: an off-box login tool pushes sessions here
 * using only the shared token.
 *
 * @param token - The configured ingest token. When empty, all requests are rejected.
 * @returns The guard request handler.
 */
export function requireBearer(token: string): RequestHandler {
  return (req, res, next) => {
    const header = req.get("authorization") ?? "";
    const prefix = "Bearer ";
    const presented = header.startsWith(prefix) ? header.slice(prefix.length) : "";
    if (safeEqual(token, presented)) {
      next();
      return;
    }
    res.status(401).json({ error: "invalid or missing bearer token" });
  };
}
