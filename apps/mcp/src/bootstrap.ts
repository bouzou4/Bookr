/**
 * Composition hook for the standalone stdio and HTTP entry points: loads configuration from the
 * environment and wires a {@link BookrApp} to its concrete adapters. An embedder that already
 * holds a `BookrApp` can call {@link createMcpServer} directly and ignore this module.
 *
 * @packageDocumentation
 */

import type { BookrApp } from "@bookr/core";
import { createBookr } from "@bookr/core/app";
import { loadConfig } from "@bookr/shared";

/**
 * Obtain the live {@link BookrApp} for the standalone entry points to serve.
 *
 * @returns The wired application surface.
 */
export function getApp(): BookrApp {
  const config = loadConfig(process.env);
  return createBookr({ config, env: process.env });
}
