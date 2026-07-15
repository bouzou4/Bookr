import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Repository } from "../../ports/repository.ts";
import type { Clock } from "../../ports/clock.ts";
import { createSqliteRepository, type SqliteRepository } from "./sqlite-repository.ts";
import { repositoryConformanceTests } from "./conformance.ts";
import { parseDedupeKey } from "./dedupe-key.ts";
import { bucketForHours, HOURS_UNTIL_BUCKETS } from "./buckets.ts";

/** A deterministic {@link Clock} test double: time only moves when set explicitly. */
class FixedClock implements Clock {
  constructor(private current: Date) {}
  now(): Date {
    return this.current;
  }
  set(date: Date): void {
    this.current = date;
  }
  async sleep(): Promise<void> {
    // Not exercised by these tests.
  }
}

describe("createSqliteRepository — conformance", () => {
  repositoryConformanceTests(() => createSqliteRepository({ dataDir: ":memory:" }), {
    teardown: (repo: Repository) => (repo as SqliteRepository).close(),
  });
});

describe("createSqliteRepository — file lifecycle", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "bookr-ws02-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates the data directory and a database file under it", () => {
    const nested = join(dir, "nested", "path");
    const repo = createSqliteRepository({ dataDir: nested });
    expect(existsSync(join(nested, "bookr.sqlite3"))).toBe(true);
    repo.close();
  });

  it("enables WAL journaling on a file-backed database", () => {
    const repo = createSqliteRepository({ dataDir: dir });
    expect(repo.raw.pragma("journal_mode", { simple: true })).toBe("wal");
    repo.close();
  });

  it("persists data across a close/reopen and does not re-run migrations", () => {
    const repo1 = createSqliteRepository({ dataDir: dir });
    repo1.watches.create({
      id: "w1",
      provider: "resy",
      label: "Persisted",
      venue: { id: "v1" },
      resourceType: "table",
      partySize: 2,
      dateRange: { start: "2026-08-01", end: "2026-08-07" },
      timeWindow: { start: "18:00", end: "21:00" },
      timezone: "America/New_York",
      autobook: false,
      enabled: true,
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    });
    const versionAfterFirstOpen = repo1.raw.pragma("user_version", { simple: true });
    repo1.close();

    const repo2 = createSqliteRepository({ dataDir: dir });
    expect(repo2.raw.pragma("user_version", { simple: true })).toBe(versionAfterFirstOpen);
    expect(repo2.watches.get("w1")?.label).toBe("Persisted");
    repo2.close();
  });

  it("supports a custom filename", () => {
    const repo = createSqliteRepository({ dataDir: dir, filename: "custom.db" });
    expect(existsSync(join(dir, "custom.db"))).toBe(true);
    repo.close();
  });
});

