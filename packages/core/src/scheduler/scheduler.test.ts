import { describe, expect, it } from "vitest";
import { loadConfig } from "@bookr/shared";
import type { ScanReport } from "@bookr/shared";
import { FakeClock, FakeNotifier, FakeRepository } from "@bookr/testkit";
import type { ScanService } from "../services/scan.ts";
import { makeWatch } from "../test-support.ts";
import { createScheduler, type SchedulerDeps } from "./scheduler.ts";

function emptyReport(at = "2026-07-13T16:00:00.000Z"): ScanReport {
  return { startedAt: at, finishedAt: at, watchesScanned: 0, newSlots: 0, notified: 0, booked: 0, errors: [] };
}

function reportWithError(watchId: string, cls: ScanReport["errors"][number]["class"]): ScanReport {
  return { ...emptyReport(), errors: [{ watchId, class: cls, detail: "x" }] };
}

function baseDeps(scan: ScanService, over: Partial<SchedulerDeps> = {}): SchedulerDeps {
  const clock = new FakeClock(new Date("2026-07-13T16:00:00Z"));
  return {
    scan,
    repository: new FakeRepository(clock),
    notifier: new FakeNotifier(),
    clock,
    config: loadConfig({}),
    rng: () => 0.5, // centred jitter → delay equals base
    ...over,
  };
}

describe("Scheduler", () => {
  it("reports its running state across start/stop", () => {
    const scan: ScanService = { runOnce: async () => emptyReport() };
    const sched = createScheduler(baseDeps(scan));
    expect(sched.running()).toBe(false);
    sched.start();
    expect(sched.running()).toBe(true);
    sched.stop();
    expect(sched.running()).toBe(false);
  });

  it("drives passes on a jittered cadence from the clock and stops cleanly", async () => {
    let count = 0;
    const holder: { sched?: ReturnType<typeof createScheduler> } = {};
    const scan: ScanService = {
      runOnce: async () => {
        count += 1;
        if (count >= 3) holder.sched?.stop();
        return emptyReport();
      },
    };
    const clock = new FakeClock(new Date("2026-07-13T16:00:00Z"));
    const sched = createScheduler(baseDeps(scan, { clock }));
    holder.sched = sched;
    sched.start();
    await sched.drain();

    expect(count).toBe(3);
    // A sleep follows passes 1 and 2; pass 3 stops before sleeping.
    expect(clock.sleeps).toEqual([60_000, 60_000]);
  });

  it("enforces single-flight: a pass while one is running is skipped", async () => {
    let resolveFirst!: () => void;
    const gate = new Promise<void>((r) => (resolveFirst = r));
    let calls = 0;
    const scan: ScanService = {
      runOnce: async () => {
        calls += 1;
        if (calls === 1) await gate;
        return emptyReport();
      },
    };
    const sched = createScheduler(baseDeps(scan));
    const first = sched.pass();
    const second = sched.pass(); // in-flight → skipped
    await second;
    expect(calls).toBe(1);
    resolveFirst();
    await first;
    expect(calls).toBe(1);
  });

  it("backs off a venue on an error and decays on success", async () => {
    const deps = baseDeps({ runOnce: async () => emptyReport() });
    deps.repository.watches.create(makeWatch({ id: "w1", venue: { id: "v1" } }));
    const scan: ScanService = { runOnce: async () => reportWithError("w1", "rate-limited") };
    const sched = createScheduler({ ...deps, scan });

    await sched.pass();
    expect(sched.stateFor("resy", "v1")?.multiplier).toBe(2);
    await sched.pass();
    expect(sched.stateFor("resy", "v1")?.multiplier).toBe(4);
  });

  it("pauses a venue and warns once after repeated challenges", async () => {
    const deps = baseDeps({ runOnce: async () => emptyReport() });
    deps.repository.watches.create(makeWatch({ id: "w1", venue: { id: "v1" } }));
    const notifier = deps.notifier as FakeNotifier;
    const scan: ScanService = { runOnce: async () => reportWithError("w1", "challenged") };
    const sched = createScheduler({ ...deps, scan });

    await sched.pass();
    expect(sched.stateFor("resy", "v1")?.paused).toBe(false);
    await sched.pass();
    expect(sched.stateFor("resy", "v1")?.paused).toBe(true);
    await sched.pass();
    expect(notifier.bySeverity("warning")).toHaveLength(1);
  });

  it("uses the most-backed-off venue to size the next sleep", async () => {
    const deps = baseDeps({ runOnce: async () => emptyReport() });
    deps.repository.watches.create(makeWatch({ id: "w1", venue: { id: "v1" } }));
    const clock = deps.clock as FakeClock;
    let count = 0;
    const holder: { sched?: ReturnType<typeof createScheduler> } = {};
    const scan: ScanService = {
      runOnce: async () => {
        count += 1;
        if (count >= 2) holder.sched?.stop();
        return reportWithError("w1", "rate-limited");
      },
    };
    const sched = createScheduler({ ...deps, scan, clock });
    holder.sched = sched;
    sched.start();
    await sched.drain();
    // After the first errored pass the venue multiplier is 2 → next sleep = 120s (rng centred).
    expect(clock.sleeps).toEqual([120_000]);
  });
});
