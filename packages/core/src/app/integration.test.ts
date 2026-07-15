import { describe, expect, it } from "vitest";
import { formatDedupeKey, loadConfig, type Slot, type WatchInput } from "@bookr/shared";
import { FakeClock, FakeCredentialsProvider, FakeNotifier, FakeProvider } from "@bookr/testkit";
import { createSqliteRepository } from "../adapters/persistence/sqlite-repository.ts";
import type { BookingProvider } from "../ports/booking-provider.ts";
import type { ProviderName } from "@bookr/shared";
import { buildApp } from "./build-app.ts";

/**
 * End-to-end wiring test: the real services + scheduler-free scan path running against the real
 * SQLite repository (in-memory), with only the provider, notifier, and credentials faked. This
 * proves the composition (`buildApp` + persistence adapter + scan service) works together, which
 * the isolated per-package suites cannot.
 */
describe("buildApp end-to-end with real persistence", () => {
  const clock = new FakeClock(new Date("2026-07-20T12:00:00.000Z"));

  const watchInput: WatchInput = {
    provider: "resy",
    label: "Carbone",
    venue: { id: "6194", slug: "carbone" },
    resourceType: "table",
    partySize: 2,
    dateRange: { rollingDays: 3 },
    timeWindow: { start: "18:00", end: "21:00" },
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
    dedupeKey: formatDedupeKey({
      provider: "resy",
      venueId: "6194",
      date: "2026-07-20",
      start: "19:15:00",
      partySize: 2,
      kind: "Bar Counter",
    }),
  };

  function build() {
    const repository = createSqliteRepository({ dataDir: ":memory:", clock });
    const notifier = new FakeNotifier();
    const provider = new FakeProvider({ slots: [slot], capabilities: { autobook: false } });
    const providers = new Map<ProviderName, BookingProvider>([["resy", provider]]);
    const credentialsProvider = new FakeCredentialsProvider({ credentials: { resy: { username: "u", password: "p" } } });
    const app = buildApp({ repository, notifier, credentialsProvider, providers, clock, config: loadConfig({}) });
    return { app, notifier, provider };
  }

  it("scans, alerts once for a new in-window slot, and dedupes on the next pass", async () => {
    const { app, notifier } = build();
    app.watches.create(watchInput);

    const first = await app.scan.runOnce();
    expect(first.watchesScanned).toBe(1);
    expect(first.newSlots).toBe(1);
    expect(first.notified).toBe(1);
    expect(notifier.bySeverity("urgent")).toHaveLength(1);

    const second = await app.scan.runOnce();
    expect(second.newSlots).toBe(0);
    expect(notifier.bySeverity("urgent")).toHaveLength(1);

    expect(app.activity.recent().some((e) => e.type === "slot-found")).toBe(true);
  });
});
