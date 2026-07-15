# @bookr/testkit

Shared test doubles and fixtures so every package can be built and tested in isolation.

- `FakeClock` — a deterministic `Clock`; time only moves when advanced, and sleeps are recorded.
- `FakeProvider` — an in-memory `BookingProvider` returning scripted data and counting calls.
- `createFakeBookr(seed)` — a fully in-memory `BookrApp`, so the CLI, MCP, and REST entry points
  can be developed and tested before the real core exists.

Provider API response payloads live in `@bookr/fixtures` (a dependency-free package that
adapters inside `@bookr/core` can import without a cycle). This package holds the port fakes.

Test-only utility. No real credentials or captured data.
