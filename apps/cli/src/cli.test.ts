import { describe, expect, it } from "vitest";
import { createFakeBookr } from "@bookr/testkit";
import type { BookrApp } from "@bookr/core";
import type { Slot, VenueMatch, Watch } from "@bookr/shared";
import { createCli, runCli } from "./cli.ts";
import { EXIT_CODES } from "./exit-codes.ts";
import { captureIo } from "./test-support.ts";

const NOW = new Date().toISOString();

const WATCH: Watch = {
  id: "w1",
  provider: "resy",
  label: "Test Bistro",
  venue: { id: "123", slug: "test-bistro" },
  resourceType: "table",
  partySize: 2,
  dateRange: { rollingDays: 7 },
  timeWindow: { start: "18:00", end: "21:00" },
  timezone: "America/New_York",
  autobook: false,
  enabled: true,
  createdAt: NOW,
  updatedAt: NOW,
};

const SLOT: Slot = {
  provider: "resy",
  venueId: "123",
  date: "2026-07-20",
  start: "19:00:00",
  resourceType: "table",
  kind: "Bar Counter",
  exclusive: false,
  dedupeKey: "resy:123:2026-07-20:190000:2:Bar Counter",
};

const VENUE_MATCH: VenueMatch = {
  provider: "resy",
  id: "123",
  slug: "test-bistro",
  name: "Test Bistro",
  city: "New York",
};

describe("createCli", () => {
  it("builds a program named bookr with a --json option", () => {
    const io = captureIo();
    const program = createCli(createFakeBookr(), io);
    expect(program.name()).toBe("bookr");
    expect(program.options.some((o) => o.long === "--json")).toBe(true);
  });

  it("can be parsed directly (not just via runCli)", async () => {
    const io = captureIo();
    const program = createCli(createFakeBookr({ watches: [WATCH] }), io);
    await program.parseAsync(["watch", "list"], { from: "user" });
    expect(io.out()).toContain("w1");
  });
});

describe("bookr scan", () => {
  it("reports zero watches scanned with an empty app", async () => {
    const io = captureIo();
    const code = await runCli(createFakeBookr(), ["scan"], io);
    expect(code).toBe(EXIT_CODES.ok);
    expect(io.out()).toMatch(/watchesScanned\s+0/);
  });

  it("scans a single watch by id", async () => {
    const io = captureIo();
    const code = await runCli(createFakeBookr({ watches: [WATCH] }), ["scan", "--watch", "w1"], io);
    expect(code).toBe(EXIT_CODES.ok);
    expect(io.out()).toMatch(/watchesScanned\s+1/);
  });

  it("counts seeded slots as new/notified", async () => {
    const io = captureIo();
    const code = await runCli(createFakeBookr({ watches: [WATCH], slots: [SLOT] }), ["scan"], io);
    expect(code).toBe(EXIT_CODES.ok);
    expect(io.out()).toMatch(/newSlots\s+1/);
    expect(io.out()).toMatch(/notified\s+1/);
  });

  it("emits JSON when --json is passed", async () => {
    const io = captureIo();
    const code = await runCli(createFakeBookr({ watches: [WATCH] }), ["--json", "scan"], io);
    expect(code).toBe(EXIT_CODES.ok);
    const parsed = JSON.parse(io.out()) as { watchesScanned: number };
    expect(parsed.watchesScanned).toBe(1);
  });

  it("exits non-zero and prints an error table when the pass reports errors", async () => {
    const io = captureIo();
    const app: BookrApp = {
      ...createFakeBookr(),
      scan: {
        runOnce: async () => ({
          startedAt: NOW,
          finishedAt: NOW,
          watchesScanned: 1,
          newSlots: 0,
          notified: 0,
          booked: 0,
          errors: [{ watchId: "w1", class: "rate-limited", detail: "backing off" }],
        }),
      },
    };
    const code = await runCli(app, ["scan"], io);
    expect(code).toBe(EXIT_CODES.error);
    expect(io.out()).toContain("rate-limited");
    expect(io.out()).toContain("backing off");
  });

  it("reports a thrown scan error as exit code 1", async () => {
    const io = captureIo();
    const app: BookrApp = {
      ...createFakeBookr(),
      scan: {
        runOnce: async () => {
          throw new Error("boom");
        },
      },
    };
    const code = await runCli(app, ["scan"], io);
    expect(code).toBe(EXIT_CODES.error);
    expect(io.err()).toContain("boom");
  });
});

