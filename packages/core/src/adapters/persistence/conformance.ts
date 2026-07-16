/**
 * A reusable behavioral test suite for any {@link Repository} implementation. Other
 * workstreams can run it against their own implementation (e.g. an in-memory fake) to confirm
 * it honours the same contract the SQLite adapter does, without duplicating test logic.
 *
 * @packageDocumentation
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ActivityEvent, DropEvent, Session, Watch } from "@bookr/shared";
import type { Repository } from "../../ports/repository.ts";

/** Builds a fully-formed {@link Watch} fixture, overriding only what a test cares about. */
function makeWatch(overrides: Partial<Watch> = {}): Watch {
  return {
    id: "watch-1",
    provider: "resy",
    label: "Test watch",
    venue: { id: "venue-1" },
    resourceType: "table",
    partySize: 2,
    dateRange: { start: "2026-08-01", end: "2026-08-07" },
    timeWindow: { start: "18:00", end: "21:00" },
    timezone: "America/New_York",
    autobook: false,
    enabled: true,
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

/** Options for {@link repositoryConformanceTests}. */
export interface RepositoryConformanceOptions {
  /**
   * Torn down after each test, e.g. to close a database connection. Receives the repository
   * returned by the factory passed to {@link repositoryConformanceTests}.
   *
   * @param repository - The repository instance created for the test that just ran.
   */
  teardown?: (repository: Repository) => void | Promise<void>;
}

/**
 * Register a `describe` block exercising the full {@link Repository} contract — every
 * sub-repository's CRUD surface plus the dedupe/prune/stats behavioral rules — against a
 * fresh instance built by `createRepository` for each test.
 *
 * @param createRepository - Builds a new, empty repository instance. Called before every test.
 * @param options - Optional per-test teardown.
 */
export function repositoryConformanceTests(
  createRepository: () => Repository | Promise<Repository>,
  options: RepositoryConformanceOptions = {},
): void {
  describe("Repository conformance", () => {
    let repo: Repository;

    beforeEach(async () => {
      repo = await createRepository();
    });

    afterEach(async () => {
      await options.teardown?.(repo);
    });

    describe("watches", () => {
      it("round-trips create/get/list/update/remove", () => {
        expect(repo.watches.list()).toEqual([]);

        const watch = makeWatch();
        repo.watches.create(watch);
        expect(repo.watches.get(watch.id)).toEqual(watch);
        expect(repo.watches.list()).toEqual([watch]);

        const updated: Watch = { ...watch, label: "Renamed", enabled: false };
        repo.watches.update(updated);
        expect(repo.watches.get(watch.id)).toEqual(updated);

        repo.watches.remove(watch.id);
        expect(repo.watches.get(watch.id)).toBeUndefined();
        expect(repo.watches.list()).toEqual([]);
      });

      it("preserves a rolling date range distinctly from a fixed one", () => {
        const rolling = makeWatch({ id: "watch-rolling", dateRange: { rollingDays: 14 } });
        repo.watches.create(rolling);
        expect(repo.watches.get("watch-rolling")?.dateRange).toEqual({ rollingDays: 14 });
      });

      it("round-trips item, tiers, and seating; absent fields stay absent", () => {
        const screening = makeWatch({
          id: "watch-screening",
          resourceType: "screening",
          item: { query: "odyssey" },
          tiers: ["laseratamc", "imax"],
          seating: { seats: ["F5", "F6", "F7"], zones: ["center"], depths: ["middle", "back"] },
        });
        repo.watches.create(screening);
        expect(repo.watches.get("watch-screening")).toEqual(screening);

        const bare = repo.watches.get(makeWatch().id) ?? repo.watches.create(makeWatch());
        expect(bare.item).toBeUndefined();
        expect(bare.tiers).toBeUndefined();
        expect(bare.seating).toBeUndefined();
      });

      it("returns undefined for a missing watch", () => {
        expect(repo.watches.get("nope")).toBeUndefined();
      });
    });

    describe("seatPrefs", () => {
      it("returns undefined for an unknown key and upserts on put", () => {
        expect(repo.seatPrefs.get("amc", "new-york-city/amc-34th-street-14", "sig1")).toBeUndefined();

        repo.seatPrefs.put({
          provider: "amc",
          venueId: "new-york-city/amc-34th-street-14",
          layoutKey: "sig1",
          seats: ["F5", "F6"],
          updatedAt: "2026-07-15T00:00:00.000Z",
        });
        expect(repo.seatPrefs.get("amc", "new-york-city/amc-34th-street-14", "sig1")?.seats).toEqual(["F5", "F6"]);

        repo.seatPrefs.put({
          provider: "amc",
          venueId: "new-york-city/amc-34th-street-14",
          layoutKey: "sig1",
          seats: ["G1"],
          updatedAt: "2026-07-16T00:00:00.000Z",
        });
        const updated = repo.seatPrefs.get("amc", "new-york-city/amc-34th-street-14", "sig1");
        expect(updated?.seats).toEqual(["G1"]);
        expect(updated?.updatedAt).toBe("2026-07-16T00:00:00.000Z");

        // Distinct layout keys are distinct auditoriums.
        expect(repo.seatPrefs.get("amc", "new-york-city/amc-34th-street-14", "sig2")).toBeUndefined();
      });
    });

    describe("sessions", () => {
      it("returns undefined before any session is stored", () => {
        expect(repo.sessions.get("resy")).toBeUndefined();
      });

      it("upserts on put", () => {
        const session: Session = {
          provider: "resy",
          state: "active",
          data: { token: "abc" },
          updatedAt: "2026-07-01T00:00:00.000Z",
        };
        repo.sessions.put(session);
        expect(repo.sessions.get("resy")).toEqual(session);

        const refreshed: Session = { ...session, state: "expired", updatedAt: "2026-07-02T00:00:00.000Z" };
        repo.sessions.put(refreshed);
        expect(repo.sessions.get("resy")).toEqual(refreshed);
      });
    });

    describe("seen", () => {
      it("returns undefined for an unknown key", () => {
        expect(repo.seen.get("resy:v1:2026-08-01:19:00:00:2:cfg")).toBeUndefined();
      });

      it("round-trips an entry and supports the disappear/reappear cycle", () => {
        const key = "resy:v1:2026-08-01:19:00:00:2:cfg";
        repo.seen.upsert({ key, firstSeenAt: "2026-07-01T00:00:00.000Z", lastSeenAt: "2026-07-01T00:00:00.000Z" });
        expect(repo.seen.get(key)?.disappearedAt).toBeUndefined();

        repo.seen.upsert({
          key,
          firstSeenAt: "2026-07-01T00:00:00.000Z",
          lastSeenAt: "2026-07-01T00:05:00.000Z",
          disappearedAt: "2026-07-01T00:05:00.000Z",
        });
        expect(repo.seen.get(key)?.disappearedAt).toBe("2026-07-01T00:05:00.000Z");

        // Reappearance: a fresh upsert without disappearedAt must clear the earlier value.
        repo.seen.upsert({
          key,
          firstSeenAt: "2026-07-01T00:00:00.000Z",
          lastSeenAt: "2026-07-02T00:00:00.000Z",
        });
        expect(repo.seen.get(key)?.disappearedAt).toBeUndefined();
        expect(repo.seen.get(key)?.lastSeenAt).toBe("2026-07-02T00:00:00.000Z");
      });

      it("sweep drops entries whose reservation date has passed", () => {
        const pastKey = "resy:v1:2020-01-01:19:00:00:2:cfg";
        const futureKey = "resy:v1:2030-01-01:19:00:00:2:cfg";
        repo.seen.upsert({ key: pastKey, firstSeenAt: "2026-07-01T00:00:00.000Z", lastSeenAt: "2026-07-01T00:00:00.000Z" });
        repo.seen.upsert({ key: futureKey, firstSeenAt: "2026-07-01T00:00:00.000Z", lastSeenAt: "2026-07-01T00:00:00.000Z" });

        repo.seen.sweep("2026-07-13T00:00:00.000Z");

        expect(repo.seen.get(pastKey)).toBeUndefined();
        expect(repo.seen.get(futureKey)).toBeDefined();
      });
    });

    describe("activity", () => {
      it("records and lists newest-first, honouring type filter and limit", () => {
        const events: ActivityEvent[] = [
          { at: "2026-07-01T00:00:00.000Z", type: "slot-found", detail: "first" },
          { at: "2026-07-02T00:00:00.000Z", type: "notified", detail: "second" },
          { at: "2026-07-03T00:00:00.000Z", type: "slot-found", detail: "third" },
        ];
        for (const e of events) repo.activity.record(e);

        const recent = repo.activity.recent();
        expect(recent.map((e) => e.detail)).toEqual(["third", "second", "first"]);

        const onlySlotFound = repo.activity.recent({ type: "slot-found" });
        expect(onlySlotFound.map((e) => e.detail)).toEqual(["third", "first"]);

        expect(repo.activity.recent({ limit: 1 }).map((e) => e.detail)).toEqual(["third"]);
      });

      it("prune removes events older than the cutoff and keeps the rest", () => {
        repo.activity.record({ at: new Date().toISOString(), type: "pass-complete", detail: "recent" });

        // A cutoff far in the future considers every existing event "old" regardless of the
        // implementation's own notion of "now".
        repo.activity.prune(-365);
        expect(repo.activity.recent()).toEqual([]);

        repo.activity.record({ at: new Date().toISOString(), type: "pass-complete", detail: "still here" });
        // A cutoff far in the past keeps everything.
        repo.activity.prune(365000);
        expect(repo.activity.recent()).toHaveLength(1);
      });
    });

    describe("droplog", () => {
      it("aggregates recorded events into hours-until buckets", () => {
        const base: Omit<DropEvent, "hoursUntilReservation"> = {
          venueId: "venue-1",
          provider: "resy",
          observedAt: "2026-07-01T00:00:00.000Z",
          reservationDate: "2026-07-02",
          reservationTime: "19:00:00",
          reservationDow: 4,
          observedDow: 3,
          partySize: 2,
          wasInitialRelease: false,
        };
        repo.droplog.record({ ...base, hoursUntilReservation: 0.5 });
        repo.droplog.record({ ...base, hoursUntilReservation: 3 });
        repo.droplog.record({ ...base, hoursUntilReservation: 3 });

        const stats = repo.droplog.stats("venue-1");
        expect(stats.venueId).toBe("venue-1");
        expect(stats.sampleCount).toBe(3);
        expect(stats.byHoursUntilBucket["0-1"]).toBe(1);
        expect(stats.byHoursUntilBucket["1-6"]).toBe(2);
      });

      it("reports an empty aggregate for a venue with no observations", () => {
        const stats = repo.droplog.stats("unknown-venue");
        expect(stats.sampleCount).toBe(0);
        expect(stats.byHoursUntilBucket["0-1"]).toBe(0);
      });
    });
  });
}
