/**
 * Hours-until-reservation bucketing for the drop-timing logger, matching the buckets the
 * nightly drop-heuristic analysis is expected to consume: 0-1, 1-6, 6-24, 24-30, 30-48, 48+.
 *
 * @packageDocumentation
 */

/** Ordered bucket labels for `hoursUntilReservation`, from soonest to furthest out. */
export const HOURS_UNTIL_BUCKETS = ["0-1", "1-6", "6-24", "24-30", "30-48", "48+"] as const;

/** One of the fixed hours-until-reservation bucket labels. */
export type HoursUntilBucket = (typeof HOURS_UNTIL_BUCKETS)[number];

/**
 * Map an hours-until-reservation value onto its bucket label.
 *
 * @param hours - Hours between observation and reservation (non-negative).
 * @returns The bucket label the value falls into.
 */
export function bucketForHours(hours: number): HoursUntilBucket {
  if (hours < 1) return "0-1";
  if (hours < 6) return "1-6";
  if (hours < 24) return "6-24";
  if (hours < 30) return "24-30";
  if (hours < 48) return "30-48";
  return "48+";
}
