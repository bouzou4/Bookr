/**
 * Composition root for the `bookr` binary: loads configuration from the environment and wires a
 * {@link BookrApp} to its concrete adapters (SQLite persistence, the Resy provider, the apprise
 * notifier, and the configured credentials provider).
 *
 * @packageDocumentation
 */

import type { BookrApp } from "@bookr/core";
import { createBookr } from "@bookr/core/app";
import { loadConfig } from "@bookr/shared";

/**
 * Build the real, adapter-backed application surface for the CLI.
 *
 * @returns The wired application surface.
 */
export async function bootstrap(): Promise<BookrApp> {
  const config = loadConfig(process.env);
  const { app } = await createBookr({ config, env: process.env });
  return app;
}
