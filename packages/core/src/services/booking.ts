/**
 * Booking: attempting to reserve a slot, both the operator-triggered path (book a specific
 * previously-seen slot) and the shared low-level attempt reused by auto-booking during a scan.
 * Booking is capability-gated — the watch must opt in and the provider must support programmatic
 * booking — and every outcome is written to the activity log.
 *
 * @packageDocumentation
 */

import type { BookResult, Slot, Watch } from "@bookr/shared";
import type { BookingProvider } from "../ports/booking-provider.ts";
import { NotSupportedError } from "../errors.ts";
import type { ServiceContext } from "./context.ts";
import { ensureLiveSession, getProvider } from "./session.ts";

/** Thrown when a booking is requested for a watch that has not opted in to auto-booking. */
export class BookingNotAllowedError extends Error {
  /**
   * @param watchId - The watch that disallows booking.
   */
  constructor(watchId: string) {
    super(`watch ${watchId} does not permit booking (autobook is disabled)`);
    this.name = "BookingNotAllowedError";
  }
}

/**
 * Attempt to book a single slot with an already-live session, recording the outcome. Callers are
 * responsible for the capability gate; this is the shared mechanism behind manual and auto-book.
 *
 * @param ctx - The service context.
 * @param provider - The provider owning the slot.
 * @param watch - The watch the slot was found for.
 * @param slot - The slot to book.
 * @param session - An active session.
 * @returns The booking outcome.
 */
export async function attemptBook(
  ctx: ServiceContext,
  provider: BookingProvider,
  watch: Watch,
  slot: Slot,
  session: Parameters<BookingProvider["book"]>[1],
): Promise<BookResult> {
  const result = await provider.book(slot, session);
  const booked = result.status === "booked";
  // On success, persist the provider's booking handles alongside the event. They are the only
  // record of how to cancel this reservation later; dropping them would strand the cancel path.
  const data = booked
    ? {
        dedupeKey: slot.dedupeKey,
        status: result.status,
        confirmationId: result.confirmationId,
        cancelRef: result.cancelRef,
        deepLink: result.deepLink,
      }
    : { dedupeKey: slot.dedupeKey, status: result.status };
  ctx.repository.activity.record({
    at: ctx.clock.now().toISOString(),
    type: booked ? "booked" : "book-failed",
    provider: provider.name,
    watchId: watch.id,
    detail: booked ? `booked ${slot.date} ${slot.start}` : `${result.status}: ${"detail" in result ? result.detail : ""}`,
    data,
  });
  return result;
}

/**
 * Build the booking surface of the application.
 *
 * @param ctx - The service context.
 * @returns An object exposing `book(watchId, dedupeKey)`.
 */
export function createBookingService(ctx: ServiceContext): {
  book(watchId: string, dedupeKey: string): Promise<BookResult>;
} {
  return {
    book: async (watchId: string, dedupeKey: string): Promise<BookResult> => {
      const watch = ctx.repository.watches.get(watchId);
      if (!watch) throw new Error(`watch not found: ${watchId}`);
      if (!watch.autobook) throw new BookingNotAllowedError(watchId);

      const provider = getProvider(ctx, watch.provider);
      if (!provider.capabilities.autobook) {
        throw new NotSupportedError(`${provider.name} cannot book programmatically`);
      }

      const session = await ensureLiveSession(ctx, provider);
      const slots = await provider.find(watch, session);
      const slot = slots.find((s) => s.dedupeKey === dedupeKey);
      if (!slot) {
        return { status: "failed", deepLink: provider.bookingUrl(watch), detail: "slot no longer available" };
      }
      return attemptBook(ctx, provider, watch, slot, session);
    },
  };
}
