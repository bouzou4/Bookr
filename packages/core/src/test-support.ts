/**
 * Small builders used only by this package's own tests to keep watch and slot fixtures terse.
 *
 * @packageDocumentation
 */

import { formatDedupeKey } from "@bookr/shared";
import type { Slot, Watch } from "@bookr/shared";

/**
 * Build a {@link Watch} with sensible defaults, overriding any fields provided.
 *
 * @param overrides - Fields to override.
 * @returns A watch.
 */
export function makeWatch(overrides: Partial<Watch> = {}): Watch {
  return {
    id: "w1",
    provider: "resy",
    label: "Test venue",
    venue: { id: "v1" },
    resourceType: "table",
    partySize: 2,
    dateRange: { start: "2026-07-13", end: "2026-07-20" },
    timeWindow: { start: "18:00", end: "21:00" },
    timezone: "America/New_York",
    autobook: false,
    enabled: true,
    createdAt: "2026-07-13T00:00:00.000Z",
    updatedAt: "2026-07-13T00:00:00.000Z",
    ...overrides,
  };
}

/**
 * Build a {@link Slot} with a computed dedupe key, overriding any fields provided.
 *
 * @param overrides - Fields to override.
 * @returns A slot.
 */
export function makeSlot(overrides: Partial<Slot> = {}): Slot {
  const base = {
    provider: "resy" as const,
    venueId: "v1",
    date: "2026-07-15",
    start: "19:00:00",
    resourceType: "table" as const,
    ...overrides,
  };
  return {
    ...base,
    dedupeKey:
      overrides.dedupeKey ??
      formatDedupeKey({
        provider: base.provider,
        venueId: base.venueId,
        date: base.date,
        start: base.start,
        partySize: 2,
        kind: base.kind,
      }),
  };
}
