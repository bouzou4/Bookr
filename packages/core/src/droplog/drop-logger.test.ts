import { describe, expect, it } from "vitest";
import { FakeClock, FakeRepository } from "@bookr/testkit";
import { makeSlot, makeWatch } from "../test-support.ts";
import { buildDropEvent, createDropLogger } from "./drop-logger.ts";

describe("buildDropEvent", () => {
  it("computes hours-until-reservation in venue-local time", () => {
    const watch = makeWatch({ timezone: "America/New_York" });
    const slot = makeSlot({ date: "2026-07-16", start: "20:00:00" });
    // Reservation instant = 2026-07-17T00:00:00Z; observe 24h earlier.
    const observedAt = new Date("2026-07-16T00:00:00Z");
    const event = buildDropEvent(slot, watch, observedAt);
    expect(event.hoursUntilReservation).toBeCloseTo(24, 5);
    expect(event.reservationDate).toBe("2026-07-16");
    expect(event.reservationTime).toBe("20:00:00");
    expect(event.partySize).toBe(2);
    expect(event.venueId).toBe("v1");
    expect(event.wasInitialRelease).toBe(false);
  });

  it("records both day-of-week fields", () => {
    const watch = makeWatch();
    const slot = makeSlot({ date: "2026-07-18", start: "19:00:00" }); // Saturday
    const event = buildDropEvent(slot, watch, new Date("2026-07-13T16:00:00Z")); // Monday NY
    expect(event.reservationDow).toBe(6);
    expect(event.observedDow).toBe(1);
  });
});

describe("createDropLogger", () => {
  it("records events and aggregates stats per venue", () => {
    const clock = new FakeClock(new Date("2026-07-14T16:00:00Z"));
    const repo = new FakeRepository(clock);
    const logger = createDropLogger(repo.droplog, clock);
    const watch = makeWatch();

    logger.record(makeSlot({ date: "2026-07-14", start: "20:00:00" }), watch); // hours-until in 0-6 bucket
    logger.record(makeSlot({ date: "2026-07-16", start: "20:00:00" }), watch); // 48+

    const stats = logger.stats("v1");
    expect(stats.sampleCount).toBe(2);
    expect(stats.byHoursUntilBucket["48+"]).toBe(1);
    expect(logger.stats("other").sampleCount).toBe(0);
  });
});
