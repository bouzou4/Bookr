import { describe, expect, it } from "vitest";
import { loadConfig } from "@bookr/shared";
import type { ProviderName, SeatMap, Session, Slot } from "@bookr/shared";
import { layoutSignature } from "../seating/signature.ts";
import { FakeClock, FakeCredentialsProvider, FakeNotifier, FakeProvider, FakeRepository } from "@bookr/testkit";
import type { BookingProvider } from "../ports/booking-provider.ts";
import { ProviderError } from "../errors.ts";
import { makeSlot, makeWatch } from "../test-support.ts";
import type { ServiceContext } from "./context.ts";
import { createScanService } from "./scan.ts";

interface Harness {
  ctx: ServiceContext;
  clock: FakeClock;
  repo: FakeRepository;
  notifier: FakeNotifier;
  provider: FakeProvider;
}

function makeHarness(provider: BookingProvider, name: ProviderName = "resy"): Harness {
  const clock = new FakeClock(new Date("2026-07-13T16:00:00Z"));
  const repo = new FakeRepository(clock);
  const notifier = new FakeNotifier();
  const ctx: ServiceContext = {
    repository: repo,
    notifier,
    credentialsProvider: new FakeCredentialsProvider(),
    providers: new Map<ProviderName, BookingProvider>([[name, provider]]),
    clock,
    config: loadConfig({}),
    runtime: {},
  };
  return { ctx, clock, repo, notifier, provider: provider as FakeProvider };
}

