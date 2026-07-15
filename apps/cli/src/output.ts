/**
 * Rendering helpers for the CLI's two output modes: a plain-text table/key-value form for humans
 * and pretty-printed JSON for scripts (selected with the global `--json` flag).
 *
 * @packageDocumentation
 */

import type { CliIO } from "./io.ts";

/** A loosely-typed row: whatever shape the caller's records happen to have. */
export type Row = Record<string, unknown>;

/**
 * Render a single cell value as display text. Nested objects/arrays are compacted to inline
 * JSON so a table row never wraps across lines.
 *
 * @param value - The raw cell value.
 * @returns The text to display.
 */
function cell(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * Render rows as a fixed-width, space-padded text table.
 *
 * @param rows - The records to render, one per line.
 * @param columns - Column keys, in display order.
 * @returns The rendered table, or a placeholder line if `rows` is empty.
 */
export function formatTable(rows: Row[], columns: string[]): string {
  if (rows.length === 0) return "(none)";
  const widths = columns.map((col) => Math.max(col.length, ...rows.map((row) => cell(row[col]).length)));
  const renderRow = (cells: string[]): string => cells.map((c, i) => c.padEnd(widths[i] ?? c.length)).join("  ");
  const header = renderRow(columns);
  const separator = widths.map((w) => "-".repeat(w)).join("  ");
  const body = rows.map((row) => renderRow(columns.map((col) => cell(row[col]))));
  return [header, separator, ...body].join("\n");
}

/**
 * Render a single record as aligned `key  value` lines.
 *
 * @param record - The record to render.
 * @returns The rendered key/value block.
 */
export function formatKeyValue(record: Row): string {
  const keys = Object.keys(record);
  const width = Math.max(0, ...keys.map((k) => k.length));
  return keys.map((k) => `${k.padEnd(width)}  ${cell(record[k])}`).join("\n");
}

/**
 * Write a value as pretty-printed JSON, terminated with a newline.
 *
 * @param io - Output streams.
 * @param data - The value to serialise.
 */
export function printJson(io: CliIO, data: unknown): void {
  io.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}

/**
 * Write rows as a text table, terminated with a newline.
 *
 * @param io - Output streams.
 * @param rows - The records to render.
 * @param columns - Column keys, in display order.
 */
export function printTable(io: CliIO, rows: Row[], columns: string[]): void {
  io.stdout.write(`${formatTable(rows, columns)}\n`);
}

/**
 * Write a single record as a key/value block, terminated with a newline.
 *
 * @param io - Output streams.
 * @param record - The record to render.
 */
export function printKeyValue(io: CliIO, record: Row): void {
  io.stdout.write(`${formatKeyValue(record)}\n`);
}

/**
 * Choose table vs. JSON rendering for a list of rows based on the `--json` flag.
 *
 * @param io - Output streams.
 * @param json - True to render JSON instead of a table.
 * @param rows - The records to render.
 * @param columns - Column keys used for the table form.
 */
export function printRows(io: CliIO, json: boolean, rows: Row[], columns: string[]): void {
  if (json) printJson(io, rows);
  else printTable(io, rows, columns);
}

/**
 * Choose key-value vs. JSON rendering for a single record based on the `--json` flag.
 *
 * @param io - Output streams.
 * @param json - True to render JSON instead of a key/value block.
 * @param record - The record to render.
 */
export function printItem(io: CliIO, json: boolean, record: Row): void {
  if (json) printJson(io, record);
  else printKeyValue(io, record);
}
