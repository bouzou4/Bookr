# @bookr/web

The Bookr dashboard: a React + Vite single-page app that is a thin, typed REST client over the
Bookr server. It contains no business logic of its own — every screen calls one or more REST
endpoints and renders the response, with request/response types imported directly from
`@bookr/shared` so the client can never drift from what the server actually validates.

## Screens

- **Watches** — list, create, edit, delete, and enable/disable watches. The create/edit form
  validates input against the `@bookr/shared` zod schema (`watchInputSchema`) before it is ever
  sent to the server, and renders the schema's own field-level issues back to the user.
- **Activity** — a recent-events feed, filterable by event type, with manual refresh.
- **Credentials** — per-provider session status, plus a "hand over token" action for manually
  ingesting a freshly captured session (e.g. after a provider challenge). This posts to
  `POST /api/ingest/:provider` with a bearer token, independent of the dashboard's own login
  session.
- **Health** — overall service health: last completed scan pass, whether the scheduler loop is
  running, and per-provider session state.

The dashboard sits behind the server's single-user, session-cookie login (`POST /api/auth/login`).
Since `GET /api/health` is intentionally unauthenticated, the app instead probes `GET /api/watches`
on load to decide whether to show the login form or the dashboard.

## Development

Requires Node ≥22 and pnpm (workspace-managed; run these from the repo root or this directory).

```sh
pnpm install
pnpm --filter @bookr/web dev
```

This starts the Vite dev server and proxies `/api/*` requests to `http://localhost:8080`, so run
`@bookr/server` locally (or point the proxy at a different host in `vite.config.ts`) to develop
against a real backend.

## Build

```sh
pnpm --filter @bookr/web build
```

Type-checks with `tsc --noEmit` and then produces a static production bundle in `dist/`, ready to
be served by `@bookr/server`'s SPA fallback.

## Testing

```sh
pnpm --filter @bookr/web test
```

Component and behaviour tests run under Vitest + jsdom with `@testing-library/react`, mocking all
HTTP traffic with `msw` (`src/test/handlers.ts` holds the default happy-path handlers; individual
tests override specific routes with `server.use(...)`). No test ever talks to a real server.

## Layout

```
src/
  api/client.ts       typed REST client — one function per server route
  hooks/useAsync.ts   generic load/error/loading state for a REST call
  components/         reusable form/nav pieces (WatchForm, LoginForm, IngestForm, Nav)
  pages/              one component per dashboard screen
  test/               msw handlers, fixtures, and the Vitest setup file
```

## Linting

This package is intentionally excluded from the repository's root ESLint config (it needs
React/JSX parsing and React Hooks rules the rest of the workspace doesn't) and ships its own flat
config in `eslint.config.js`.

```sh
pnpm --filter @bookr/web lint
```
