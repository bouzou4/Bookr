import { describe, expect, it } from "vitest";
import {
  availabilityCheckSchema,
  bookRequestSchema,
  dateRangeSchema,
  watchInputSchema,
  watchUpdateSchema,
} from "./schemas.ts";

describe("watchInputSchema", () => {
  const valid = {
    provider: "resy",
    label: "Carbone",
    venue: { id: "6194", slug: "carbone" },
    partySize: 2,
    dateRange: { start: "2026-07-15", end: "2026-07-31" },
    timeWindow: { start: "19:00", end: "21:30" },
    timezone: "America/New_York",
  };

  it("applies defaults for resourceType/autobook/enabled", () => {
    const parsed = watchInputSchema.parse(valid);
    expect(parsed.resourceType).toBe("table");
    expect(parsed.autobook).toBe(false);
    expect(parsed.enabled).toBe(true);
  });

  it("rejects an invalid IANA timezone", () => {
    expect(() => watchInputSchema.parse({ ...valid, timezone: "Mars/Olympus" })).toThrow();
  });

  it("rejects a malformed time window", () => {
    expect(() =>
      watchInputSchema.parse({ ...valid, timeWindow: { start: "7pm", end: "21:30" } }),
    ).toThrow();
  });

  it("rejects an out-of-range party size", () => {
    expect(() => watchInputSchema.parse({ ...valid, partySize: 0 })).toThrow();
  });

  it("accepts a rolling date range", () => {
    const parsed = watchInputSchema.parse({ ...valid, dateRange: { rollingDays: 14 } });
    expect(parsed.dateRange).toEqual({ rollingDays: 14 });
  });

  it("allows partial updates", () => {
    expect(watchUpdateSchema.parse({ partySize: 4 }).partySize).toBe(4);
  });
});

describe("misc schemas", () => {
  it("validates a fixed date range", () => {
    expect(dateRangeSchema.parse({ start: "2026-01-01", end: "2026-01-02" })).toBeTruthy();
  });

  it("validates an availability check with optional window", () => {
    const parsed = availabilityCheckSchema.parse({
      provider: "resy",
      venueId: "6194",
      date: "2026-07-20",
      partySize: 2,
    });
    expect(parsed.window).toBeUndefined();
  });

  it("requires watchId and dedupeKey to book", () => {
    expect(() => bookRequestSchema.parse({ watchId: "", dedupeKey: "x" })).toThrow();
  });
});
