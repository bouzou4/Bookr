/**
 * Small input-parsing helpers shared across command implementations, for flag shapes that a
 * `@bookr/shared` zod schema doesn't parse on its own (schemas validate the resulting object;
 * these turn a raw CLI string into that object's shape).
 *
 * @packageDocumentation
 */

import { CliValidationError } from "./errors.ts";

/**
 * Split a `--window HH:MM-HH:MM` flag value into its `{ start, end }` parts. This only splits
 * the string; 24-hour-clock correctness is enforced downstream by the zod schema the result is
 * passed into.
 *
 * @param spec - The raw flag value.
 * @returns The window's start and end.
 * @throws {@link CliValidationError} if there is no `-` separator with content on both sides.
 */
export function parseWindow(spec: string): { start: string; end: string } {
  const sep = spec.indexOf("-");
  if (sep <= 0 || sep === spec.length - 1) {
    throw new CliValidationError(`invalid window "${spec}", expected HH:MM-HH:MM`);
  }
  return { start: spec.slice(0, sep), end: spec.slice(sep + 1) };
}
