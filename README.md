# Bookr

A pluggable reservation scanner. It watches a booking provider for newly-freed
reservations (cancellations) within a target date/time window and alerts you —
optionally auto-booking. **Resy** is the first provider; the design is
provider-agnostic so more (e.g. SoHo House) drop in as one module.

## Design at a glance

- **Notify-first.** By default Bookr alerts you with a one-tap deep link.
  Auto-booking is a per-watch opt-in (`autobook`, default off).
- **Two swappable abstractions:**
  - `BookingProvider` — `resy` (first), others plug in. Selected per watch.
  - `CredentialsProvider` — `env` (default, works for anyone) or `vaultwarden`.
    Selected by `CREDENTIALS_PROVIDER`. No personal config lives in source.
- **Self-servicing credentials.** The server logs in and refreshes tokens itself;
  if a login is challenged it alerts you and accepts a fresh token pushed to an
  authenticated ingest endpoint — usable from anywhere.
- **Stack:** TypeScript · Express (API + scheduler) · React + Vite (dashboard) ·
  SQLite (better-sqlite3) · pnpm workspaces. Notifications via
  [apprise](https://github.com/caronc/apprise).

## Layout

A pnpm workspace. The domain logic lives in `packages/core` behind ports; every entry point
(`apps/*`) is a thin adapter over the same application surface.

```
packages/shared    TS types + zod schemas — the vocabulary every package shares
packages/core      domain logic: ports, services, scan engine, scheduler, and the
                   provider / credentials / notifier / persistence adapters
packages/testkit   in-memory port fakes for tests
packages/fixtures  captured provider API responses for tests
apps/server        Express API + polling scheduler + static dashboard host
apps/web           React + Vite dashboard
apps/cli           command-line interface over the application
apps/mcp           Model Context Protocol server (stdio + streamable HTTP)
tools/login        off-box headed login → pushes a token to the ingest endpoint
```

## Getting started

Requires Node 22+ and pnpm.

```sh
cp .env.example .env   # fill in creds (or set CREDENTIALS_PROVIDER=vaultwarden)
pnpm install
pnpm scan              # one scan pass (dev)
```

### Common commands

```sh
pnpm cli -- --help     # CLI usage (watches, scan, book, …)
pnpm dev:server        # run the API + scheduler
pnpm dev:web           # run the dashboard
pnpm ci                # typecheck + lint + test across the workspace
```

See `.env.example` for configuration and `deploy/README.md` for running the container.