describe("bookr check", () => {
  it("prints matching slots as a table", async () => {
    const io = captureIo();
    const code = await runCli(createFakeBookr({ slots: [SLOT] }), ["check", "123", "2026-07-20", "2"], io);
    expect(code).toBe(EXIT_CODES.ok);
    expect(io.out()).toContain("Bar Counter");
    expect(io.out()).toContain(SLOT.dedupeKey);
  });

  it("prints an empty-table placeholder when nothing matches", async () => {
    const io = captureIo();
    const code = await runCli(createFakeBookr(), ["check", "123", "2026-07-20", "2"], io);
    expect(code).toBe(EXIT_CODES.ok);
    expect(io.out().trim()).toBe("(none)");
  });

  it("accepts --window and --provider and emits JSON", async () => {
    const io = captureIo();
    const code = await runCli(
      createFakeBookr({ slots: [SLOT] }),
      ["--json", "check", "123", "2026-07-20", "2", "--window", "18:00-21:00", "--provider", "resy"],
      io,
    );
    expect(code).toBe(EXIT_CODES.ok);
    const parsed = JSON.parse(io.out()) as Slot[];
    expect(parsed).toHaveLength(1);
  });

  it("rejects a malformed date with exit code 2", async () => {
    const io = captureIo();
    const code = await runCli(createFakeBookr(), ["check", "123", "not-a-date", "2"], io);
    expect(code).toBe(EXIT_CODES.invalidInput);
    expect(io.err()).toContain("error:");
  });

  it("rejects a non-numeric party size with exit code 2", async () => {
    const io = captureIo();
    const code = await runCli(createFakeBookr(), ["check", "123", "2026-07-20", "nope"], io);
    expect(code).toBe(EXIT_CODES.invalidInput);
  });

  it("rejects a malformed --window with exit code 2", async () => {
    const io = captureIo();
    const code = await runCli(createFakeBookr(), ["check", "123", "2026-07-20", "2", "--window", "nowindow"], io);
    expect(code).toBe(EXIT_CODES.invalidInput);
    expect(io.err()).toContain("invalid window");
  });
});

describe("bookr resolve", () => {
  it("prints venue matches as a table", async () => {
    const io = captureIo();
    const code = await runCli(createFakeBookr({ venues: [VENUE_MATCH] }), ["resolve", "test bistro"], io);
    expect(code).toBe(EXIT_CODES.ok);
    expect(io.out()).toContain("Test Bistro");
  });

  it("emits JSON with --json and honours --provider", async () => {
    const io = captureIo();
    const code = await runCli(
      createFakeBookr({ venues: [VENUE_MATCH] }),
      ["--json", "resolve", "test bistro", "--provider", "resy"],
      io,
    );
    expect(code).toBe(EXIT_CODES.ok);
    const parsed = JSON.parse(io.out()) as VenueMatch[];
    expect(parsed[0]?.name).toBe("Test Bistro");
  });

  it("rejects an unsupported provider with exit code 2", async () => {
    const io = captureIo();
    const code = await runCli(createFakeBookr(), ["resolve", "query", "--provider", "eventbrite"], io);
    expect(code).toBe(EXIT_CODES.invalidInput);
  });
});

