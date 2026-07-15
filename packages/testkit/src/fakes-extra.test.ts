import { describe, expect, it } from "vitest";
import type { ActivityEvent, DropEvent, SeenEntry, Session, Watch } from "@bookr/shared";
import { FakeClock } from "./fakes/clock.ts";
import { FakeCredentialsProvider } from "./fakes/credentials.ts";
import { FakeNotifier } from "./fakes/notifier.ts";
import { FakeRepository } from "./fakes/repository.ts";

describe("FakeNotifier", () => {
  it("records notifications and filters by severity", async () => {
    const n = new FakeNotifier();
    await n.notify("urgent", { title: "a", body: "b" });
    await n.notify("warning", { title: "c", body: "d" });
    expect(n.sent).toHaveLength(2);
    expect(n.bySeverity("urgent")).toEqual([{ title: "a", body: "b" }]);
  });
});

describe("FakeCredentialsProvider", () => {
  it("returns scripted credentials and secrets", async () => {
    const c = new FakeCredentialsProvider({
      credentials: { resy: { username: "u", password: "p" } },
      secrets: { apprise_key: "k" },
    });
    await c.init();
    expect(c.initialised).toBe(1);
    expect(await c.getProviderCredentials("resy")).toEqual({ username: "u", password: "p" });
    expect(await c.getProviderCredentials("opentable")).toEqual({});
    expect(await c.getSecret("apprise_key")).toBe("k");
    expect(await c.getSecret("ui_password")).toBeUndefined();
  });
});

describe("FakeRepository", () => {
  const watch = { id: "w1", provider: "resy" } as unknown as Watch;
  const session = { provider: "resy", state: "active", data: {}, updatedAt: "2026-07-13T00:00:00Z" } as Session;
  const seenAt = "2026-07-13T12:00:00.000Z";
  const entry: SeenEntry = {
    key: "resy:6194:2026-07-20:191500:2:Bar Counter",
    firstSeenAt: seenAt,
    lastSeenAt: seenAt,
  };

  it("does watch and session CRUD", () => {
    const repo = new FakeRepository();
    repo.watches.create(watch);
    expect(repo.watches.list()).toHaveLength(1);
    repo.watches.update({ ...watch, provider: "resy" });
    expect(repo.watches.get("w1")).toBeDefined();
    repo.sessions.put(session);
    expect(repo.sessions.get("resy")?.state).toBe("active");
    repo.watches.remove("w1");
    expect(repo.watches.list()).toHaveLength(0);
  });

  it("sweeps past-reservation and stale entries", () => {
    const repo = new FakeRepository();
    repo.seen.upsert(entry);
    // Same day as the reservation, within retention: kept.
    repo.seen.sweep("2026-07-20T09:00:00.000Z");
    expect(repo.seen.get(entry.key)).toBeDefined();
    // After the reservation date: dropped.
    repo.seen.sweep("2026-07-21T09:00:00.000Z");
    expect(repo.seen.get(entry.key)).toBeUndefined();
  });

  it("prunes activity older than the cutoff using the clock", () => {
    const clock = new FakeClock(new Date("2026-07-20T00:00:00.000Z"));
    const repo = new FakeRepository(clock);
    const old: ActivityEvent = { at: "2026-07-01T00:00:00.000Z", type: "pass-complete" };
    const recent: ActivityEvent = { at: "2026-07-19T00:00:00.000Z", type: "slot-found" };
    repo.activity.record(old);
    repo.activity.record(recent);
    repo.activity.prune(7);
    const kept = repo.activity.recent();
    expect(kept).toHaveLength(1);
    expect(kept[0]?.type).toBe("slot-found");
  });

  it("aggregates droplog stats into buckets", () => {
    const repo = new FakeRepository();
    const base: DropEvent = {
      venueId: "6194",
      provider: "resy",
      observedAt: seenAt,
      reservationDate: "2026-07-20",
      reservationTime: "19:00:00",
      hoursUntilReservation: 25,
      reservationDow: 1,
      observedDow: 1,
      partySize: 2,
      wasInitialRelease: false,
    };
    repo.droplog.record(base);
    repo.droplog.record({ ...base, hoursUntilReservation: 0.5 });
    const stats = repo.droplog.stats("6194");
    expect(stats.sampleCount).toBe(2);
    expect(stats.byHoursUntilBucket["24-30"]).toBe(1);
    expect(stats.byHoursUntilBucket["0-1"]).toBe(1);
    expect(stats.byHoursUntilBucket["48+"]).toBe(0);
  });
});
