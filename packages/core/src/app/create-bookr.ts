/**
 * The deployment composition root. Where {@link buildApp} wires already-constructed ports,
 * `createBookr` constructs the concrete adapters (SQLite persistence, the Resy provider, the
 * apprise notifier, and the configured credentials provider) from configuration and the
 * environment, then hands them to {@link buildApp}. This is the one place that knows about every
 * concrete adapter at once.
 *
 * @packageDocumentation
 */

import type { Config, ProviderName } from "@bookr/shared";
import type { BookingProvider } from "../ports/booking-provider.ts";
import type { BookrApp } from "../ports/bookr-app.ts";
import type { Clock } from "../ports/clock.ts";
import { createSqliteRepository } from "../adapters/persistence/sqlite-repository.ts";
import { createResyProvider } from "../adapters/providers/resy/provider.ts";
import { createCredentialsProvider } from "../adapters/credentials/factory.ts";
import { AppriseNotifier } from "../adapters/notify/apprise-notifier.ts";
import { buildApp } from "./build-app.ts";

/** A real-time {@link Clock} backed by the system clock and `setTimeout`. */
export const systemClock: Clock = {
  now: () => new Date(),
  sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** Inputs to {@link createBookr}. */
export interface CreateBookrOptions {
  /** Validated deployment configuration. */
  config: Config;
  /** The raw environment record (needed for credentials that read env directly). */
  env: Record<string, string | undefined>;
  /** Time source. Defaults to the system clock; tests may inject a fake. */
  clock?: Clock;
}

/**
 * Construct a fully wired {@link BookrApp} for production use.
 *
 * @param options - Configuration, environment, and an optional clock.
 * @returns The wired application surface.
 */
export function createBookr(options: CreateBookrOptions): BookrApp {
  const { config, env } = options;
  const clock = options.clock ?? systemClock;

  const repository = createSqliteRepository({ dataDir: config.dataDir, clock });
  const credentialsProvider = createCredentialsProvider({ config, env });
  const notifier = new AppriseNotifier({ url: config.apprise.url, key: config.apprise.key });
  const providers = new Map<ProviderName, BookingProvider>([["resy", createResyProvider({ clock })]]);

  return buildApp({ repository, notifier, credentialsProvider, providers, clock, config });
}
