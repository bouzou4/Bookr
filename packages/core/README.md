# @bookr/core

The provider- and transport-agnostic heart of Bookr.

## Ports (`src/ports/`)
The interfaces the core depends on. Adapters implement the outbound ports; entry points call the
inbound one.
- `BookingProvider`, `CredentialsProvider`, `Notifier`, `Repository`, `Clock` — outbound.
- `BookrApp` — the single inbound application surface every entry point (CLI, MCP, REST) calls.

## Errors (`src/errors.ts`)
`NotSupportedError` and `ProviderError` (which carries a normalised error class so callers branch
without inspecting provider-specific messages).

## Services, scheduler, drop logger (`src/services/`, `src/scheduler/`, `src/droplog/`)
The application logic, depending only on ports: watch management, ad-hoc availability, venue
resolution, the scan engine (venue-local/DST-safe window filtering, tier filtering, the
acceptable-seat gate, dedupe with reappearance re-alerting, capability-gated auto-book), booking,
credential status/ingest, seat maps + per-theater seat preferences, activity, health, the
drop-timing logger, and the scheduler (pure per-venue backoff state machine + one-sided jitter +
single-flight, recovering from an unexpected pass fault instead of dying).

## Seating engine (`src/seating/`)
Pure, provider-agnostic seat-map analysis for assigned-seating providers: occupancy digests and
contiguous-block finding (`summarizeSeatMap`), the acceptable-seat alert gate with
explicit-seats → cached-preference → zone/depth precedence, and layout-geometry signatures
(`layoutSignature`) that identify an auditorium across showtimes so drawn seat preferences are
remembered per theater.

## Adapters (`src/adapters/`)
Concrete implementations of the outbound ports:
- `persistence/` — a `better-sqlite3` `Repository` (WAL, versioned migrations, real column schema).
- `providers/resy/` — the Resy `BookingProvider` (restaurant reservations; headless auth + autobook).
- `providers/amc/` — the AMC Theatres `BookingProvider` (movie screenings; anonymous access,
  notify-first, emits full seat maps parsed from amctheatres.com's server-rendered pages, deep
  links pre-select the best open block).
- `credentials/` — `env` and `vaultwarden` credentials providers.
- `notify/` — the apprise `Notifier`.

## Composition (`src/app/`)
- `buildApp(deps)` — wires already-constructed ports into a `BookrApp`.
- `createBookr({ config, env })` — the deployment composition root: constructs the concrete
  adapters from configuration and hands them to `buildApp`. Exposed at `@bookr/core/app`.
