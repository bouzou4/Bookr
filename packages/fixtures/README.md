# @bookr/fixtures

Representative provider API response payloads for use as mocked HTTP replies in tests. Kept in a
standalone, dependency-free package so provider adapters (which live inside `@bookr/core`) can
import them without a dependency cycle.

- `resy.ts` — Resy `api.resy.com` response shapes (auth, `/2/user` with Global Dining Access
  flags, find, calendar, details, book, venue search).

All tokens and ids are fabricated. Never add real credentials or captured live data here.
