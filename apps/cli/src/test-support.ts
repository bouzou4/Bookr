/**
 * Test-only helpers for capturing CLI output without touching the real process streams.
 *
 * @packageDocumentation
 */

import type { CliIO } from "./io.ts";

/** An in-memory {@link CliIO} that records everything written to stdout/stderr. */
export interface CapturedIo extends CliIO {
  /** Everything written to stdout so far. */
  out(): string;
  /** Everything written to stderr so far. */
  err(): string;
}

/**
 * Build a {@link CapturedIo} for driving `createCli`/`runCli` in tests.
 *
 * @returns An in-memory IO pair plus accessors for what was captured.
 */
export function captureIo(): CapturedIo {
  let outBuf = "";
  let errBuf = "";
  const stdout = {
    write: (chunk: string): boolean => {
      outBuf += chunk;
      return true;
    },
  } as unknown as NodeJS.WritableStream;
  const stderr = {
    write: (chunk: string): boolean => {
      errBuf += chunk;
      return true;
    },
  } as unknown as NodeJS.WritableStream;
  return { stdout, stderr, out: () => outBuf, err: () => errBuf };
}
