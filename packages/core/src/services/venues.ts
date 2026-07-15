/**
 * Venue resolution: turning free text (a name, slug, or URL) into candidate venues for a given
 * provider, so a watch can be created against a concrete venue id.
 *
 * @packageDocumentation
 */

import type { ProviderName, VenueMatch } from "@bookr/shared";
import type { ServiceContext } from "./context.ts";
import { getProvider } from "./session.ts";

/**
 * Build the venue-resolution surface of the application.
 *
 * @param ctx - The service context.
 * @returns An object exposing `resolve(query, provider)`.
 */
export function createVenueService(ctx: ServiceContext): {
  resolve(query: string, provider: ProviderName): Promise<VenueMatch[]>;
} {
  return {
    resolve: async (query: string, provider: ProviderName): Promise<VenueMatch[]> =>
      getProvider(ctx, provider).resolveVenue(query),
  };
}
