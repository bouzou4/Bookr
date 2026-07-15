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

```
packages/shared   TS types + zod schemas
apps/server       Express API, scheduler, providers, credentials, db
apps/web          React dashboard
scripts/login.ts  off-box headed login → pushes a token to the ingest endpoint
```

## Getting started

```sh
cp .env.example .env   # fill in creds (or set CREDENTIALS_PROVIDER=vaultwarden)
pnpm install
pnpm scan              # one scan pass (dev)
```

See `.env.example` for configuration.
