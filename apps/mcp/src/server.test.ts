import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createFakeBookr, type FakeBookrSeed } from "@bookr/testkit";
import type { BookrApp } from "@bookr/core";
import type { Slot, VenueMatch, Watch } from "@bookr/shared";
import { createMcpServer } from "./server.ts";

const sampleWatch: Watch = {
  id: "watch-1",
  provider: "resy",
  label: "Friday dinner",
  venue: { id: "venue-1", slug: "the-spot" },
  resourceType: "table",
  partySize: 2,
  dateRange: { start: "2026-07-17", end: "2026-07-19" },
  timeWindow: { start: "18:00", end: "21:00" },
  timezone: "America/New_York",
  autobook: false,
  enabled: true,
  createdAt: "2026-07-13T00:00:00.000Z",
  updatedAt: "2026-07-13T00:00:00.000Z",
};

const sampleSlot: Slot = {
  provider: "resy",
  venueId: "venue-1",
  date: "2026-07-18",
  start: "19:00:00",
  resourceType: "table",
  dedupeKey: "resy:venue-1:2026-07-18:19:00:00:2:main",
};

const sampleVenue: VenueMatch = {
  provider: "resy",
  id: "venue-1",
  slug: "the-spot",
  name: "The Spot",
  city: "New York",
};

