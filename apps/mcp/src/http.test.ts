import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createFakeBookr } from "@bookr/testkit";
import { createHttpRequestListener, MCP_HTTP_PATH } from "./http.ts";

let server: Server | undefined;

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    server = undefined;
  }
});

/** Starts `createHttpRequestListener` on an ephemeral loopback port and returns its base URL. */
async function listen(): Promise<URL> {
  const app = createFakeBookr({
    watches: [
      {
        id: "watch-1",
        provider: "resy",
        label: "Test watch",
        venue: { id: "venue-1" },
        resourceType: "table",
        partySize: 2,
        dateRange: { rollingDays: 7 },
        timeWindow: { start: "18:00", end: "21:00" },
        timezone: "America/New_York",
        autobook: false,
        enabled: true,
        createdAt: "2026-07-13T00:00:00.000Z",
        updatedAt: "2026-07-13T00:00:00.000Z",
      },
    ],
  });
  server = createServer(createHttpRequestListener(app));
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return new URL(`http://127.0.0.1:${port}${MCP_HTTP_PATH}`);
}

describe("createHttpRequestListener", () => {
  it("serves MCP tool calls over streamable HTTP", async () => {
    const url = await listen();
    const client = new Client({ name: "http-test-client", version: "0.0.0" });
    await client.connect(new StreamableHTTPClientTransport(url));
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toContain("list_watches");

      const result = await client.callTool({ name: "list_watches", arguments: {} });
      expect(result.structuredContent).toMatchObject({
        watches: [{ id: "watch-1", label: "Test watch" }],
      });
    } finally {
      await client.close();
    }
  });

  it("rejects non-POST requests to the MCP path", async () => {
    const url = await listen();
    const response = await fetch(url, { method: "GET" });
    expect(response.status).toBe(405);
  });

  it("rejects requests to any other path", async () => {
    const url = await listen();
    const response = await fetch(new URL("/not-mcp", url), { method: "POST" });
    expect(response.status).toBe(404);
  });
});