describe("createScanService", () => {
  it("alerts on a new in-window slot and records the pass", async () => {
    const slot = makeSlot({ date: "2026-07-15", start: "19:00:00", kind: "Bar" });
    const { ctx, repo, notifier } = makeHarness(new FakeProvider({ slots: [slot] }));
    repo.watches.create(makeWatch());

    const report = await createScanService(ctx).runOnce();

    expect(report.newSlots).toBe(1);
    expect(report.notified).toBe(1);
    expect(report.watchesScanned).toBe(1);
    expect(report.errors).toEqual([]);
    expect(notifier.bySeverity("urgent")).toHaveLength(1);
    expect(notifier.bySeverity("urgent")[0]?.title).toContain("Test venue");

    const entry = repo.seen.get(slot.dedupeKey);
    expect(entry?.notifiedAt).toBeDefined();
    expect(repo.droplog.stats("v1").sampleCount).toBe(1);
    expect(ctx.runtime.lastPassAt).toBeDefined();
    expect(repo.activity.recent({ type: "pass-complete" })).toHaveLength(1);
  });

  it("records notify-failed and does not count a missed alert as notified", async () => {
    const slot = makeSlot({ date: "2026-07-15", start: "19:00:00" });
    const { ctx, repo, notifier } = makeHarness(new FakeProvider({ slots: [slot] }));
    notifier.failWith = "call: request failed";
    repo.watches.create(makeWatch());

    const report = await createScanService(ctx).runOnce();

    expect(report.newSlots).toBe(1); // the slot was still found
    expect(report.notified).toBe(0); // ...but the alert did not land, so it is not counted
    expect(repo.activity.recent({ type: "notified" })).toHaveLength(0);
    const failed = repo.activity.recent({ type: "notify-failed" });
    expect(failed).toHaveLength(1);
    expect(failed[0]?.detail).toContain("request failed");
  });

  it("filters slots outside the time window", async () => {
    const slot = makeSlot({ start: "12:00:00" }); // outside 18:00-21:00
    const { ctx, notifier } = makeHarness(new FakeProvider({ slots: [slot] }));
    ctx.repository.watches.create(makeWatch());

    const report = await createScanService(ctx).runOnce();
    expect(report.newSlots).toBe(0);
    expect(notifier.sent).toHaveLength(0);
  });

  it("filters slots outside the date range", async () => {
    const slot = makeSlot({ date: "2026-09-01", start: "19:00:00" });
    const { ctx } = makeHarness(new FakeProvider({ slots: [slot] }));
    ctx.repository.watches.create(makeWatch());
    const report = await createScanService(ctx).runOnce();
    expect(report.newSlots).toBe(0);
  });

  it("resolves a rolling date range against venue-local today", async () => {
    const slot = makeSlot({ date: "2026-07-14", start: "19:00:00" });
    const { ctx } = makeHarness(new FakeProvider({ slots: [slot] }));
    ctx.repository.watches.create(makeWatch({ dateRange: { rollingDays: 3 } }));
    const report = await createScanService(ctx).runOnce();
    expect(report.newSlots).toBe(1);
  });

  it("does not re-alert an unchanged slot on the next pass", async () => {
    const slot = makeSlot({ start: "19:00:00" });
    const { ctx, clock, notifier } = makeHarness(new FakeProvider({ slots: [slot] }));
    ctx.repository.watches.create(makeWatch());
    const scan = createScanService(ctx);

    await scan.runOnce();
    clock.advance(60_000);
    const second = await scan.runOnce();

    expect(second.newSlots).toBe(0);
    expect(second.notified).toBe(0);
    expect(notifier.bySeverity("urgent")).toHaveLength(1);
  });

  it("re-alerts a slot that disappeared and came back", async () => {
    const slots = [makeSlot({ start: "19:00:00" })];
    const { ctx, clock, notifier } = makeHarness(new FakeProvider({ slots }));
    ctx.repository.watches.create(makeWatch());
    const scan = createScanService(ctx);

    await scan.runOnce(); // present → alert
    clock.advance(60_000);
    slots.length = 0; // disappears
    await scan.runOnce();
    clock.advance(60_000);
    slots.push(makeSlot({ start: "19:00:00" })); // reappears
    const third = await scan.runOnce();

    expect(third.notified).toBe(1);
    expect(notifier.bySeverity("urgent")).toHaveLength(2);
  });

  it("re-alerts a reappearance even across a restart (durable, not in-memory)", async () => {
    const slots = [makeSlot({ start: "19:00:00" })];
    const { ctx, clock, notifier } = makeHarness(new FakeProvider({ slots }));
    ctx.repository.watches.create(makeWatch());

    await createScanService(ctx).runOnce(); // present → alert
    clock.advance(60_000);
    slots.length = 0; // disappears → marked absent in the repository
    await createScanService(ctx).runOnce();
    clock.advance(60_000);
    slots.push(makeSlot({ start: "19:00:00" })); // reappears
    // A brand-new scan service (as after a process restart) has no in-memory history, yet the
    // persisted disappearedAt still arms the re-alert.
    const third = await createScanService(ctx).runOnce();

    expect(third.notified).toBe(1);
    expect(notifier.bySeverity("urgent")).toHaveLength(2);
  });

  it("auto-books when the watch and provider allow it", async () => {
    const slot = makeSlot({ start: "19:00:00" });
    const provider = new FakeProvider({
      slots: [slot],
      bookResult: { status: "booked", confirmationId: "abc", deepLink: "https://x" },
    });
    const { ctx, repo } = makeHarness(provider);
    ctx.repository.watches.create(makeWatch({ autobook: true }));

    const report = await createScanService(ctx).runOnce();
    expect(report.booked).toBe(1);
    expect(repo.activity.recent({ type: "booked" })).toHaveLength(1);
  });

  it("surfaces a challenge as a warning and a pass error without calling find", async () => {
    const provider = new FakeProvider({ slots: [makeSlot()] });
    const challenged: Session = { provider: "resy", state: "challenged", data: {}, updatedAt: "" };
    provider.authenticate = async (): Promise<Session> => challenged;
    const { ctx, repo, notifier } = makeHarness(provider);
    ctx.repository.watches.create(makeWatch());

    const report = await createScanService(ctx).runOnce();
    expect(report.errors[0]?.class).toBe("challenged");
    expect(notifier.bySeverity("warning")).toHaveLength(1);
    expect(provider.calls.find).toBe(0);
    expect(repo.sessions.get("resy")?.state).toBe("challenged");
  });

  it("records a provider find failure as a pass error", async () => {
    const provider = new FakeProvider({ slots: [] });
    provider.find = async (): Promise<never> => {
      throw new ProviderError("rate-limited", "slow down");
    };
    const { ctx, repo } = makeHarness(provider);
    ctx.repository.watches.create(makeWatch());

    const report = await createScanService(ctx).runOnce();
    expect(report.errors[0]?.class).toBe("rate-limited");
    expect(repo.activity.recent({ type: "error" })).toHaveLength(1);
  });

  it("scans only enabled watches for an all-watch pass", async () => {
    const { ctx } = makeHarness(new FakeProvider({ slots: [] }));
    ctx.repository.watches.create(makeWatch({ id: "w1", enabled: true }));
    ctx.repository.watches.create(makeWatch({ id: "w2", enabled: false }));
    const report = await createScanService(ctx).runOnce();
    expect(report.watchesScanned).toBe(1);
  });

  it("scans a specific watch even when disabled", async () => {
    const { ctx } = makeHarness(new FakeProvider({ slots: [] }));
    ctx.repository.watches.create(makeWatch({ id: "w2", enabled: false }));
    const report = await createScanService(ctx).runOnce("w2");
    expect(report.watchesScanned).toBe(1);
  });

  it("reports an error when no provider is registered", async () => {
    const { ctx } = makeHarness(new FakeProvider({}));
    ctx.repository.watches.create(makeWatch({ provider: "opentable" }));
    const report = await createScanService(ctx).runOnce();
    expect(report.errors[0]?.class).toBe("other");
  });

  it("filters slots by the watch's tiers against slot.kind, case-insensitively", async () => {
    const bar = makeSlot({ kind: "Bar Counter" });
    const dining = makeSlot({ start: "20:00:00", kind: "Dining Room" });
    const { ctx, notifier } = makeHarness(new FakeProvider({ slots: [bar, dining] }));
    ctx.repository.watches.create(makeWatch({ tiers: ["dining"] }));

    const report = await createScanService(ctx).runOnce();

    expect(report.newSlots).toBe(1);
    expect(notifier.bySeverity("urgent")[0]?.body).toContain("Dining Room");
  });

  const seatMap = (available: string[]): SeatMap => ({
    rows: ["A", "B"],
    columns: 4,
    seats: (["A", "B"] as const).flatMap((row) =>
      [1, 2, 3, 4].map((column) => {
        const id = `${row}${String(column)}`;
        return { id, row, column, status: available.includes(id) ? ("available" as const) : ("taken" as const) };
      }),
    ),
  });

  const screening = (map: SeatMap): Slot =>
    makeSlot({ resourceType: "screening", kind: "Laser at AMC", seatMap: map });

  it("gates seat-mapped slots on a contiguous block for the party and alerts once seats free up", async () => {
    // Only single seats open: no block of 2 → gated out, never recorded as seen.
    const { ctx, notifier } = makeHarness(new FakeProvider({ slots: [screening(seatMap(["A1", "A3"]))] }));
    ctx.repository.watches.create(makeWatch({ resourceType: "screening" }));
    const scan = createScanService(ctx);

    const first = await scan.runOnce();
    expect(first.newSlots).toBe(0);
    expect(notifier.bySeverity("urgent")).toHaveLength(0);

    // Two adjacent seats free up → the slot appears for the first time and alerts with context.
    ctx.providers.set("resy", new FakeProvider({ slots: [screening(seatMap(["B2", "B3"]))] }));
    const second = await scan.runOnce();
    expect(second.newSlots).toBe(1);
    const alert = notifier.bySeverity("urgent")[0];
    expect(alert?.title).toContain("Seats available");
    expect(alert?.body).toContain("75% full");
    expect(alert?.body).toContain("2 adjacent, row B");
  });

  it("applies cached per-theater seat preferences via the layout signature", async () => {
    const map = seatMap(["A1", "A2", "B3", "B4"]);
    const provider = new FakeProvider({ slots: [screening(map)] });
    const { ctx, notifier } = makeHarness(provider);
    ctx.repository.watches.create(makeWatch({ resourceType: "screening" }));
    // The user's drawn seats for this auditorium: row B only. Row A's open pair must not alert.
    ctx.repository.seatPrefs.put({
      provider: "resy",
      venueId: "v1",
      layoutKey: layoutSignature(map),
      seats: ["B3", "B4"],
      updatedAt: "2026-07-13T00:00:00.000Z",
    });

    await createScanService(ctx).runOnce();

    const alert = notifier.bySeverity("urgent")[0];
    expect(alert?.body).toContain("row B");
    expect(alert?.body).not.toContain("row A");
  });

  it("drops a seat-mapped slot when the cached preference excludes every open block", async () => {
    const map = seatMap(["A1", "A2"]);
    const { ctx, notifier } = makeHarness(new FakeProvider({ slots: [screening(map)] }));
    ctx.repository.watches.create(makeWatch({ resourceType: "screening" }));
    ctx.repository.seatPrefs.put({
      provider: "resy",
      venueId: "v1",
      layoutKey: layoutSignature(map),
      seats: ["B1", "B2"],
      updatedAt: "2026-07-13T00:00:00.000Z",
    });

    const report = await createScanService(ctx).runOnce();

    expect(report.newSlots).toBe(0);
    expect(notifier.bySeverity("urgent")).toHaveLength(0);
  });
});
