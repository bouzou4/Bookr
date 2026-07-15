/**
 * Composition root for the HTTP server: loads configuration from the environment, wires a
 * {@link BookrApp} to its concrete adapters, and derives the {@link ServerConfig} the HTTP layer
 * needs.
 *
 * @packageDocumentation
 */

import { createBookr } from "@bookr/core/app";
import type { BookrApp } from "@bookr/core";
import { loadConfig } from "@bookr/shared";
import type { ServerConfig } from "./config.ts";

/** The application instance and the configuration the HTTP server needs to run. */
export interface Bootstrapped {
  /** The fully-wired application surface. */
  app: BookrApp;
  /** Server configuration derived from the environment. */
  config: ServerConfig;
}

/**
 * Obtain the wired application and server configuration.
 *
 * @returns The bootstrapped application and configuration.
 */
export function bootstrap(): Bootstrapped {
  const config = loadConfig(process.env);
  const app: BookrApp = createBookr({ config, env: process.env });
  const serverConfig: ServerConfig = {
    sessionSecret: config.sessionSecret,
    uiPassword: config.uiPassword,
    ingestToken: config.ingestToken,
    dataDir: config.dataDir,
    ...(process.env.WEB_ROOT ? { webRoot: process.env.WEB_ROOT } : {}),
  };
  return { app, config: serverConfig };
}
