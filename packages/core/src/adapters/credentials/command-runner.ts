/**
 * Injectable process execution for the `bw` (Bitwarden CLI) integration.
 *
 * @packageDocumentation
 */

import { execFile } from "node:child_process";

/** Outcome of running an external command to completion. */
export interface CommandResult {
  /** Everything the process wrote to stdout. */
  stdout: string;
  /** Everything the process wrote to stderr. */
  stderr: string;
  /** Process exit code (`0` on success). */
  code: number;
}

/**
 * Runs a command and resolves with its output. Implementations must never reject on a
 * non-zero exit code — callers inspect {@link CommandResult.code} instead — so backoff and
 * error-classification logic stays in one place.
 *
 * Production code executes a real subprocess; tests inject a fake so no process is ever
 * spawned and no vault credential ever touches a real shell.
 */
export type CommandRunner = (
  args: string[],
  env?: Record<string, string | undefined>,
) => Promise<CommandResult>;

/**
 * Builds a {@link CommandRunner} that shells out to a real executable via `node:child_process`.
 * Intended for production wiring only — never used in this package's tests.
 *
 * @param command - The executable to invoke (defaults to `"bw"`, the Bitwarden CLI).
 * @returns A {@link CommandRunner} backed by a real child process.
 */
export function createNodeCommandRunner(command = "bw"): CommandRunner {
  return (args, env) =>
    new Promise<CommandResult>((resolve) => {
      const childEnv = env === undefined ? process.env : { ...process.env, ...env };
      execFile(command, args, { env: childEnv }, (error, stdout, stderr) => {
        const code = error === null ? 0 : typeof error.code === "number" ? error.code : 1;
        resolve({ stdout, stderr, code });
      });
    });
}
