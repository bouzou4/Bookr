import { describe, expect, it } from "vitest";
import { loadConfig } from "@bookr/shared";
import type { ProviderName } from "@bookr/shared";
import { FakeClock, FakeCredentialsProvider, FakeNotifier, FakeProvider, FakeRepository } from "@bookr/testkit";
import type { BookingProvider } from "../ports/booking-provider.ts";
import { BookingNotAllowedError } from "../services/booking.ts";
import { makeSlot, makeWatch } from "../test-support.ts";
import { buildApp, type BuildAppDeps } from "./build-app.ts";

function makeDeps(provider = new FakeProvider()): BuildAppDeps {
  const clock = new FakeClock(new Date("2026-07-13T16:00:00Z"));
  return {
    repository: new FakeRepository(clock),
    notifier: new FakeNotifier(),
    credentialsProvider: new FakeCredentialsProvider(),
    providers: new Map<ProviderName, BookingProvider>([["resy", provider]]),
    clock,
    config: loadConfig({}),
  };
}

describe("buildApp", () => {
  it("wires watch CRUD", () => {
    const app = buildApp(makeDeps());
    const created = app.watches.create({
      provider: "resy",
      label: "Dinner",
      venue: { id: "v1" },
      resourceType: "table",
      partySize: 2,
      dateRange: { rollingDays: 7 },
      timeWindow: { start: "18:00", end: "21:00" },
      timezone: "America/New_York",
      autobook: false,
      enabled: true,
    });
    expect(app.watches.list()).toHaveLength(1);
    expect(app.watches.get(created.id)).toBeDefined();
  });

  it("checks ad-hoc availability, filtering by date and window", async () => {
    const provider = new FakeProvider({
      slots: [makeSlot({ date: "2026-08-01", start: "19:00:00" }), makeSlot({ date: "2026-08-01", start: "12:00:00" })],
    });
    const app = buildApp(makeDeps(provider));
    const slots = await app.availability.check({
      provider: "resy",
      venueId: "v1",
      date: "2026-08-01",
      partySize: 2,
      window: { start: "18:00", end: "22:00" },
    });
    expect(slots).toHaveLength(1);
    expect(slots[0]?.start).toBe("19:00:00");
  });

  it("resolves venues through the provider", async () => {
    const provider = new FakeProvider({ venues: [{ provider: "resy", id: "v1", name: "Test" }] });
    const app = buildApp(makeDeps(provider));
    const matches = await app.venues.resolve("test", "resy");
    expect(matches[0]?.id).toBe("v1");
  });

  it("gates manual booking on the watch opting in", async () => {
    const deps = makeDeps();
    const app = buildApp(deps);
    deps.repository.watches.create(makeWatch({ id: "w1", autobook: false }));
    await expect(app.booking.book("w1", "any")).rejects.toBeInstanceOf(BookingNotAllowedError);
  });

  it("books a matching slot for an opted-in watch", async () => {
    const slot = makeSlot({ start: "19:00:00" });
    const provider = new FakeProvider({
      slots: [slot],
      bookResult: { status: "booked", confirmationId: "c1", deepLink: "https://x" },
    });
    const deps = makeDeps(provider);
    const app = buildApp(deps);
    deps.repository.watches.create(makeWatch({ id: "w1", autobook: true }));
    const result = await app.booking.book("w1", slot.dedupeKey);
    expect(result.status).toBe("booked");
  });

  it("returns a failed result when the booked slot is gone", async () => {
    const deps = makeDeps(new FakeProvider({ slots: [] }));
    const app = buildApp(deps);
    deps.repository.watches.create(makeWatch({ id: "w1", autobook: true }));
    const result = await app.booking.book("w1", "missing-key");
    expect(result.status).toBe("failed");
  });

  it("reports and ingests credential sessions", async () => {
    const deps = makeDeps();
    const app = buildApp(deps);
    let status = await app.credentials.status();
    expect(status[0]?.sessionState).toBe("missing");
    expect(status[0]?.needsAttention).toBe(true);

    await app.credentials.ingestSession("resy", { token: "x" });
    status = await app.credentials.status();
    expect(status[0]?.sessionState).toBe("active");
    expect(status[0]?.needsAttention).toBe(false);
    expect(app.activity.recent({ type: "session-ingested" })).toHaveLength(1);
  });

  it("reports health reflecting sessions and scheduler state", async () => {
    const deps = makeDeps();
    const app = buildApp(deps);
    expect(app.health.status().ok).toBe(false); // session missing
    await app.credentials.ingestSession("resy", {});
    const health = app.health.status();
    expect(health.ok).toBe(true);
    expect(health.schedulerRunning).toBe(false);
    expect(health.providers[0]?.provider).toBe("resy");
  });

  it("exposes activity newest-first", async () => {
    const slot = makeSlot({ start: "19:00:00" });
    const deps = makeDeps(new FakeProvider({ slots: [slot] }));
    const app = buildApp(deps);
    deps.repository.watches.create(makeWatch({ id: "w1" }));
    await app.scan.runOnce();
    expect(app.activity.recent({ limit: 1 })[0]?.type).toBe("pass-complete");
  });

  it("controls the scheduler lifecycle", () => {
    const app = buildApp(makeDeps());
    expect(app.scheduler.running()).toBe(false);
    app.scheduler.start();
    expect(app.scheduler.running()).toBe(true);
    app.scheduler.stop();
    expect(app.scheduler.running()).toBe(false);
  });
});
