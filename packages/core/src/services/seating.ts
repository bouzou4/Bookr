/**
 * The seating surface of the application: on-demand seat-map fetches for the picker UI and the
 * per-theater acceptable-seat preference cache.
 *
 * @packageDocumentation
 */

import type { ProviderName, Screening, SeatMapView, SeatPrefEntry } from "@bookr/shared";
import type { BookrApp } from "../ports/bookr-app.ts";
import { ProviderError } from "../errors.ts";
import { layoutSignature } from "../seating/signature.ts";
import { summarizeSeatMap } from "../seating/summary.ts";
import type { ServiceContext } from "./context.ts";
import { ensureLiveSession, getProvider } from "./session.ts";

/**
 * Build the seating surface of the application.
 *
 * @param ctx - The service context.
 * @returns The `seating` section of {@link BookrApp}.
 */
export function createSeatingService(ctx: ServiceContext): BookrApp["seating"] {
  return {
    screenings: async (provider: ProviderName, venueId: string, date: string): Promise<Screening[]> => {
      const impl = getProvider(ctx, provider);
      if (!impl.listScreenings) {
        throw new ProviderError("other", `${provider} does not list screenings`, { retryable: false });
      }
      const session = await ensureLiveSession(ctx, impl);
      return impl.listScreenings(venueId, date, session);
    },
    map: async (provider: ProviderName, ref: string): Promise<SeatMapView> => {
      const impl = getProvider(ctx, provider);
      if (!impl.seatMap) {
        throw new ProviderError("other", `${provider} does not expose seat maps`, { retryable: false });
      }
      const session = await ensureLiveSession(ctx, impl);
      const map = await impl.seatMap(ref, session);
      return { map, signature: layoutSignature(map), summary: summarizeSeatMap(map) };
    },
    getPrefs: (provider, venueId, layoutKey) => ctx.repository.seatPrefs.get(provider, venueId, layoutKey),
    putPrefs: (provider, venueId, layoutKey, seats): SeatPrefEntry => {
      const entry: SeatPrefEntry = {
        provider,
        venueId,
        layoutKey,
        seats,
        updatedAt: ctx.clock.now().toISOString(),
      };
      ctx.repository.seatPrefs.put(entry);
      return entry;
    },
  };
}
