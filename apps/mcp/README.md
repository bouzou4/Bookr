# @bookr/mcp

The Model Context Protocol facade for Bookr. It exposes a `BookrApp` (the application surface
shared by every Bookr entry point) as MCP tools, so any MCP-speaking client — an editor, an
agent, a chat client — can check availability, manage watches, and request a booking.

This package builds and is fully tested against `@bookr/testkit`'s in-memory fake app. It does
not construct the real application: that composition (real providers, persistence,
credentials) happens elsewhere and is handed to this package as a `BookrApp` instance.

## Tools

| Tool | Purpose | Mutates? |
|---|---|---|
| `check_availability` | Look up open slots for a provider/venue/date without creating a watch | no |
| `resolve_venue` | Resolve a name, slug, or URL to candidate venues | no |
| `list_watches` | List all configured watches | no |
| `add_watch` | Create a new watch | yes |
| `update_watch` | Apply a partial update to a watch | yes |
| `remove_watch` | Delete a watch | yes |
| `get_activity` | Fetch recent activity/audit events | no |
| `credential_status` | Report per-provider credential/session status | no |
| `book_slot` | Book a previously-seen slot within a watch | yes, guarded |

`book_slot` is the only tool that triggers a real reservation attempt. It requires its input to
include `confirm: true`; any other value (including a present `confirm: false`) is refused
before `BookrApp.booking.book` is ever called.

Every read tool returns both a human-readable text block and `structuredContent` (a JSON object)
so structured and text-only clients both get a usable response.

## Using it as a library

```ts
import { createMcpServer } from "@bookr/mcp";
import type { BookrApp } from "@bookr/core";

declare const app: BookrApp; // however your composition root builds one

const server = createMcpServer(app);
await server.connect(someTransport); // stdio, streamable-HTTP, or your own
```

`createMcpServer` returns an unconnected `McpServer` from `@modelcontextprotocol/sdk` — this
package has no opinion on transport beyond the two entry points below.

## Running standalone

The standalone entry points (`src/stdio.ts`, `src/http.ts`) resolve their `BookrApp` from
`src/bootstrap.ts`, a placeholder that throws until a real composition root replaces it. Until
then, run this package as a library with your own `BookrApp` instance, or use the tests as a
reference for wiring one in directly.

### stdio

```
pnpm --filter @bookr/mcp start:stdio
```

Speaks newline-delimited JSON-RPC over stdin/stdout — the transport an MCP client uses when it
launches this process directly (e.g. a desktop client's local server configuration).

### Streamable HTTP

```
pnpm --filter @bookr/mcp start:http
```

Listens on `PORT` (default `3333`) and serves the MCP streamable-HTTP transport at `/mcp`. Each
request gets a fresh server/transport pair (stateless mode) — there is no session state to
resume across requests, matching the MCP SDK's recommended pattern for stateless deployments.

## Testing approach

Tests build `createMcpServer(createFakeBookr(seed))` and drive it two ways:

- an in-memory MCP transport (`server.test.ts`) exercising every tool through a real `Client`,
  including input validation failures and the `book_slot` confirm gate;
- a real HTTP server on an ephemeral port (`http.test.ts`), driven by the SDK's
  `StreamableHTTPClientTransport`, to cover the streamable-HTTP request listener end to end.

No live provider API is ever called; only the fake in-memory application from `@bookr/testkit`.
