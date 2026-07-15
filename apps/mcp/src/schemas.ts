/**
 * Zod input schemas for MCP tools that have no direct equivalent in `@bookr/shared` (composite
 * shapes like "id plus a patch", or query objects). Tools with a one-to-one match to a shared
 * schema (e.g. `check_availability`, `add_watch`) use the shared schema directly instead of
 * duplicating it here.
 *
 * @packageDocumentation
 */

import { z } from "zod";
import { watchUpdateSchema } from "@bookr/shared";

/** Validates an `update_watch` call: which watch, and the fields to change. */
export const updateWatchInputSchema = z.object({
  id: z.string().min(1).describe("The id of the watch to update."),
  patch: watchUpdateSchema.describe("Fields to change; omitted fields are left as-is."),
});

/** Validates a `remove_watch` call. */
export const removeWatchInputSchema = z.object({
  id: z.string().min(1).describe("The id of the watch to remove."),
});

/** Validates an activity-event category filter (mirrors `@bookr/shared`'s `ActivityType`). */
const activityTypeSchema = z.enum([
  "slot-found",
  "notified",
  "booked",
  "book-failed",
  "auth-challenged",
  "error",
  "pass-complete",
]);

/** Validates a `get_activity` call. Both fields are optional; omit either to see everything. */
export const activityQueryInputSchema = z.object({
  limit: z
    .number()
    .int()
    .positive()
    .max(500)
    .optional()
    .describe("Maximum rows to return, newest first."),
  type: activityTypeSchema.optional().describe("Restrict to a single event type."),
});

/**
 * Validates a `book_slot` call. `confirm` is required and must be exactly `true` — the tool
 * handler refuses the booking for any other value, including a present-but-false field.
 */
export const bookSlotInputSchema = z.object({
  watchId: z.string().min(1).describe("The watch the slot belongs to."),
  dedupeKey: z
    .string()
    .min(1)
    .describe("The slot's dedupe key, as seen in check_availability or activity output."),
  confirm: z
    .boolean()
    .describe("Must be exactly true to execute the booking; anything else is refused."),
});
