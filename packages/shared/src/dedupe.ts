/**
 * The canonical dedupe-key format. A slot's dedupe key is a single stable string identifying an
 * opening across scan passes; providers build it with {@link formatDedupeKey} so every provider
 * produces the same shape, and consumers recover its parts with {@link parseDedupeKey}.
 *
 * @packageDocumentation
 */

import type { ProviderName } from "./types.ts";

/** The structured parts a dedupe key is built from and parsed back into. */
export interface DedupeKeyParts {
  /** Owning provider. */
  provider: ProviderName;
  /** Provider venue id. */
  venueId: string;
  /** Reservation date, ISO `YYYY-MM-DD`, venue-local. */
  date: string;
  /** Reservation start, `"HH:MM:SS"`, venue-local. */
  start: string;
  /** Party size. */
  partySize: number;
  /** Provider seating type or config id, when present. */
  kind?: string;
}

const SEP = ":";

/**
 * Build a stable dedupe key from its parts. The start time is stored without colons so the key
 * splits unambiguously on `:`, and `kind` (which may contain arbitrary text) is always last.
 *
 * @param parts - The structured key parts.
 * @returns The dedupe key string.
 */
export function formatDedupeKey(parts: DedupeKeyParts): string {
  const compactStart = parts.start.replaceAll(":", "");
  return [parts.provider, parts.venueId, parts.date, compactStart, String(parts.partySize), parts.kind ?? ""].join(
    SEP,
  );
}

/**
 * Recover the structured parts of a dedupe key produced by {@link formatDedupeKey}.
 *
 * @param key - The dedupe key string.
 * @returns The parsed parts.
 * @throws An Error if the key is not in the expected format.
 */
export function parseDedupeKey(key: string): DedupeKeyParts {
  const segments = key.split(SEP);
  if (segments.length < 5) throw new Error(`malformed dedupe key: ${key}`);
  const [provider, venueId, date, compactStart, partySize, ...kindParts] = segments as [
    string,
    string,
    string,
    string,
    string,
    ...string[],
  ];
  const start =
    compactStart.length === 6
      ? `${compactStart.slice(0, 2)}:${compactStart.slice(2, 4)}:${compactStart.slice(4, 6)}`
      : compactStart;
  const kind = kindParts.join(SEP);
  return {
    provider: provider as ProviderName,
    venueId,
    date,
    start,
    partySize: Number(partySize),
    kind: kind.length > 0 ? kind : undefined,
  };
}

/**
 * Extract just the reservation date from a dedupe key. The leading `provider:venueId:date`
 * fields never contain the separator, so this is safe even for unusual `kind` values.
 *
 * @param key - The dedupe key string.
 * @returns The reservation date (`YYYY-MM-DD`).
 * @throws An Error if the key has no date segment.
 */
export function dedupeKeyDate(key: string): string {
  const date = key.split(SEP)[2];
  if (!date) throw new Error(`malformed dedupe key: ${key}`);
  return date;
}
