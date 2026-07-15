import { describe, expect, it } from "vitest";
import {
  addDays,
  dayOfWeek,
  isWithinDateRange,
  isWithinWindow,
  resolveDateRange,
  venueLocalDate,
  zonedWallTimeToInstant,
} from "./time.ts";

describe("zonedWallTimeToInstant", () => {
  it("interprets a wall time in the given zone (EST, standard time)", () => {
    // 2026-01-15 19:00 America/New_York = 00:00 UTC next day.
    const instant = zonedWallTimeToInstant("2026-01-15", "19:00:00", "America/New_York");
    expect(instant.toISOString()).toBe("2026-01-16T00:00:00.000Z");
  });

  it("handles daylight-saving time (EDT)", () => {
    // 2026-07-15 20:00 America/New_York (EDT, UTC-4) = 00:00 UTC next day.
    const instant = zonedWallTimeToInstant("2026-07-15", "20:00:00", "America/New_York");
    expect(instant.toISOString()).toBe("2026-07-16T00:00:00.000Z");
  });

  it("accepts HH:MM without seconds", () => {
    const instant = zonedWallTimeToInstant("2026-07-15", "20:00", "America/New_York");
    expect(instant.toISOString()).toBe("2026-07-16T00:00:00.000Z");
  });
});

describe("venueLocalDate", () => {
  it("rolls the date back across a timezone boundary", () => {
    // 03:00 UTC is still the previous evening in New York.
    expect(venueLocalDate(new Date("2026-07-16T03:00:00Z"), "America/New_York")).toBe("2026-07-15");
  });
});

describe("dayOfWeek", () => {
  it("computes the weekday of a calendar date", () => {
    expect(dayOfWeek("2026-07-13")).toBe(1); // Monday
    expect(dayOfWeek("2026-07-12")).toBe(0); // Sunday
  });
});

describe("addDays", () => {
  it("advances across a month boundary", () => {
    expect(addDays("2026-07-30", 3)).toBe("2026-08-02");
  });
  it("goes backwards", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("resolveDateRange", () => {
  const now = new Date("2026-07-13T16:00:00Z"); // noon-ish New York

  it("passes a fixed range through unchanged", () => {
    expect(resolveDateRange({ start: "2026-08-01", end: "2026-08-05" }, "America/New_York", now)).toEqual({
      start: "2026-08-01",
      end: "2026-08-05",
    });
  });

  it("resolves a rolling range against venue-local today", () => {
    expect(resolveDateRange({ rollingDays: 7 }, "America/New_York", now)).toEqual({
      start: "2026-07-13",
      end: "2026-07-20",
    });
  });
});

describe("isWithinDateRange", () => {
  it("is inclusive at both ends", () => {
    const range = { start: "2026-07-13", end: "2026-07-20" };
    expect(isWithinDateRange("2026-07-13", range)).toBe(true);
    expect(isWithinDateRange("2026-07-20", range)).toBe(true);
    expect(isWithinDateRange("2026-07-21", range)).toBe(false);
    expect(isWithinDateRange("2026-07-12", range)).toBe(false);
  });
});

describe("isWithinWindow", () => {
  it("matches a normal window inclusively", () => {
    const w = { start: "18:00", end: "21:00" };
    expect(isWithinWindow("18:00:00", w)).toBe(true);
    expect(isWithinWindow("21:00:00", w)).toBe(true);
    expect(isWithinWindow("17:59:00", w)).toBe(false);
    expect(isWithinWindow("21:01:00", w)).toBe(false);
  });

  it("matches a window spanning midnight", () => {
    const w = { start: "22:00", end: "02:00" };
    expect(isWithinWindow("23:30:00", w)).toBe(true);
    expect(isWithinWindow("01:00:00", w)).toBe(true);
    expect(isWithinWindow("12:00:00", w)).toBe(false);
  });
});
