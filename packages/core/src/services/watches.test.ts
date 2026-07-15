import { describe, expect, it } from "vitest";
import { loadConfig } from "@bookr/shared";
import type { ProviderName, WatchInput } from "@bookr/shared";
import { FakeClock, FakeCredentialsProvider, FakeNotifier, FakeProvider, FakeRepository } from "@bookr/testkit";
import type { BookingProvider } from "../ports/booking-provider.ts";
import type { ServiceContext } from "./context.ts";
import { createWatchService } from "./watches.ts";

function makeCtx(): ServiceContext & { clock: FakeClock } {
  const clock = new FakeClock(new Date("2026-07-13T12:00:00Z"));
  return {
    repository: new FakeRepository(clock),
    notifier: new FakeNotifier(),
    credentialsProvider: new FakeCredentialsProvider(),
    providers: new Map<ProviderName, BookingProvider>([["resy", new FakeProvider()]]),
    clock,
    config: loadConfig({}),
    runtime: {},
  };
}

const input: WatchInput = {
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
};

describe("createWatchService", () => {
  it("creates a watch with a generated id and timestamps", () => {
    const svc = createWatchService(makeCtx());
    const watch = svc.create(input);
    expect(watch.id).toBeTruthy();
    expect(watch.createdAt).toBe("2026-07-13T12:00:00.000Z");
    expect(watch.updatedAt).toBe(watch.createdAt);
    expect(svc.list()).toHaveLength(1);
    expect(svc.get(watch.id)?.label).toBe("Dinner");
  });

  it("applies a partial update and refreshes updatedAt", () => {
    const ctx = makeCtx();
    const svc = createWatchService(ctx);
    const watch = svc.create(input);
    ctx.clock.advance(1000);
    const updated = svc.update(watch.id, { label: "Lunch", partySize: 4 });
    expect(updated.label).toBe("Lunch");
    expect(updated.partySize).toBe(4);
    expect(updated.id).toBe(watch.id);
    expect(updated.updatedAt).not.toBe(watch.updatedAt);
  });

  it("toggles enabled state", () => {
    const svc = createWatchService(makeCtx());
    const watch = svc.create(input);
    expect(svc.setEnabled(watch.id, false).enabled).toBe(false);
  });

  it("removes a watch", () => {
    const svc = createWatchService(makeCtx());
    const watch = svc.create(input);
    svc.remove(watch.id);
    expect(svc.get(watch.id)).toBeUndefined();
  });

  it("throws when updating a missing watch", () => {
    const svc = createWatchService(makeCtx());
    expect(() => svc.update("nope", { label: "x" })).toThrow(/not found/);
    expect(() => svc.setEnabled("nope", true)).toThrow(/not found/);
  });
});