/** Wires a fresh fake `BookrApp` to a `createMcpServer` instance over an in-memory transport. */
async function connect(
  seed: FakeBookrSeed = {},
): Promise<{ client: Client; app: BookrApp; close: () => Promise<void> }> {
  const app = createFakeBookr(seed);
  const server = createMcpServer(app);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return {
    client,
    app,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

/** The shape `Client.callTool` resolves to; used instead of the SDK's own type to sidestep a
 * structural mismatch between its zod-v3 and zod-v4 inferred variants. */
type ToolCallResult = Awaited<ReturnType<Client["callTool"]>>;

/** Returns a tool result's single text block, raw. */
function rawText(result: ToolCallResult): string {
  const content = result["content"];
  const first = Array.isArray(content) ? (content[0] as { type?: string; text?: string }) : undefined;
  if (!first || first.type !== "text" || typeof first.text !== "string") {
    throw new Error("expected a text content block");
  }
  return first.text;
}

/** Parses a tool result's single text block as JSON, for assertions on the human-readable copy. */
function textPayload(result: ToolCallResult): unknown {
  return JSON.parse(rawText(result)) as unknown;
}

describe("createMcpServer", () => {
  it("lists all nine tools with descriptions", async () => {
    const { client, close } = await connect();
    try {
      const { tools } = await client.listTools();
      const names = tools.map((t) => t.name).sort();
      expect(names).toEqual(
        [
          "add_watch",
          "book_slot",
          "check_availability",
          "credential_status",
          "get_activity",
          "list_watches",
          "remove_watch",
          "resolve_venue",
          "update_watch",
        ].sort(),
      );
      for (const tool of tools) {
        expect(tool.description, `${tool.name} should have a description`).toBeTruthy();
      }
    } finally {
      await close();
    }
  });

  it("check_availability returns seeded slots as structured content", async () => {
    const { client, close } = await connect({ slots: [sampleSlot] });
    try {
      const result = await client.callTool({
        name: "check_availability",
        arguments: { provider: "resy", venueId: "venue-1", date: "2026-07-18", partySize: 2 },
      });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toEqual({ slots: [sampleSlot] });
      expect(textPayload(result)).toEqual({ slots: [sampleSlot] });
    } finally {
      await close();
    }
  });

  it("check_availability surfaces input validation errors", async () => {
    const { client, close } = await connect();
    try {
      const result = await client.callTool({
        name: "check_availability",
        // Missing required fields (venueId, date, partySize) and an invalid provider.
        arguments: { provider: "not-a-provider" },
      });
      expect(result.isError).toBe(true);
    } finally {
      await close();
    }
  });

  it("resolve_venue returns seeded venue matches", async () => {
    const { client, close } = await connect({ venues: [sampleVenue] });
    try {
      const result = await client.callTool({
        name: "resolve_venue",
        arguments: { provider: "resy", query: "the spot" },
      });
      expect(result.structuredContent).toEqual({ venues: [sampleVenue] });
    } finally {
      await close();
    }
  });

  it("list_watches, add_watch, update_watch, and remove_watch round-trip", async () => {
    const { client, close } = await connect({ watches: [sampleWatch] });
    try {
      const listed = await client.callTool({ name: "list_watches", arguments: {} });
      expect(listed.structuredContent).toEqual({ watches: [sampleWatch] });

      const added = await client.callTool({
        name: "add_watch",
        arguments: {
          provider: "resy",
          label: "Saturday brunch",
          venue: { id: "venue-2" },
          partySize: 4,
          dateRange: { rollingDays: 14 },
          timeWindow: { start: "10:00", end: "13:00" },
          timezone: "America/New_York",
        },
      });
      expect(added.isError).toBeFalsy();
      const addedWatch = (added.structuredContent as { watch: Watch }).watch;
      expect(addedWatch.label).toBe("Saturday brunch");
      expect(addedWatch.resourceType).toBe("table"); // schema default applied
      expect(addedWatch.id).toBeTruthy();

      const updated = await client.callTool({
        name: "update_watch",
        arguments: { id: addedWatch.id, patch: { label: "Saturday brunch (updated)" } },
      });
      expect((updated.structuredContent as { watch: Watch }).watch.label).toBe(
        "Saturday brunch (updated)",
      );

      const removed = await client.callTool({
        name: "remove_watch",
        arguments: { id: addedWatch.id },
      });
      expect(removed.structuredContent).toEqual({ removed: true, id: addedWatch.id });

      const afterRemoval = await client.callTool({ name: "list_watches", arguments: {} });
      expect(afterRemoval.structuredContent).toEqual({ watches: [sampleWatch] });
    } finally {
      await close();
    }
  });

  it("update_watch surfaces an error for an unknown watch id", async () => {
    const { client, close } = await connect();
    try {
      const result = await client.callTool({
        name: "update_watch",
        arguments: { id: "does-not-exist", patch: { label: "x" } },
      });
      expect(result.isError).toBe(true);
      expect(rawText(result)).toMatch(/does-not-exist/);
    } finally {
      await close();
    }
  });

  it("get_activity returns recorded events, newest first, and honours filters", async () => {
    const { client, app, close } = await connect({ watches: [sampleWatch], slots: [sampleSlot] });
    try {
      await app.scan.runOnce(sampleWatch.id);
      const result = await client.callTool({ name: "get_activity", arguments: {} });
      const events = (result.structuredContent as { events: unknown[] }).events;
      expect(events.length).toBeGreaterThan(0);

      const filtered = await client.callTool({
        name: "get_activity",
        arguments: { type: "pass-complete", limit: 1 },
      });
      const filteredEvents = (filtered.structuredContent as { events: { type: string }[] }).events;
      expect(filteredEvents).toHaveLength(1);
      expect(filteredEvents[0]?.type).toBe("pass-complete");
    } finally {
      await close();
    }
  });

  it("credential_status returns seeded per-provider status", async () => {
    const status = [
      { provider: "resy" as const, sessionState: "active" as const, needsAttention: false },
    ];
    const { client, close } = await connect({ credentialStatus: status });
    try {
      const result = await client.callTool({ name: "credential_status", arguments: {} });
      expect(result.structuredContent).toEqual({ statuses: status });
    } finally {
      await close();
    }
  });

  it("book_slot refuses without confirm: true", async () => {
    const { client, close } = await connect({
      bookResult: { status: "booked", confirmationId: "abc", deepLink: "https://example.test" },
    });
    try {
      const withoutConfirm = await client.callTool({
        name: "book_slot",
        arguments: { watchId: "watch-1", dedupeKey: sampleSlot.dedupeKey, confirm: false },
      });
      expect(withoutConfirm.isError).toBe(true);
      expect(rawText(withoutConfirm)).toMatch(/confirm: true/);
    } finally {
      await close();
    }
  });

  it("book_slot surfaces a validation error when confirm is missing entirely", async () => {
    const { client, close } = await connect();
    try {
      const result = await client.callTool({
        name: "book_slot",
        arguments: { watchId: "watch-1", dedupeKey: sampleSlot.dedupeKey },
      });
      expect(result.isError).toBe(true);
    } finally {
      await close();
    }
  });

  it("book_slot executes and returns the outcome when confirm: true", async () => {
    const bookResult = {
      status: "booked" as const,
      confirmationId: "conf-123",
      deepLink: "https://example.test/reservation/conf-123",
    };
    const { client, close } = await connect({ bookResult });
    try {
      const result = await client.callTool({
        name: "book_slot",
        arguments: { watchId: "watch-1", dedupeKey: sampleSlot.dedupeKey, confirm: true },
      });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toEqual(bookResult);
    } finally {
      await close();
    }
  });
});