describe("seen.sweep — boundary behaviour", () => {
  let repo: SqliteRepository;

  beforeEach(() => {
    repo = createSqliteRepository({ dataDir: ":memory:" });
  });

  afterEach(() => {
    repo.close();
  });

  it("keeps an entry last seen exactly 14 days ago and drops one a millisecond older", () => {
    const now = new Date("2026-07-13T00:00:00.000Z");
    const exactly14 = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const over14 = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000 - 1).toISOString();

    repo.seen.upsert({ key: "resy:v1:2030-01-01:19:00:00:2:cfg", firstSeenAt: exactly14, lastSeenAt: exactly14 });
    repo.seen.upsert({ key: "resy:v2:2030-01-01:19:00:00:2:cfg", firstSeenAt: over14, lastSeenAt: over14 });

    repo.seen.sweep(now.toISOString());

    expect(repo.seen.get("resy:v1:2030-01-01:19:00:00:2:cfg")).toBeDefined();
    expect(repo.seen.get("resy:v2:2030-01-01:19:00:00:2:cfg")).toBeUndefined();
  });

  it("keeps a reservation dated today and drops one dated yesterday", () => {
    const now = new Date("2026-07-13T12:00:00.000Z");
    const recent = now.toISOString();

    repo.seen.upsert({ key: "resy:v1:2026-07-13:19:00:00:2:cfg", firstSeenAt: recent, lastSeenAt: recent });
    repo.seen.upsert({ key: "resy:v2:2026-07-12:19:00:00:2:cfg", firstSeenAt: recent, lastSeenAt: recent });

    repo.seen.sweep(now.toISOString());

    expect(repo.seen.get("resy:v1:2026-07-13:19:00:00:2:cfg")).toBeDefined();
    expect(repo.seen.get("resy:v2:2026-07-12:19:00:00:2:cfg")).toBeUndefined();
  });

  it("handles a slot that disappears then reappears across sweeps", () => {
    const key = "resy:v1:2030-06-01:19:00:00:2:cfg";
    const t1 = "2026-07-01T00:00:00.000Z";
    repo.seen.upsert({ key, firstSeenAt: t1, lastSeenAt: t1 });

    // Pass 2: slot absent from the provider response — scan engine marks it disappeared.
    const t2 = "2026-07-02T00:00:00.000Z";
    repo.seen.upsert({ key, firstSeenAt: t1, lastSeenAt: t1, disappearedAt: t2 });
    repo.seen.sweep(t2);
    expect(repo.seen.get(key)?.disappearedAt).toBe(t2);

    // Pass 3: slot reappears — scan engine clears disappearedAt and bumps lastSeenAt.
    const t3 = "2026-07-03T00:00:00.000Z";
    repo.seen.upsert({ key, firstSeenAt: t1, lastSeenAt: t3 });
    expect(repo.seen.get(key)?.disappearedAt).toBeUndefined();
    expect(repo.seen.get(key)?.lastSeenAt).toBe(t3);

    repo.seen.sweep(t3);
    expect(repo.seen.get(key)).toBeDefined();
  });

  it("markAbsent stamps only entries not seen since the cutoff and never re-stamps", () => {
    const stale = "resy:v1:2030-06-01:19:00:00:2:cfg";
    const fresh = "resy:v2:2030-06-01:19:00:00:2:cfg";
    const already = "resy:v3:2030-06-01:19:00:00:2:cfg";
    const passStart = "2026-07-02T00:00:00.000Z";
    const disappearedAt = "2026-07-02T00:01:00.000Z";

    repo.seen.upsert({ key: stale, firstSeenAt: "2026-07-01T00:00:00.000Z", lastSeenAt: "2026-07-01T00:00:00.000Z" });
    repo.seen.upsert({ key: fresh, firstSeenAt: passStart, lastSeenAt: "2026-07-02T00:00:30.000Z" });
    repo.seen.upsert({
      key: already,
      firstSeenAt: "2026-07-01T00:00:00.000Z",
      lastSeenAt: "2026-07-01T00:00:00.000Z",
      disappearedAt: "2026-06-30T00:00:00.000Z",
    });

    repo.seen.markAbsent(passStart, disappearedAt);

    expect(repo.seen.get(stale)?.disappearedAt).toBe(disappearedAt); // absent this pass → stamped
    expect(repo.seen.get(fresh)?.disappearedAt).toBeUndefined(); // observed this pass → untouched
    expect(repo.seen.get(already)?.disappearedAt).toBe("2026-06-30T00:00:00.000Z"); // already absent → not re-stamped
  });

  it("tolerates a malformed dedupe key by falling back to the age rule only", () => {
    const now = new Date("2026-07-13T00:00:00.000Z");
    const recent = now.toISOString();
    repo.seen.upsert({ key: "not-a-real-key", firstSeenAt: recent, lastSeenAt: recent });
    repo.seen.sweep(now.toISOString());
    expect(repo.seen.get("not-a-real-key")).toBeDefined();
  });
});

