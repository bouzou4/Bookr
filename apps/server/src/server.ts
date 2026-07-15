/**
 * The application factory. {@link createServer} assembles a hardened Express app from a
 * {@link BookrApp} and {@link ServerConfig}: security headers, a SQLite-backed session, the
 * frozen `/api` router, and optional single-page-application serving. It never calls `.listen`,
 * so callers (production entry point or tests) own the transport.
 *
 * @packageDocumentation
 */

import path from "node:path";
import express, { type Express } from "express";
import helmet from "helmet";
import type { BookrApp } from "@bookr/core";
import { type ServerConfig } from "./config.ts";
import { createSessionMiddleware } from "./session.ts";
import { createApiRouter } from "./api.ts";

/** Long cache lifetime for immutable, content-hashed SPA assets (1 year, in seconds). */
const STATIC_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

/**
 * Build the configured Express application.
 *
 * The middleware order is deliberate and security-relevant: `helmet` sets defensive headers
 * first, static assets are served before the API so a stray asset never hits a route, the `/api`
 * router carries session and validation, and the SPA catch-all (mounted only when a web root is
 * configured) excludes `/api` so unmatched API paths return JSON `404`s rather than `index.html`.
 * CORS is intentionally not enabled — the dashboard is same-origin.
 *
 * @param app - The application surface the API delegates to.
 * @param config - Runtime configuration (secrets, cookie security, paths).
 * @returns A configured Express app with no listener attached.
 * @throws When {@link ServerConfig.sessionSecret} is empty.
 */
export function createServer(app: BookrApp, config: ServerConfig): Express {
  if (config.sessionSecret.length === 0) {
    throw new Error("sessionSecret must be set");
  }

  const server = express();
  server.disable("x-powered-by");
  server.set("trust proxy", config.trustProxy ?? 1);

  server.use(helmet());
  server.use(express.json());
  server.use(createSessionMiddleware(config));

  if (config.webRoot !== undefined) {
    server.use(
      express.static(config.webRoot, {
        index: false,
        immutable: true,
        maxAge: STATIC_MAX_AGE_MS,
      }),
    );
  }

  server.use("/api", createApiRouter(app, config));

  if (config.webRoot !== undefined) {
    const webRoot = config.webRoot;
    // SPA fallback for browser navigations. The negative lookahead keeps `/api/*` from ever
    // resolving to index.html so unmatched API paths surface as JSON 404s.
    server.get(/^\/(?!api(?:\/|$)).*/, (_req, res) => {
      res.sendFile(path.join(webRoot, "index.html"));
    });
  }

  return server;
}
