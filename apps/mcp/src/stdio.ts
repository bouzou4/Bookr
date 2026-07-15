#!/usr/bin/env node
/**
 * Stdio entry point: runs the Bookr MCP server over stdio, the transport an MCP client uses
 * when it launches this process directly (e.g. a desktop client's local server config).
 *
 * @packageDocumentation
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./server.ts";
import { getApp } from "./bootstrap.ts";

/**
 * Wires the configured application to a stdio transport and connects the server. Resolves once
 * the server is listening; runs until the client disconnects (stdin closes).
 *
 * @returns A promise that resolves once the server is connected.
 */
export async function runStdio(): Promise<void> {
  const server = createMcpServer(getApp());
  await server.connect(new StdioServerTransport());
}

/* v8 ignore start -- process wiring only exercised by actually launching the CLI. */
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  runStdio().catch((error: unknown) => {
    console.error("Bookr MCP stdio server failed:", error);
    process.exit(1);
  });
}
/* v8 ignore stop */
