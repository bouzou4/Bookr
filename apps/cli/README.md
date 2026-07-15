# @bookr/cli

The `bookr` command-line facade over `BookrApp`. It is a thin translation layer: every
subcommand parses and validates its arguments, calls exactly one `BookrApp` method, and renders
the result as a table or as JSON. No business logic (dedupe, scheduling, provider quirks) lives
here — that all belongs to `@bookr/core`.

## Commands

```
bookr scan [--watch <id>]
bookr check <venue> <date> <party> [--window HH:MM-HH:MM] [--provider <name>]
bookr resolve <url|query> [--provider <name>]
bookr watch add --provider <p> --label <text> --venue-id <id> [--venue-slug <slug>]
                 [--resource-type <type>] --party-size <n>
                 (--rolling-days <n> | --date-start <date> --date-end <date>)
                 --window <HH:MM-HH:MM> --timezone <iana-tz>
                 [--autobook] [--disabled]
bookr watch list
bookr watch rm <id>
bookr watch enable <id> [--off]
bookr book <watchId> <dedupeKey> --yes
```

Every command accepts a global `--json` flag (place it before or after the subcommand name) to
print machine-readable JSON instead of a text table/key-value block — useful for scripting.

`<venue>` in `check` and the venue id in `watch add` are provider venue ids, not free text; use
`bookr resolve` first to find one. `--provider` defaults to `resy`, the only fully-supported
provider at launch.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Success. |
| `1` | An unexpected error was thrown by the application layer, or `book` completed but the result was `challenged`/`failed`, or a scan pass recorded per-watch errors. |
| `2` | The supplied arguments failed validation (a `@bookr/shared` zod schema, or a CLI-only check such as a malformed `--window` or a missing `--yes`) — the application layer was never called. |
| `3` | The referenced watch does not exist. |

Commander's own parsing errors (unknown command, missing required flag, `--help`/`--version`)
use commander's own exit codes and are written through the same `--json`-independent stderr/
stdout streams.

## Usage

This package has no build step; run it through `tsx` (already wired at the repo root):

```
pnpm cli scan
pnpm cli check 123 2026-08-01 2 --window 18:00-21:00
pnpm --filter @bookr/cli start -- watch list --json
```

## Architecture

- `bootstrap.ts` is a placeholder — it throws until the real composition root (concrete
  persistence, provider, notifier, and credential adapters) is wired in elsewhere. `main.ts` is
  the only file that calls it.
- `createCli(app, io?)` (in `cli.ts`) builds a fully configured, unparsed `commander` program
  against the `BookrApp` interface. It never touches `process.stdout`/`process.stderr`/
  `process.exit` directly, so it is safe to construct and parse repeatedly in tests.
- `runCli(app, argv, io?)` parses an argv against a fresh `createCli` program and resolves to a
  process exit code — the function both `main.ts` and the test suite use.
- Each subcommand lives in its own module under `commands/` and is registered onto the shared
  program by `createCli`.

Because this package only imports the `BookrApp` type from `@bookr/core`, its entire test suite
runs against `@bookr/testkit`'s in-memory `createFakeBookr()` — no live provider, database, or
network call is ever involved.
