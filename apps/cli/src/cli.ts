/**
 * The `bookr` command-line facade over {@link BookrApp}. This module builds the commander
 * program and drives it end to end; it never imports a concrete adapter, so it can be built and
 * fully tested against `@bookr/testkit`'s `createFakeBookr` before the real composition root
 * exists.
 *
 * @packageDocumentation
 */

import { Command, CommanderError } from "commander";
import type { BookrApp } from "@bookr/core";
import { registerScanCommand } from "./commands/scan.ts";
import { registerCheckCommand } from "./commands/check.ts";
import { registerResolveCommand } from "./commands/resolve.ts";
import { registerWatchCommand } from "./commands/watch.ts";
import { registerBookCommand } from "./commands/book.ts";
import { createExitState } from "./exit-state.ts";
import { EXIT_CODES } from "./exit-codes.ts";
import { processIo, type CliIO } from "./io.ts";

/** Key an {@link ExitState} is stashed under on the program, for {@link runCli} to read back. */
const EXIT_STATE_KEY = Symbol("bookr-cli-exit-state");

/**
 * Build a commander program exposing {@link BookrApp} as the `bookr` CLI: `scan`, `check`,
 * `resolve`, `watch add|list|rm|enable`, and `book`. The program has `exitOverride` enabled and
 * writes only through the supplied {@link CliIO}, so parsing it never touches `process.stdout`,
 * `process.stderr`, or `process.exit` — safe to drive repeatedly from tests. Use {@link runCli}
 * to actually parse an argv and get back an exit code.
 *
 * @param app - The application surface to drive.
 * @param io - Output streams; defaults to the real process streams.
 * @returns A configured, unparsed commander program.
 */
export function createCli(app: BookrApp, io: CliIO = processIo()): Command {
  const program = new Command();
  const exitState = createExitState();
  Object.assign(program, { [EXIT_STATE_KEY]: exitState });

  program
    .name("bookr")
    .description("Scan booking providers for newly-freed reservations and act on them.")
    .option("--json", "output machine-readable JSON instead of a table")
    .exitOverride()
    .configureOutput({
      writeOut: (str) => {
        io.stdout.write(str);
      },
      writeErr: (str) => {
        io.stderr.write(str);
      },
    });

  registerScanCommand(program, app, io, exitState);
  registerCheckCommand(program, app, io, exitState);
  registerResolveCommand(program, app, io, exitState);
  registerWatchCommand(program, app, io, exitState);
  registerBookCommand(program, app, io, exitState);

  return program;
}

/**
 * Parse `argv` against a fresh {@link createCli} program and resolve to a process exit code.
 * This never calls `process.exit` itself, so it is the entry point both the real `bin` script
 * and tests should use.
 *
 * @param app - The application surface to drive.
 * @param argv - Argument vector, excluding any `node`/script prefix (e.g. `["scan", "--json"]`).
 * @param io - Output streams; defaults to the real process streams.
 * @returns The exit code the command produced.
 */
export async function runCli(app: BookrApp, argv: string[], io: CliIO = processIo()): Promise<number> {
  const program = createCli(app, io);
  try {
    await program.parseAsync(argv, { from: "user" });
  } catch (err) {
    if (err instanceof CommanderError) return err.exitCode;
    io.stderr.write(`error: ${err instanceof Error ? err.message : String(err)}\n`);
    return EXIT_CODES.error;
  }
  const exitState = (program as unknown as Record<symbol, { code: number }>)[EXIT_STATE_KEY];
  return exitState?.code ?? EXIT_CODES.ok;
}
