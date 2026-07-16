/**
 * The application composition root for the core's own services. `buildApp` wires the injected
 * ports into the concrete application services and scheduler and returns the single `BookrApp`
 * surface every entry point (CLI, MCP, REST) calls. It contains no transport, database, or
 * provider specifics — only the assembly of pieces that each depend on ports alone.
 *
 * @packageDocumentation
 */

import type { Config, ProviderName } from "@bookr/shared";
import type { BookingProvider } from "../ports/booking-provider.ts";
import type { BookrApp } from "../ports/bookr-app.ts";
import type { Clock } from "../ports/clock.ts";
import type { CredentialsProvider } from "../ports/credentials-provider.ts";
import type { Notifier } from "../ports/notifier.ts";
import type { Repository } from "../ports/repository.ts";
import type { ServiceContext, RuntimeState } from "../services/context.ts";
import { createWatchService } from "../services/watches.ts";
import { createAvailabilityService } from "../services/availability.ts";
import { createVenueService } from "../services/venues.ts";
import { createScanService } from "../services/scan.ts";
import { createBookingService } from "../services/booking.ts";
import { createCredentialService } from "../services/credentials.ts";
import { createSeatingService } from "../services/seating.ts";
import { createActivityService } from "../services/activity.ts";
import { createHealthService } from "../services/health.ts";
import { createScheduler } from "../scheduler/scheduler.ts";

/** Everything `buildApp` needs: the outbound ports plus configuration. */
export interface BuildAppDeps {
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
}

/**
 * Assemble a {@link BookrApp} from the injected ports and configuration.
 *
 * @param deps - The outbound ports and configuration.
 * @returns The fully-wired application surface.
 */
export function buildApp(deps: BuildAppDeps): BookrApp {
  const runtime: RuntimeState = {};
  const ctx: ServiceContext = {
    repository: deps.repository,
    notifier: deps.notifier,
    credentialsProvider: deps.credentialsProvider,
    providers: deps.providers,
    clock: deps.clock,
    config: deps.config,
    runtime,
  };

  const watches = createWatchService(ctx);
  const availability = createAvailabilityService(ctx);
  const venues = createVenueService(ctx);
  const scan = createScanService(ctx);
  const booking = createBookingService(ctx);
  const credentials = createCredentialService(ctx);
  const seating = createSeatingService(ctx);
  const activity = createActivityService(ctx);
  const scheduler = createScheduler({
    scan,
    repository: deps.repository,
    notifier: deps.notifier,
    clock: deps.clock,
    config: deps.config,
  });
  const health = createHealthService(ctx, () => scheduler.running());

  return {
    watches,
    availability,
    venues,
    scan,
    booking,
    credentials,
    seating,
    activity,
    health,
    scheduler,
  };
}
