/**
 * Streamable-HTTP entry point: runs the Bookr MCP server over the MCP streamable-HTTP
 * transport, for clients that connect over the network rather than launching a child process.
 *
 * @packageDocumentation
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { BookrApp } from "@bookr/core";
import { createMcpServer } from "./server.ts";
import { getApp } from "./bootstrap.ts";

/** Path the streamable-HTTP transport is served at. */
export const MCP_HTTP_PATH = "/mcp";

/**
 * Reads a request body to completion and parses it as JSON.
 *
 * @param req - The incoming request.
 * @returns The parsed body, or `undefined` if the request carried no body.
 */
async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

/**
 * Writes a bare JSON-RPC error response for a request the transport never gets to see (e.g. a
 * wrong method or path), matching the shape the MCP SDK itself uses for protocol errors.
 *
 * @param res - The response to write to.
 * @param status - HTTP status code.
 * @param message - Human-readable error detail.
 */
function writeProtocolError(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { "content-type": "application/json" }).end(
    JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null }),
  );
}

/**
 * Builds the Node HTTP request listener that serves an MCP server at {@link MCP_HTTP_PATH}.
 * Each request gets a freshly created server and transport pair (stateless mode, i.e.
 * `sessionIdGenerator` is undefined) — the MCP SDK's recommended pattern when a deployment has
 * no need to resume a long-running stream across requests.
 *
 * @param app - The application surface to expose.
 * @returns A request listener suitable for `http.createServer`.
 */
export function createHttpRequestListener(
  app: BookrApp,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    if (req.url !== MCP_HTTP_PATH) {
      writeProtocolError(res, 404, "Not found.");
      return;
    }
    if (req.method !== "POST") {
      writeProtocolError(res, 405, "Method not allowed.");
      return;
    }

    const server = createMcpServer(app);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });

    const body = await readJsonBody(req);
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  };
}

/** Port the standalone HTTP entry point listens on. Defaults to 3333. */
const PORT = Number(process.env["PORT"] ?? 3333);

/**
 * Wires the configured application to an HTTP server and starts listening.
 *
 * @returns A promise that resolves once the server is listening.
 */
export async function runHttp(): Promise<void> {
  const app = getApp();
  const httpServer = createServer(createHttpRequestListener(app));
  await new Promise<void>((resolve) => httpServer.listen(PORT, resolve));
  console.error(`Bookr MCP server listening on http://localhost:${PORT}${MCP_HTTP_PATH}`);
}

/* v8 ignore start -- process wiring only exercised by actually launching the server. */
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  runHttp().catch((error: unknown) => {
    console.error("Bookr MCP http server failed:", error);
    process.exit(1);
  });
}
/* v8 ignore stop */
