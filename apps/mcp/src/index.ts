/**
 * `@bookr/mcp` — the Model Context Protocol facade over `BookrApp`. Embedders that already have
 * a `BookrApp` instance (e.g. a composition root) only need {@link createMcpServer}: it returns
 * a fully configured, transport-agnostic server ready to `connect()` to stdio, streamable-HTTP,
 * or an in-memory transport.
 *
 * @packageDocumentation
 */

export { createMcpServer } from "./server.ts";
export { createHttpRequestListener, MCP_HTTP_PATH, runHttp, type HttpListenerOptions } from "./http.ts";
export { runStdio } from "./stdio.ts";
export { getApp } from "./bootstrap.ts";
export * from "./schemas.ts";