describe("bookr watch", () => {
  it("lists watches as a table and as JSON", async () => {
    const tableIo = captureIo();
    expect(await runCli(createFakeBookr({ watches: [WATCH] }), ["watch", "list"], tableIo)).toBe(EXIT_CODES.ok);
    expect(tableIo.out()).toContain("Test Bistro");

    const jsonIo = captureIo();
    expect(await runCli(createFakeBookr({ watches: [WATCH] }), ["--json", "watch", "list"], jsonIo)).toBe(
      EXIT_CODES.ok,
    );
    const parsed = JSON.parse(jsonIo.out()) as Watch[];
    expect(parsed[0]?.id).toBe("w1");
  });

  it("prints a placeholder when there are no watches", async () => {
    const io = captureIo();
    await runCli(createFakeBookr(), ["watch", "list"], io);
    expect(io.out().trim()).toBe("(none)");
  });

  it("creates a watch from flags with a fixed date range", async () => {
    const io = captureIo();
    const app = createFakeBookr();
    const code = await runCli(
      app,
      [
        "--json",
        "watch",
        "add",
        "--provider",
        "resy",
        "--label",
        "New Spot",
        "--venue-id",
        "999",
        "--party-size",
        "4",
        "--date-start",
        "2026-08-01",
        "--date-end",
        "2026-08-10",
        "--window",
        "18:00-20:00",
        "--timezone",
        "America/New_York",
      ],
      io,
    );
    expect(code).toBe(EXIT_CODES.ok);
    const created = JSON.parse(io.out()) as Watch;
    expect(created.label).toBe("New Spot");
    expect(created.dateRange).toEqual({ start: "2026-08-01", end: "2026-08-10" });
    expect(app.watches.list()).toHaveLength(1);
  });

  it("creates a disabled, autobook watch with a rolling date range", async () => {
    const io = captureIo();
    const code = await runCli(
      createFakeBookr(),
      [
        "--json",
        "watch",
        "add",
        "--provider",
        "resy",
        "--label",
        "Rolling Spot",
        "--venue-id",
        "111",
        "--party-size",
        "2",
        "--rolling-days",
        "14",
        "--window",
        "18:00-20:00",
        "--timezone",
        "America/New_York",
        "--autobook",
        "--disabled",
      ],
      io,
    );
    expect(code).toBe(EXIT_CODES.ok);
    const created = JSON.parse(io.out()) as Watch;
    expect(created.dateRange).toEqual({ rollingDays: 14 });
    expect(created.autobook).toBe(true);
    expect(created.enabled).toBe(false);
  });

  it("rejects add with neither a rolling nor a fixed date range", async () => {
    const io = captureIo();
    const code = await runCli(
      createFakeBookr(),
      [
        "watch",
        "add",
        "--provider",
        "resy",
        "--label",
        "No Range",
        "--venue-id",
        "1",
        "--party-size",
        "2",
        "--window",
        "18:00-20:00",
        "--timezone",
        "America/New_York",
      ],
      io,
    );
    expect(code).toBe(EXIT_CODES.invalidInput);
    expect(io.err()).toContain("--rolling-days");
  });

  it("rejects add with an invalid timezone", async () => {
    const io = captureIo();
    const code = await runCli(
      createFakeBookr(),
      [
        "watch",
        "add",
        "--provider",
        "resy",
        "--label",
        "Bad TZ",
        "--venue-id",
        "1",
        "--party-size",
        "2",
        "--rolling-days",
        "7",
        "--window",
        "18:00-20:00",
        "--timezone",
        "Not/AZone",
      ],
      io,
    );
    expect(code).toBe(EXIT_CODES.invalidInput);
  });

  it("rejects add when a required flag is missing (commander-level error)", async () => {
    const io = captureIo();
    const code = await runCli(createFakeBookr(), ["watch", "add", "--label", "Missing Provider"], io);
    expect(code).not.toBe(EXIT_CODES.ok);
    expect(io.err().length).toBeGreaterThan(0);
  });

  it("removes an existing watch", async () => {
    const io = captureIo();
    const app = createFakeBookr({ watches: [WATCH] });
    const code = await runCli(app, ["watch", "rm", "w1"], io);
    expect(code).toBe(EXIT_CODES.ok);
    expect(io.out()).toContain("removed w1");
    expect(app.watches.get("w1")).toBeUndefined();
  });

  it("returns exit code 3 for removing a missing watch", async () => {
    const io = captureIo();
    const code = await runCli(createFakeBookr(), ["watch", "rm", "nope"], io);
    expect(code).toBe(EXIT_CODES.notFound);
    expect(io.err()).toContain("watch not found");
  });

  it("removes a watch with --json output", async () => {
    const io = captureIo();
    const code = await runCli(createFakeBookr({ watches: [WATCH] }), ["--json", "watch", "rm", "w1"], io);
    expect(code).toBe(EXIT_CODES.ok);
    expect(JSON.parse(io.out())).toEqual({ removed: "w1" });
  });

  it("enables and disables a watch", async () => {
    const io = captureIo();
    const app = createFakeBookr({ watches: [{ ...WATCH, enabled: false }] });
    const code = await runCli(app, ["--json", "watch", "enable", "w1"], io);
    expect(code).toBe(EXIT_CODES.ok);
    expect((JSON.parse(io.out()) as Watch).enabled).toBe(true);

    const io2 = captureIo();
    await runCli(app, ["--json", "watch", "enable", "w1", "--off"], io2);
    expect((JSON.parse(io2.out()) as Watch).enabled).toBe(false);
  });

  it("returns exit code 3 for enabling a missing watch", async () => {
    const io = captureIo();
    const code = await runCli(createFakeBookr(), ["watch", "enable", "nope"], io);
    expect(code).toBe(EXIT_CODES.notFound);
  });
});

