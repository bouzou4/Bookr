# @bookr/login-tool

An off-box, interactive login capture tool for Bookr. It opens a **real, visible browser**
window on a provider's login page, lets a human complete sign-in (including any CAPTCHA or
2FA the provider throws up), captures the resulting session material from the network traffic
and cookie jar, and pushes it straight to a running Bookr server's ingest endpoint.

This exists because some providers cannot be authenticated headlessly (interactive challenges,
bot detection) — see the credential lifecycle in the root plan. When a provider session goes
`challenged`, this tool is how an operator hands over a fresh one without SSHing into the
server or touching its filesystem.

Playwright is a dependency **only of this package**. It must never end up in the server's
dependency tree or container image — the server ingest endpoint is what this tool talks to,
not something it embeds.

## Requirements

- Node 22, a real display (X11/Wayland/macOS/Windows desktop) — this launches a headed
  Chromium window, so it will not run in a headless CI container or a bare SSH session.
- Playwright's browser binaries installed once: `pnpm --filter @bookr/login-tool exec playwright install chromium`.
- A running Bookr server reachable from the machine you run this on, and its `INGEST_TOKEN`.

## Running it (off-box)

From the repo root, on a machine with a display:

```sh
export BOOKR_BASE_URL="https://your-bookr-host"
export BOOKR_INGEST_TOKEN="the server's INGEST_TOKEN"
pnpm --filter @bookr/login-tool start
```

A Chromium window opens on the provider's login page. Log in as you normally would, then
switch back to the terminal and press Enter. The tool reads the captured requests and cookies,
assembles a session, and POSTs it to `{BOOKR_BASE_URL}/api/ingest/resy`. On success it prints
confirmation and exits; on failure it prints the error and exits non-zero.

Currently only Resy is wired up in `run()`. The extraction/push logic is provider-parameterised
(`pushSession` takes a `ProviderName`), so adding another provider's login flow is a matter of
adding a new `extract<Provider>Session` alongside `resy.ts` and pointing `run.ts` at it.

## Design: why the logic is split the way it is

- `src/resy.ts` — pure extraction: given a list of captured requests (URL + headers) and
  cookies, find the auth token, the public `api_key`, and the refresh cookie, and assemble a
  `Session`. No I/O, no Playwright — fully unit-testable from plain fixtures.
- `src/push.ts` — pure HTTP push: POST a `Session` to `/api/ingest/:provider` with the ingest
  bearer token. Takes an injectable `fetch` implementation so tests can point it at a mocked
  dispatcher instead of the network.
- `src/run.ts` — the only file that imports Playwright. It launches the browser, wires
  `page.on("request", ...)` and `context.cookies()` into the two pure functions above, and
  waits for the operator's cue that login is done. It's intentionally thin — nothing here is
  worth unit-testing, and it cannot run without a real browser and display, so it's excluded
  from the coverage count (see `vitest.config.ts`).

## Testing

Tests never launch a browser or call a live provider. `resy.test.ts` feeds
`extractResySession` hand-built captured-request/cookie fixtures. `push.test.ts` mocks HTTP
with `undici`'s `MockAgent`, bound explicitly via `pushSession`'s `fetchImpl` option (rather than
relying on global-fetch/dispatcher wiring, which varies across Node versions).

```sh
pnpm --filter @bookr/login-tool typecheck
pnpm --filter @bookr/login-tool lint
pnpm --filter @bookr/login-tool test
```
