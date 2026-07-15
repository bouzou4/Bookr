/**
 * The output streams the CLI writes to. Every command routes its output through a {@link CliIO}
 * instead of `process.stdout`/`process.stderr` directly, so tests can inject in-memory streams
 * and assert on exactly what a command printed.
 *
 * @packageDocumentation
 */

/** The pair of writable streams a CLI run writes to. */
export interface CliIO {
  /** Destination for normal command output (tables, JSON, confirmations). */
  stdout: NodeJS.WritableStream;
  /** Destination for error and diagnostic output. */
  stderr: NodeJS.WritableStream;
}

/**
 * Build a {@link CliIO} backed by the real process streams.
 *
 * @returns An IO pair writing to `process.stdout`/`process.stderr`.
 */
export function processIo(): CliIO {
  return { stdout: process.stdout, stderr: process.stderr };
}
