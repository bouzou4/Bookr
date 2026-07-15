# @bookr/server

The internet-facing HTTP layer for Bookr: a hardened Express application that exposes the REST
API and serves the dashboard single-page app. It is a thin facade — every route delegates to the
`BookrApp` application surface and holds no business logic of its own.

## What it provides

`createServer(app, config)` builds and returns a configured Express app **without** calling
`.listen`, so the caller owns the transport (production entry point or a `supertest` test).

```ts
import { createServer } from "@bookr/server";

const server = createServer(app /* BookrApp */, {
  sessionSecret: process.env.SESSION_SECRET!,
  uiPassword: process.env.UI_PASSWORD!,
  ingestToken: process.env.INGEST_TOKEN!,
  dataDir: process.env.DATA_DIR ?? "./data",
  webRoot: "/app/public", // omit for API-only mode; the container image sets WEB_ROOT to this
});
server.listen(8080);
```

The production entry point (`main.ts`) awaits `bootstrap()` — the composition root that calls
`createBookr` to build the real adapters and derive the `ServerConfig` — then binds the listener,
**starts the polling scheduler**, and installs signal (`SIGTERM`/`SIGINT`) and last-resort error
handlers so a redeploy drains in-flight requests and a stray fault can't leave a half-dead process
serving traffic. The API and the scheduler share this one process.

## REST surface

All application routes live under `/api`:

| Method + path | Auth | Delegates to |
| --- | --- | --- |
| `POST /api/auth/login` · `/logout` | cookie (login is public) | session |
| `GET\|POST /api/watches`, `GET\|PUT\|DELETE /api/watches/:id` | cookie | `watches.*` |
| `POST /api/watches/:id/scan` · `POST /api/scan` | cookie | `scan.runOnce` |
| `POST /api/availability/check` | cookie | `availability.check` |
| `POST /api/venues/resolve` | cookie | `venues.resolve` |
| `GET /api/activity?limit&type` | cookie | `activity.recent` |
| `GET /api/credentials` | cookie | `credentials.status` |
| `POST /api/book` | cookie | `booking.book` — **403 unless the watch has `autobook`** |
| `POST /api/ingest/:provider` | **bearer token**, not cookie | `credentials.ingestSession` |
| `GET /api/health` | none | `health.status` — **liveness only** (`ok`, `lastPassAt`, `schedulerRunning`); per-provider session detail stays behind the cookie guard on `GET /api/credentials` |

Request bodies are validated with the shared zod schemas before any application call; a failure
returns `400` with the issues.

## Hardening

- `helmet()` default security headers; `x-powered-by` disabled; **no CORS** (same-origin only).
- Single-user session auth via `express-session` backed by a `better-sqlite3` store. The cookie
  is `__Host-bookr.sid` — `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/` — and `trust proxy` is
  configurable via `TRUST_PROXY` (default `1`, trusting one TLS-terminating hop so `Secure`
  works behind a reverse proxy; set `0` when nothing fronts the app so client IPs can't be spoofed).
- Rate limits: login `5 / 15 min`, ingest `30 / min` (per IP).
- The ingest bearer token and the dashboard password are compared with `crypto.timingSafeEqual`
  after a length check; an unset secret rejects every attempt.
- SPA serving order: `express.static` (immutable) → `/api` routers → catch-all that returns
  `index.html` for navigations but **excludes `/api`**, so unmatched API paths return JSON 404s.

## Configuration

`ServerConfig` (see `src/config.ts`): `sessionSecret` (required, non-empty), `uiPassword`,
`ingestToken`, `dataDir` / `sessionDbPath`, `webRoot`, `trustProxy`, `cookieSecure`,
`sessionPrune`. For plaintext local testing set `cookieSecure: false`.

## Development

```sh
pnpm --filter @bookr/server typecheck
pnpm --filter @bookr/server lint
pnpm --filter @bookr/server test   # supertest suite + v8 coverage
```

Tests run entirely against `@bookr/testkit`'s in-memory `createFakeBookr` and an in-memory
session store; no live provider APIs are involved.
