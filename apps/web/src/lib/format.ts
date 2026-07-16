/**
 * Human-friendly date/time formatting for the dashboard. The API speaks ISO-8601 UTC instants;
 * these helpers render them in the viewer's local zone so timestamps read naturally instead of as
 * raw `2026-07-18T00:00:00.000Z` strings.
 *
 * @packageDocumentation
 */

/** Format an ISO instant as an absolute local date-and-time, e.g. "Jul 18, 2026, 8:00 PM". */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(d);
}

/** Format an ISO instant relative to now, e.g. "2 hours ago" or "in 3 days". */
export function formatRelative(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const diffSec = Math.round((d.getTime() - Date.now()) / 1000);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31_536_000],
    ["month", 2_592_000],
    ["day", 86_400],
    ["hour", 3600],
    ["minute", 60],
    ["second", 1],
  ];
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  for (const [unit, secs] of units) {
    if (Math.abs(diffSec) >= secs || unit === "second") {
      return rtf.format(Math.round(diffSec / secs), unit);
    }
  }
  return "just now";
}
