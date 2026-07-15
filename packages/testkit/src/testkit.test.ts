import { describe, expect, it } from "vitest";
import type { Slot, Watch, WatchInput } from "@bookr/shared";
import { createFakeBookr, FakeClock, FakeProvider } from "./index.ts";

const watchInput: WatchInput = {
  provider: "resy",
  label: "Carbone",
  venue: { id: "6194", slug: "carbone" },
  resourceType: "table",
  partySize: 2,
  dateRange: { start: "2026-07-15", end: "2026-07-31" },
  timeWindow: { start: "19:00", end: "21:30" },
  timezone: "America/New_York",
  autobook: false,
  enabled: true,
};

const slot: Slot = {
  provider: "resy",
  venueId: "6194",
  date: "2026-07-20",
  start: "19:15:00",
  resourceType: "table",
  kind: "Bar Counter",
  dedupeKey: "resy:6194:2026-07-20:19:15:00:2:Bar Counter",
};

describe("FakeClock", () => {
  it("advances only on sleep/advance and records sleeps", async () => {
    const clock = new FakeClock(new Date("2026-01-01T00:00:00.000Z"));
    await clock.sleep(1000);
    clock.advance(500);
    expect(clock.sleeps).toEqual([1000]);
    expect(clock.now().toISOString()).toBe("2026-01-01T00:00:01.500Z");
  });
});

describe("FakeProvider", () => {
  it("returns scripted slots/venues and counts calls", async () => {
    const provider = new FakeProvider({ slots: [slot], venues: [] });
    const session = await provider.authenticate({});
    await provider.refresh(session, {});
    expect(await provider.find({} as Watch, session)).toEqual([slot]);
    await provider.resolveVenue("carbone");
    expect(provider.calls).toEqual({ authenticate: 1, refresh: 1, find: 1, book: 0, cancel: 0, resolveVenue: 1 });
    expect(provider.classifyError(new Error("x"))).toBe("other");
    expect(provider.bookingUrl({ venue: { id: "6194" } } as Watch, slot)).toContain("6194");
  });

  it("books when capable and throws otherwise", async () => {
    const capable = new FakeProvider({ bookResult: { status: "booked", confirmationId: "c1", deepLink: "u" } });
    const session = await capable.authenticate({});
    expect((await capable.book(slot, session)).status).toBe("booked");

    const incapable = new FakeProvider({ capabilities: { autobook: false } });
    await expect(incapable.book(slot, session)).rejects.toThrow(/cannot auto-book/);
  });

  it("cancels when capable, records the cancelRef, and throws otherwise", async () => {
    const capable = new FakeProvider();
    const session = await capable.authenticate({});
    await capable.cancel("cancel-ref-1", session);
    expect(capable.calls.cancel).toBe(1);
    expect(capable.lastCancelRef).toBe("cancel-ref-1");

    const incapable = new FakeProvider({ capabilities: { autobook: false } });
    await expect(incapable.cancel("cancel-ref-1", session)).rejects.toThrow(/cannot cancel/);
  });

  it("surfaces a configured cancelError", async () => {
    const provider = new FakeProvider({ cancelError: new Error("boom") });
    const session = await provider.authenticate({});
    await expect(provider.cancel("cancel-ref-1", session)).rejects.toThrow("boom");
  });
});

describe("createFakeBookr", () => {
  it("does watch CRUD", () => {
    const app = createFakeBookr();
    const created = app.watches.create(watchInput);
    expect(app.watches.list()).toHaveLength(1);
    expect(app.watches.get(created.id)?.label).toBe("Carbone");

    const updated = app.watches.update(created.id, { partySize: 4 });
    expect(updated.partySize).toBe(4);
    expect(app.watches.setEnabled(created.id, false).enabled).toBe(false);

    app.watches.remove(created.id);
    expect(app.watches.list()).toHaveLength(0);
  });

  it("serves seeded reads and reports a scan", async () => {
    const app = createFakeBookr({ slots: [slot], credentialStatus: [] });
    app.watches.create(watchInput);
    expect(await app.availability.check({ provider: "resy", venueId: "6194", date: "2026-07-20", partySize: 2 })).toHaveLength(1);
    expect(await app.venues.resolve("carbone", "resy")).toEqual([]);

    const report = await app.scan.runOnce();
    expect(report.watchesScanned).toBe(1);
    expect(report.newSlots).toBe(1);
    expect(app.activity.recent({ limit: 5 }).length).toBeGreaterThan(0);
    expect(app.activity.recent({ type: "pass-complete" })).toHaveLength(1);
  });

  it("books, ingests, and toggles the scheduler", async () => {
    const app = createFakeBookr({ bookResult: { status: "booked", confirmationId: "c1", deepLink: "u" } });
    expect((await app.booking.book("w", "k")).status).toBe("booked");
    await app.credentials.ingestSession("resy", { token: "x" });
    expect(await app.credentials.status()).toEqual([]);

    expect(app.scheduler.running()).toBe(false);
    app.scheduler.start();
    expect(app.scheduler.running()).toBe(true);
    expect(app.health.status().schedulerRunning).toBe(true);
    app.scheduler.stop();
    expect(app.scheduler.running()).toBe(false);
  });

  it("throws updating a missing watch", () => {
    const app = createFakeBookr();
    expect(() => app.watches.update("nope", {})).toThrow(/not found/);
  });
});