describe("activity.prune — cutoff boundary", () => {
  let repo: SqliteRepository;
  let clock: FixedClock;

  beforeEach(() => {
    clock = new FixedClock(new Date("2026-07-13T00:00:00.000Z"));
    repo = createSqliteRepository({ dataDir: ":memory:", clock });
  });

  afterEach(() => {
    repo.close();
  });

  it("keeps events at exactly the cutoff and prunes ones older than it", () => {
    const cutoffMs = clock.now().getTime() - 7 * 24 * 60 * 60 * 1000;
    repo.activity.record({ at: new Date(cutoffMs).toISOString(), type: "pass-complete", detail: "at-cutoff" });
    repo.activity.record({ at: new Date(cutoffMs - 1).toISOString(), type: "pass-complete", detail: "older" });
    repo.activity.record({ at: new Date(cutoffMs + 1).toISOString(), type: "pass-complete", detail: "newer" });

    repo.activity.prune(7);

    const remaining = repo.activity.recent().map((e) => e.detail);
    expect(remaining).toContain("at-cutoff");
    expect(remaining).toContain("newer");
    expect(remaining).not.toContain("older");
  });
});

describe("dedupe key parsing", () => {
  it("extracts the reservation date from a well-formed key", () => {
    expect(parseDedupeKey("resy:12345:2026-08-01:19:00:00:2:cfg-1")).toEqual({
      reservationDate: "2026-08-01",
    });
  });

  it("returns undefined for keys missing the date segment", () => {
    expect(parseDedupeKey("resy")).toBeUndefined();
    expect(parseDedupeKey("resy:12345")).toBeUndefined();
    expect(parseDedupeKey("resy:12345:not-a-date:19:00:00")).toBeUndefined();
  });
});

describe("bucketForHours", () => {
  it("maps values to the documented bucket boundaries", () => {
    expect(bucketForHours(0)).toBe("0-1");
    expect(bucketForHours(0.99)).toBe("0-1");
    expect(bucketForHours(1)).toBe("1-6");
    expect(bucketForHours(5.99)).toBe("1-6");
    expect(bucketForHours(6)).toBe("6-24");
    expect(bucketForHours(23.99)).toBe("6-24");
    expect(bucketForHours(24)).toBe("24-30");
    expect(bucketForHours(29.99)).toBe("24-30");
    expect(bucketForHours(30)).toBe("30-48");
    expect(bucketForHours(47.99)).toBe("30-48");
    expect(bucketForHours(48)).toBe("48+");
    expect(bucketForHours(500)).toBe("48+");
  });

  it("exposes the bucket labels in order", () => {
    expect(HOURS_UNTIL_BUCKETS).toEqual(["0-1", "1-6", "6-24", "24-30", "30-48", "48+"]);
  });
});

describe("sessions and droplog via the SQLite adapter directly", () => {
  let repo: SqliteRepository;

  beforeEach(() => {
    repo = createSqliteRepository({ dataDir: ":memory:" });
  });

  afterEach(() => {
    repo.close();
  });

  it("stores a session with no expiresAt and omits it on read", () => {
    repo.sessions.put({ provider: "sohohouse", state: "missing", data: null, updatedAt: "2026-07-01T00:00:00.000Z" });
    const session = repo.sessions.get("sohohouse");
    expect(session?.expiresAt).toBeUndefined();
    expect(session?.data).toBeNull();
  });

  it("aggregates droplog stats across multiple buckets for one venue and ignores others", () => {
    repo.droplog.record({
      venueId: "v1",
      provider: "resy",
      observedAt: "2026-07-01T00:00:00.000Z",
      reservationDate: "2026-07-05",
      reservationTime: "19:00:00",
      hoursUntilReservation: 40,
      reservationDow: 6,
      observedDow: 3,
      partySize: 4,
      wasInitialRelease: true,
    });
    repo.droplog.record({
      venueId: "v2",
      provider: "resy",
      observedAt: "2026-07-01T00:00:00.000Z",
      reservationDate: "2026-07-01",
      reservationTime: "20:00:00",
      hoursUntilReservation: 0.2,
      reservationDow: 2,
      observedDow: 2,
      partySize: 2,
      wasInitialRelease: true,
    });

    const stats = repo.droplog.stats("v1");
    expect(stats.sampleCount).toBe(1);
    expect(stats.byHoursUntilBucket["30-48"]).toBe(1);
    expect(stats.byHoursUntilBucket["0-1"]).toBe(0);
  });
});
