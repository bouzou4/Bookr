/**
 * Parsing helpers for the slot dedupe key format, a colon-joined string of provider, venue id,
 * reservation date, start time, party size, and a config id or kind. The reservation date is
 * not stored as its own column on {@link SeenEntry}; it is recovered from the key itself so
 * `seen.sweep` can drop entries for reservations that have already passed.
 *
 * @packageDocumentation
 */

/** The reservation date recovered from a dedupe key, when the key is well-formed. */
export interface ParsedDedupeKey {
  /** The ISO `YYYY-MM-DD` reservation date segment. */
  reservationDate: string;
}

const dedupeKeyPattern = /^[^:]+:[^:]+:(\d{4}-\d{2}-\d{2}):/;

/**
 * Extract the reservation date segment from a dedupe key.
 *
 * @param key - A dedupe key in the `"<provider>:<venueId>:<date>:…"` format.
 * @returns The parsed reservation date, or `undefined` if the key does not match the expected
 * shape (defensively tolerated so a malformed key never breaks the sweep).
 */
export function parseDedupeKey(key: string): ParsedDedupeKey | undefined {
  const match = dedupeKeyPattern.exec(key);
  if (!match) return undefined;
  const reservationDate = match[1];
  if (!reservationDate) return undefined;
  return { reservationDate };
}
