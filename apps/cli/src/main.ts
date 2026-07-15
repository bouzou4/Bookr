#!/usr/bin/env node
/**
 * The `bookr` binary's real process entry point: builds the application surface via
 * {@link bootstrap} and runs the CLI against the actual process argv and streams.
 *
 * @packageDocumentation
 */

import { runCli } from "./cli.ts";
import { bootstrap } from "./bootstrap.ts";

/**
 * Run the CLI against `process.argv` and set `process.exitCode` to the result. Exported so
 * tests can invoke it directly (with `bootstrap` mocked) instead of only exercising it as a
 * script side effect.
 *
 * @returns Resolves once the command has finished and `process.exitCode` has been set.
 */
export async function main(): Promise<void> {
  const app = bootstrap();
  process.exitCode = await runCli(app, process.argv.slice(2));
}

/* v8 ignore start -- process-launch glue; exercised via the `main` unit test, not this guard */
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err: unknown) => {
    process.stderr.write(`fatal: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
}
/* v8 ignore stop */
