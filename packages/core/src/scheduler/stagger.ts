/**
 * Stagger planning: spreading multiple watches' passes across the base interval so same-venue
 * requests never fire simultaneously and a whole account's traffic doesn't arrive in one burst.
 * Watches sharing a venue collapse to a single group (a pass already handles a venue's watches
 * sequentially); groups are then evenly distributed across the interval.
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

/**
 * Distribute distinct venues evenly across the base interval, returning each venue's start offset
 * in milliseconds. With three venues over a 60 s interval, offsets are `0`, `20000`, `40000`.
 *
 * @param venues - Provider/venue pairs to stagger.
 * @param baseMs - The base interval in milliseconds.
 * @returns A map from `"provider:venueId"` to its offset in milliseconds.
 */
export function planStagger(venues: VenueKey[], baseMs: number): Map<string, number> {
  const keys = distinctVenueKeys(venues);
  const offsets = new Map<string, number>();
  if (keys.length === 0) return offsets;
  const step = baseMs / keys.length;
  keys.forEach((key, index) => offsets.set(key, Math.round(step * index)));
  return offsets;
}
