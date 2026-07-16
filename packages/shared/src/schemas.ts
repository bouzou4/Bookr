/**
 * Runtime validation schemas (zod) for boundaries where untrusted input enters Bookr: REST
 * request bodies, CLI args, MCP tool inputs, and configuration. The types module is the
 * compile-time contract; these schemas are the runtime gate.
 *
 * @packageDocumentation
 */

import { z } from "zod";

/** Validates a supported provider name. */
export const providerNameSchema = z.enum(["resy", "sohohouse", "opentable", "amc"]);

/** Validates a resource type. */
export const resourceTypeSchema = z.enum(["table", "bedroom", "screening", "event"]);

/** Validates alert severity. */
export const severitySchema = z.enum(["urgent", "warning", "info"]);

/** Validates a horizontal seat zone. */
export const seatZoneSchema = z.enum(["left", "center", "right"]);

/** Validates a seat depth. */
export const seatDepthSchema = z.enum(["front", "middle", "back"]);

/** Validates per-watch seat preferences for assigned-seating providers. */
export const seatingPreferenceSchema = z.object({
  seats: z.array(z.string().min(1)).nonempty().optional(),
  zones: z.array(seatZoneSchema).nonempty().optional(),
  depths: z.array(seatDepthSchema).nonempty().optional(),
});

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "expected HH:MM (24h)");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

const ianaTimezone = z.string().min(1).refine(
  (tz) => {
    try {
      // Throws RangeError for an unknown IANA zone.
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  },
  { message: "invalid IANA timezone" },
);

/** Validates a fixed or rolling date range. */
export const dateRangeSchema = z.union([
  z.object({ start: isoDate, end: isoDate }),
  z.object({ rollingDays: z.number().int().positive() }),
]);

/** Validates the fields required to create a watch (server assigns id/timestamps). */
export const watchInputSchema = z.object({
  provider: providerNameSchema,
  label: z.string().min(1),
  venue: z.object({ id: z.string().min(1), slug: z.string().optional() }),
  resourceType: resourceTypeSchema.default("table"),
  item: z
    .object({ id: z.string().min(1).optional(), query: z.string().min(1).optional() })
    .refine((i) => i.id != null || i.query != null, { message: "item needs an id or a query" })
    .optional(),
  tiers: z.array(z.string().min(1)).nonempty().optional(),
  seating: seatingPreferenceSchema.optional(),
  partySize: z.number().int().min(1).max(20),
  dateRange: dateRangeSchema,
  timeWindow: z.object({ start: hhmm, end: hhmm }),
  timezone: ianaTimezone,
  autobook: z.boolean().default(false),
  enabled: z.boolean().default(true),
});

/** Parsed, validated watch-creation input. */
export type WatchInput = z.infer<typeof watchInputSchema>;

/** Validates a partial watch update. */
export const watchUpdateSchema = watchInputSchema.partial();

/** Parsed, validated watch-update input. */
export type WatchUpdate = z.infer<typeof watchUpdateSchema>;

/** Validates an ad-hoc availability check. */
export const availabilityCheckSchema = z.object({
  provider: providerNameSchema,
  venueId: z.string().min(1),
  date: isoDate,
  partySize: z.number().int().min(1).max(20),
  window: z.object({ start: hhmm, end: hhmm }).optional(),
});

/** Parsed availability-check input. */
export type AvailabilityCheckInput = z.infer<typeof availabilityCheckSchema>;

/** Validates a venue-resolve request. */
export const venueResolveSchema = z.object({
  provider: providerNameSchema,
  query: z.string().min(1),
});

/** Validates a booking request (references a slot by its dedupe key within a watch). */
export const bookRequestSchema = z.object({
  watchId: z.string().min(1),
  dedupeKey: z.string().min(1),
});

/** Validates a seat-map fetch request (provider + the provider's item reference). */
export const seatMapRequestSchema = z.object({
  provider: providerNameSchema,
  ref: z.string().min(1),
});

/** Validates a screenings-listing request (what's playing at a venue on a date). */
export const screeningsRequestSchema = z.object({
  provider: providerNameSchema,
  venueId: z.string().min(1),
  date: isoDate,
});

/** Validates a seat-preference lookup. */
export const seatPrefGetSchema = z.object({
  provider: providerNameSchema,
  venueId: z.string().min(1),
  layoutKey: z.string().min(1),
});

/** Validates a seat-preference upsert (the server stamps `updatedAt`). */
export const seatPrefPutSchema = seatPrefGetSchema.extend({
  seats: z.array(z.string().min(1)),
});

/** Validates a dashboard login. */
export const loginSchema = z.object({ password: z.string().min(1) });

/**
 * Validates a session-ingest payload. The provider blob is opaque, but it must be a non-empty
 * object: an empty or missing session would persist an "active" session carrying no credentials,
 * silently masking the challenge the handover was meant to clear.
 */
export const ingestSchema = z.object({
  session: z
    .record(z.string(), z.unknown())
    .refine((s) => Object.keys(s).length > 0, { message: "session must be a non-empty object" }),
});
