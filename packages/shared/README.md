# @bookr/shared

The frozen vocabulary of Bookr: TypeScript domain types + zod runtime schemas + the deployment
`Config` loader. Everything else — core, adapters, facades, the web app — depends on this and
speaks only in these terms.

- `types.ts` — compile-time domain contracts (`Watch`, `Slot`, `Session`, `BookResult`, …).
- `schemas.ts` — zod validators for untrusted boundaries (REST/CLI/MCP inputs).
- `config.ts` — `loadConfig(env)` → validated `Config` (the only channel for deployment values).

Because every other package builds against these symbols, treat any change here as a breaking
change and coordinate it deliberately.