describe("bookr book", () => {
  it("refuses to book without --yes", async () => {
    const io = captureIo();
    const code = await runCli(createFakeBookr(), ["book", "w1", "somekey"], io);
    expect(code).toBe(EXIT_CODES.invalidInput);
    expect(io.err()).toContain("--yes");
  });

  it("exits 0 for a booked result", async () => {
    const io = captureIo();
    const code = await runCli(
      createFakeBookr({ bookResult: { status: "booked", confirmationId: "abc", deepLink: "https://x" } }),
      ["--json", "book", "w1", "somekey", "--yes"],
      io,
    );
    expect(code).toBe(EXIT_CODES.ok);
    expect(JSON.parse(io.out())).toMatchObject({ status: "booked" });
  });

  it("exits 0 for a locked-unconfirmed two-phase result", async () => {
    const io = captureIo();
    const code = await runCli(
      createFakeBookr({
        bookResult: { status: "locked-unconfirmed", deepLink: "https://x", detail: "pending confirm" },
      }),
      ["book", "w1", "somekey", "--yes"],
      io,
    );
    expect(code).toBe(EXIT_CODES.ok);
  });

  it("exits 1 for a failed result", async () => {
    const io = captureIo();
    const code = await runCli(createFakeBookr(), ["book", "w1", "somekey", "--yes"], io);
    expect(code).toBe(EXIT_CODES.error);
  });

  it("exits 1 for a challenged result", async () => {
    const io = captureIo();
    const code = await runCli(
      createFakeBookr({ bookResult: { status: "challenged", deepLink: "https://x", detail: "captcha" } }),
      ["book", "w1", "somekey", "--yes"],
      io,
    );
    expect(code).toBe(EXIT_CODES.error);
  });

  it("propagates a thrown booking error as exit code 1", async () => {
    const io = captureIo();
    const app: BookrApp = {
      ...createFakeBookr(),
      booking: {
        book: async () => {
          throw new Error("network down");
        },
      },
    };
    const code = await runCli(app, ["book", "w1", "somekey", "--yes"], io);
    expect(code).toBe(EXIT_CODES.error);
    expect(io.err()).toContain("network down");
  });
});

describe("commander-level behaviour", () => {
  it("returns exit code 0 and prints usage for --help", async () => {
    const io = captureIo();
    const code = await runCli(createFakeBookr(), ["--help"], io);
    expect(code).toBe(EXIT_CODES.ok);
    expect(io.out()).toContain("Usage:");
  });

  it("returns a non-zero exit code for an unknown command", async () => {
    const io = captureIo();
    const code = await runCli(createFakeBookr(), ["not-a-real-command"], io);
    expect(code).not.toBe(EXIT_CODES.ok);
    expect(io.err().length).toBeGreaterThan(0);
  });
});
