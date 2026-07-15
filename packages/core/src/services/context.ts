/**
 * The shared dependency bundle every application service reads from. Services depend only on the
 * outbound ports (never concrete adapters), so the same wiring drives production and tests.
 *
 * @packageDocumentation
 */

import type { Config, ProviderName } from "@bookr/shared";
import type { BookingProvider } from "../ports/booking-provider.ts";
import type { Clock } from "../ports/clock.ts";
import type { CredentialsProvider } from "../ports/credentials-provider.ts";
import type { Notifier } from "../ports/notifier.ts";
import type { Repository } from "../ports/repository.ts";

/** Mutable, process-lifetime state shared across services (e.g. for the health report). */
export interface RuntimeState {
  /** ISO time the most recent scan pass completed, if any. */
  lastPassAt?: string;
}

/** The dependencies and shared state passed to each application service factory. */
export interface ServiceContext {
  /** Persistence. */
  repository: Repository;
  /** Alerting. */
  notifier: Notifier;
  /** Credential and secret access. */
  credentialsProvider: CredentialsProvider;
  /** Booking providers, keyed by name. */
  providers: Map<ProviderName, BookingProvider>;
  /** Time source. */
  clock: Clock;
  /** Deployment configuration. */
  config: Config;
  /** Shared mutable runtime state. */
  runtime: RuntimeState;
}
