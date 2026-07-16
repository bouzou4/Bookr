/**
 * The acceptable-seat gate: deciding whether a seat-mapped slot is worth alerting on. The gate
 * always requires a contiguous block of at least the watch's party size; *which* seats count is
 * resolved by precedence — explicit picker-drawn seats, then the per-theater cached set, then
 * zone/depth preferences, then any seat at all.
 *
 * @packageDocumentation
 */

import type { SeatMap, SeatingPreference, SeatingSummary } from "@bookr/shared";
import { depthOf, zoneOf } from "./summary.ts";

/**
 * Resolve the acceptable-seat set for a watch against a concrete layout.
 *
 * Precedence: the watch's explicit `seats` → the cached per-theater set (`cached`) → seats whose
 * position satisfies the watch's zone/depth preferences → `undefined`, meaning every seat is
 * acceptable.
 *
 * @param preference - The watch's seat preferences, if any.
 * @param map - The layout the set applies to (needed to evaluate zones/depths).
 * @param cached - The cached acceptable set for this theater + layout signature, if any.
 * @returns The acceptable seat ids, or undefined when unrestricted.
 */
export function resolveAcceptableSeats(
  preference: SeatingPreference | undefined,
  map: SeatMap,
  cached?: readonly string[],
): Set<string> | undefined {
  if (preference?.seats?.length) return new Set(preference.seats);
  if (cached?.length) return new Set(cached);
  const zones = preference?.zones;
  const depths = preference?.depths;
  if (!zones?.length && !depths?.length) return undefined;

  const acceptable = new Set<string>();
  for (const seat of map.seats) {
    if (zones?.length && !zones.includes(zoneOf(seat.column, map.columns))) continue;
    if (depths?.length && !depths.includes(depthOf(map.rows.indexOf(seat.row), map.rows.length))) continue;
    acceptable.add(seat.id);
  }
  return acceptable;
}

/**
 * Whether a (masked) summary contains a block big enough for the party.
 *
 * @param summary - A summary whose blocks were computed over available ∩ acceptable seats.
 * @param partySize - The watch's party size.
 * @returns True when some contiguous block seats the whole party.
 */
export function passesSeatingGate(summary: SeatingSummary, partySize: number): boolean {
  return summary.blocks.some((block) => block.size >= partySize);
}
