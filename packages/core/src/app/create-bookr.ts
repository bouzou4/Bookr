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
import { createAmcProvider } from "../adapters/providers/amc/provider.ts";
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
 * Application secrets resolved through the configured credentials provider (with the parsed-config
 * value as fallback), so a deployment may store them in its vault instead of the environment.
 */
export interface AppSecrets {
  /** apprise config key for outbound alerts. */
  appriseKey: string;
  /** Single-user dashboard password. */
  uiPassword: string;
  /** Bearer token guarding the session-ingest endpoint. */
  ingestToken: string;
  /** Secret signing the dashboard session cookie. */
  sessionSecret: string;
}

/** The wired application plus the resolved application secrets a host (e.g. the server) needs. */
export interface CreateBookrResult {
  /** The wired application surface. */
  app: BookrApp;
  /** Resolved application secrets. */
  secrets: AppSecrets;
}

/**
 * Construct a fully wired {@link BookrApp} for production use. Application secrets are resolved
 * through the credentials provider first (so a vault deployment can hold them), falling back to
 * the value parsed from configuration/environment.
 *
 * @param options - Configuration, environment, and an optional clock.
 * @returns The wired application and its resolved secrets.
 */
export async function createBookr(options: CreateBookrOptions): Promise<CreateBookrResult> {
  const { config, env } = options;
  const clock = options.clock ?? systemClock;

  const repository = createSqliteRepository({ dataDir: config.dataDir, clock });
  const credentialsProvider = createCredentialsProvider({ config, env });
  // Resolve up front so a vault-backed deployment fails fast if the vault is unreachable, and so
  // the notifier and server read secrets from the same place as booking credentials.
  await credentialsProvider.init();
  const secrets: AppSecrets = {
    appriseKey: (await credentialsProvider.getSecret("apprise_key")) || config.apprise.key,
    uiPassword: (await credentialsProvider.getSecret("ui_password")) || config.uiPassword,
    ingestToken: (await credentialsProvider.getSecret("ingest_token")) || config.ingestToken,
    sessionSecret: (await credentialsProvider.getSecret("session_secret")) || config.sessionSecret,
  };

  const notifier = new AppriseNotifier({ url: config.apprise.url, key: secrets.appriseKey });
  const providers = new Map<ProviderName, BookingProvider>([
    ["resy", createResyProvider({ clock })],
    ["amc", createAmcProvider({ clock })],
  ]);

  const app = buildApp({ repository, notifier, credentialsProvider, providers, clock, config });
  return { app, secrets };
}
