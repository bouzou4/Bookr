/**
 * Venue-key helpers for the scheduler: collapsing a watch list to the distinct provider/venue
 * identities a pass backs off and sizes its cadence against.
 *
 * @packageDocumentation
 */

import type { ProviderName } from "@bookr/shared";

/** The provider/venue identity a stagger offset is assigned to. */
export interface VenueKey {
  /** Owning provider. */
  provider: ProviderName;
  /** Provider venue id. */
  venueId: string;
}

/**
 * Collapse a list of provider/venue pairs to the distinct venue keys, preserving first-seen order.
 *
 * @param venues - Provider/venue pairs (duplicates allowed).
 * @returns The distinct keys, as `"provider:venueId"` strings, in first-seen order.
 */
export function distinctVenueKeys(venues: VenueKey[]): string[] {
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const v of venues) {
    const key = `${v.provider}:${v.venueId}`;
    if (!seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}
