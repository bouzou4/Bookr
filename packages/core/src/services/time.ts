/**
 * Venue-local time helpers. Providers report reservation dates and times in the venue's own wall
 * clock with no timezone attached, so every date-range and window comparison must be interpreted
 * through the watch's IANA timezone rather than the host's clock or a naive `Date` parse.
 *
 * @packageDocumentation
 */

import type { DateRange } from "@bookr/shared";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Milliseconds in an hour, exported so callers computing durations use one shared constant.
 */
export const HOUR_MS = 60 * 60 * 1000;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function partValue(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): number {
  return Number(parts.find((p) => p.type === type)?.value ?? "0");
}

function offsetMsAt(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const asUTC = Date.UTC(
    partValue(parts, "year"),
    partValue(parts, "month") - 1,
    partValue(parts, "day"),
    partValue(parts, "hour"),
    partValue(parts, "minute"),
    partValue(parts, "second"),
  );
  return asUTC - instant.getTime();
}

/**
 * Convert a venue-local wall time (a date and clock time with no zone) into the absolute instant
 * it denotes in the given timezone. Handles daylight-saving transitions by refining the zone
 * offset against the candidate instant.
 *
 * @param date - Reservation date, `YYYY-MM-DD`.
 * @param time - Wall-clock time, `HH:MM` or `HH:MM:SS`.
 * @param timeZone - IANA timezone the wall time is expressed in.
 * @returns The absolute instant.
 */
export function zonedWallTimeToInstant(date: string, time: string, timeZone: string): Date {
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  const [h, mi, s] = time.split(":").map(Number) as [number, number, number | undefined];
  const guessUTC = Date.UTC(y, mo - 1, d, h, mi, s ?? 0);
  let offset = offsetMsAt(new Date(guessUTC), timeZone);
  offset = offsetMsAt(new Date(guessUTC - offset), timeZone);
  return new Date(guessUTC - offset);
}

/**
 * Format an absolute instant as the calendar date showing on the venue's wall clock.
 *
 * @param instant - The absolute instant.
 * @param timeZone - IANA timezone.
 * @returns The venue-local date, `YYYY-MM-DD`.
 */
export function venueLocalDate(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  return `${pad2(partValue(parts, "year")).padStart(4, "0")}-${pad2(partValue(parts, "month"))}-${pad2(
    partValue(parts, "day"),
  )}`;
}

/**
 * Day-of-week (`0` = Sunday … `6` = Saturday) of a calendar date. Independent of timezone because
 * the argument is already a wall-clock date.
 *
 * @param date - A date, `YYYY-MM-DD`.
 * @returns The day-of-week index.
 */
export function dayOfWeek(date: string): number {
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
}

/**
 * Add a whole number of days to a calendar date.
 *
 * @param date - The starting date, `YYYY-MM-DD`.
 * @param days - Days to add (may be negative).
 * @returns The shifted date, `YYYY-MM-DD`.
 */
export function addDays(date: string, days: number): string {
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(y, mo - 1, d) + days * DAY_MS);
  return `${String(shifted.getUTCFullYear()).padStart(4, "0")}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(
    shifted.getUTCDate(),
  )}`;
}

/** A concrete `[start, end]` pair of venue-local dates, both inclusive. */
export interface ResolvedDateRange {
  /** Inclusive first date, `YYYY-MM-DD`. */
  start: string;
  /** Inclusive last date, `YYYY-MM-DD`. */
  end: string;
}

/**
 * Resolve a watch's fixed or rolling {@link DateRange} into concrete venue-local dates. A rolling
 * range starts at venue-local today and extends forward.
 *
 * @param range - The fixed or rolling range.
 * @param timeZone - IANA timezone used to determine "today".
 * @param now - The current instant.
 * @returns The resolved inclusive date range.
 */
export function resolveDateRange(range: DateRange, timeZone: string, now: Date): ResolvedDateRange {
  if ("rollingDays" in range) {
    const start = venueLocalDate(now, timeZone);
    return { start, end: addDays(start, range.rollingDays) };
  }
  return { start: range.start, end: range.end };
}

/**
 * Whether a date falls within an inclusive resolved range. ISO dates compare correctly as strings.
 *
 * @param date - The date to test, `YYYY-MM-DD`.
 * @param range - The inclusive range.
 * @returns True if `date` is within the range.
 */
export function isWithinDateRange(date: string, range: ResolvedDateRange): boolean {
  return date >= range.start && date <= range.end;
}

function toMinutes(hms: string): number {
  const [h, m] = hms.split(":").map(Number) as [number, number, ...number[]];
  return h * 60 + m;
}

/**
 * Whether a slot's start time falls within a venue-local `HH:MM` window. Windows whose end is
 * earlier than their start are treated as spanning midnight (e.g. `22:00`–`02:00`).
 *
 * @param slotStart - The slot start, `HH:MM` or `HH:MM:SS`, venue-local.
 * @param window - The acceptable window, `HH:MM` bounds, venue-local.
 * @returns True if the slot start is inside the window.
 */
export function isWithinWindow(slotStart: string, window: { start: string; end: string }): boolean {
  const t = toMinutes(slotStart);
  const start = toMinutes(window.start);
  const end = toMinutes(window.end);
  return start <= end ? t >= start && t <= end : t >= start || t <= end;
}
