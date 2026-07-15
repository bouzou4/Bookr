/**
 * The MCP server facade: exposes {@link BookrApp} as Model Context Protocol tools. This module
 * holds no transport concerns — {@link createMcpServer} returns a configured, unconnected
 * server; callers (the stdio and streamable-HTTP entry points, or a test harness) connect it
 * to whichever transport they need.
 *
 * @packageDocumentation
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { BookrApp } from "@bookr/core";
import { availabilityCheckSchema, venueResolveSchema, watchInputSchema } from "@bookr/shared";
import {
  activityQueryInputSchema,
  bookSlotInputSchema,
  removeWatchInputSchema,
  updateWatchInputSchema,
} from "./schemas.ts";

/** Identifies this server to MCP clients during the protocol handshake. */
const SERVER_INFO = { name: "bookr-mcp", version: "0.1.0" } as const;

/**
 * Wraps a JSON-serialisable payload as a tool result: a human-readable text block for clients
 * that only render text, plus `structuredContent` for clients that consume it programmatically.
 *
 * @param data - The payload to return. Every tool in this module returns a plain object so it
 * satisfies MCP's `structuredContent` shape (a JSON object, not a bare array or scalar).
 * @returns The completed tool result.
 */
function toolResult(data: object): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    structuredContent: data as Record<string, unknown>,
  };
}

/**
 * Builds a fully configured MCP server exposing {@link BookrApp} as tools: `check_availability`,
 * `resolve_venue`, `list_watches`, `add_watch`, `update_watch`, `remove_watch`, `get_activity`,
 * `credential_status`, and the confirm-gated `book_slot`. Every read tool returns structured
 * content derived directly from the app; `book_slot` is the only tool that mutates state, and it
 * refuses to run unless its input includes `confirm: true`.
 *
 * @param app - The application surface to expose. The server holds this reference for its
 * lifetime; callers own connecting it to a transport (stdio, streamable-HTTP, or an in-memory
 * transport in tests).
 * @returns A ready-to-connect MCP server instance.
 */
export function createMcpServer(app: BookrApp): McpServer {
  const server = new McpServer(SERVER_INFO);

  server.registerTool(
    "check_availability",
    {
      description: "Check a provider/venue for open slots on a date, without creating a watch.",
      inputSchema: availabilityCheckSchema,
    },
    async (input) => toolResult({ slots: await app.availability.check(input) }),
  );

  server.registerTool(
    "resolve_venue",
    {
      description: "Resolve free text (a name, slug, or URL) to candidate venues for a provider.",
      inputSchema: venueResolveSchema,
    },
    async ({ provider, query }) => toolResult({ venues: await app.venues.resolve(query, provider) }),
  );

  server.registerTool(
    "list_watches",
    { description: "List all configured watches." },
    async () => toolResult({ watches: app.watches.list() }),
  );

  server.registerTool(
    "add_watch",
    { description: "Create a new watch.", inputSchema: watchInputSchema },
    async (input) => toolResult({ watch: app.watches.create(input) }),
  );

  server.registerTool(
    "update_watch",
    {
      description: "Apply a partial update to an existing watch.",
      inputSchema: updateWatchInputSchema,
    },
    async ({ id, patch }) => toolResult({ watch: app.watches.update(id, patch) }),
  );

  server.registerTool(
    "remove_watch",
    { description: "Delete a watch.", inputSchema: removeWatchInputSchema },
    async ({ id }) => {
      app.watches.remove(id);
      return toolResult({ removed: true, id });
    },
  );

  server.registerTool(
    "get_activity",
    {
      description: "Fetch recent activity/audit events, newest first.",
      inputSchema: activityQueryInputSchema,
    },
    async (query) => toolResult({ events: app.activity.recent(query) }),
  );

  server.registerTool(
    "credential_status",
    { description: "Report per-provider credential/session status." },
    async () => toolResult({ statuses: await app.credentials.status() }),
  );

  server.registerTool(
    "book_slot",
    {
      description:
        "Book a previously-seen slot within a watch. Guarded: refuses unless the input " +
        "includes confirm: true.",
      inputSchema: bookSlotInputSchema,
    },
    async ({ watchId, dedupeKey, confirm }) => {
      if (confirm !== true) {
        throw new Error("book_slot refused: set confirm: true to execute the booking.");
      }
      return toolResult(await app.booking.book(watchId, dedupeKey));
    },
  );

  return server;
}
