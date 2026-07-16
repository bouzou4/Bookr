/**
 * Layout signatures: a stable fingerprint of a seat map's *geometry* (never its availability),
 * used as the cache key for per-theater acceptable-seat preferences. Providers expose no
 * auditorium id, but two fetches of the same auditorium produce identical geometry — so the
 * signature identifies "the room" across showtimes, films, and occupancy states.
 *
 * @packageDocumentation
 */

import { createHash } from "node:crypto";
import type { SeatMap } from "@bookr/shared";

/**
 * Fingerprint a layout's geometry: row labels, column count, and every seat's id, position, and
 * type — but not its availability, so the signature is invariant as the room fills and empties.
 *
 * @param map - The seat map.
 * @returns A short stable hex signature.
 */
export function layoutSignature(map: SeatMap): string {
  const seats = [...map.seats]
    .sort((a, b) => a.row.localeCompare(b.row) || a.column - b.column)
    .map((s) => `${s.row}:${String(s.column)}:${s.id}:${s.type ?? ""}`);
  const canonical = `${map.rows.join(",")}|${String(map.columns)}|${seats.join(";")}`;
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}
