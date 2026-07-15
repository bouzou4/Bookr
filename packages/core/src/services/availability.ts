/**
 * Ad-hoc availability checks: a one-shot lookup for a provider, venue, date, and party size,
 * without creating a persistent watch. Results are filtered to the requested date and, if given, a
 * venue-local time window.
 *
 * @packageDocumentation
 */

import type { AvailabilityCheckInput, Slot, Watch } from "@bookr/shared";
import type { ServiceContext } from "./context.ts";
import { ensureLiveSession, getProvider } from "./session.ts";
import { isWithinWindow } from "./time.ts";

function syntheticWatch(query: AvailabilityCheckInput): Watch {
  return {
    id: "ad-hoc",
    provider: query.provider,
    label: "ad-hoc availability check",
    venue: { id: query.venueId },
    resourceType: "table",
    partySize: query.partySize,
    dateRange: { start: query.date, end: query.date },
    timeWindow: query.window ?? { start: "00:00", end: "23:59" },
    // The window filter and explicit date make results timezone-independent for a one-shot check.
    timezone: "UTC",
    autobook: false,
    enabled: false,
    createdAt: "",
    updatedAt: "",
  };
}

/**
 * Build the availability surface of the application.
 *
 * @param ctx - The service context.
 * @returns An object exposing `check(query)`.
 */
export function createAvailabilityService(ctx: ServiceContext): {
  check(query: AvailabilityCheckInput): Promise<Slot[]>;
} {
  return {
    check: async (query: AvailabilityCheckInput): Promise<Slot[]> => {
      const provider = getProvider(ctx, query.provider);
      const session = await ensureLiveSession(ctx, provider);
      const watch = syntheticWatch(query);
      const slots = await provider.find(watch, session);
      return slots.filter(
        (s) => s.date === query.date && (!query.window || isWithinWindow(s.start, query.window)),
      );
    },
  };
}
