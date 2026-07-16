/**
 * Extraction of embedded data from amctheatres.com pages. The site is a Next.js RSC app that
 * server-renders every payload Bookr needs — showtime records, movie titles, and full seating
 * layouts — as flight data inside `self.__next_f.push([1,"…"])` script chunks. These helpers
 * unescape those chunks and pull out the JSON objects of interest, so the provider never depends
 * on the Cloudflare-guarded GraphQL endpoint or on fragile HTML structure.
 *
 * @packageDocumentation
 */

/** One showtime record extracted from a theatre showtimes page. */
export interface AmcShowtime {
  /** AMC's numeric showtime id (the `/showtimes/{id}` path segment). */
  showtimeId: number;
  /** Sellability tier: `"Sellable"`, `"AlmostFull"`, or `"Soldout"`. */
  status: string;
  /** UTC instant of the performance. */
  showDateTimeUtc: string;
  /** The movie's URL slug (e.g. `"the-odyssey-80679"`). */
  movieSlug: string;
  /** Presentation format code (e.g. `"laseratamc"`, `"imax70mm"`, `"reald3d"`), when present. */
  formatCode?: string;
}

/** Everything Bookr reads off a theatre showtimes page. */
export interface AmcShowtimesPage {
  /** Movie titles by slug, from the page's film-filter options. */
  movieTitles: Map<string, string>;
  /** All showtime records found on the page. */
  showtimes: AmcShowtime[];
}

/** A raw seat as it appears in AMC's embedded `seatingLayout`. */
export interface AmcRawSeat {
  /** Whether the seat is currently free. */
  available: boolean;
  /** One-based column index, left to right, voids included. */
  column: number;
  /** One-based row index, screen first. */
  row: number;
  /** Seat name as printed (e.g. `"B8"`); numbering may run opposite to the column index. */
  name: string;
  /** Seat type (`"CanReserve"`, `"NotASeat"`, `"Wheelchair"`, `"Companion"`, `"Senior"`, …). */
  type: string;
  /** Whether the position renders at all (false for structural voids). */
  shouldDisplay?: boolean;
}

/** AMC's embedded seating layout for one showtime. */
export interface AmcSeatingLayout {
  /** Column count. */
  columns: number;
  /** Row count. */
  rows: number;
  /** Every position, seats and voids alike. */
  seats: AmcRawSeat[];
}

/**
 * Recover the flight-data text from a server-rendered page: every `self.__next_f.push([1,"…"])`
 * string chunk, JSON-unescaped and concatenated. Returns the raw page text unchanged when no
 * chunks are found, so callers can also feed pre-extracted payloads (e.g. fixtures).
 *
 * @param html - The page HTML.
 * @returns The unescaped flight text.
 */
export function flightText(html: string): string {
  const chunks: string[] = [];
  const pattern = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g;
  for (const match of html.matchAll(pattern)) {
    try {
      chunks.push(JSON.parse(match[1] as string) as string);
    } catch {
      // A malformed chunk contributes nothing; the remaining chunks usually suffice.
    }
  }
  return chunks.length > 0 ? chunks.join("") : html;
}

/**
 * Extract one balanced JSON object starting at `text[start]` (which must be `{`).
 *
 * @param text - The text to scan.
 * @param start - Index of the opening brace.
 * @returns The parsed object, or undefined when unbalanced/unparsable.
 */
export function extractBalancedJson(text: string, start: number): unknown {
  if (text[start] !== "{") return undefined;
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i += 1;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

/**
 * Parse a theatre showtimes page: movie titles from the film-filter options, and each showtime
 * element's record plus its movie/format linkage from the element's `aria-describedby` (whose
 * tokens are `<movie-slug>`, `<movie-slug>-<theatre-slug>`, `<movie-slug>-<theatre-slug>-<format>`, …).
 *
 * @param html - The page HTML (or pre-extracted flight text).
 * @param theatreSlug - The theatre's URL slug, used to split the format token.
 * @returns The extracted page data.
 */
export function parseShowtimesPage(html: string, theatreSlug: string): AmcShowtimesPage {
  const text = flightText(html);

  const movieTitles = new Map<string, string>();
  for (const match of text.matchAll(/\{"value":"([a-z0-9-]+-\d+)","children":"((?:[^"\\]|\\.)*)"\}/g)) {
    movieTitles.set(match[1] as string, JSON.parse(`"${match[2] as string}"`) as string);
  }

  const showtimes: AmcShowtime[] = [];
  const seen = new Set<number>();
  for (const match of text.matchAll(/\{"showtime":\{"showtimeId":/g)) {
    const props = extractBalancedJson(text, match.index) as
      | { showtime?: { showtimeId?: number; status?: string; showDateTimeUtc?: string }; "aria-describedby"?: string }
      | undefined;
    const record = props?.showtime;
    if (record?.showtimeId == null || !record.showDateTimeUtc || seen.has(record.showtimeId)) continue;

    const tokens = (props?.["aria-describedby"] ?? "").split(" ");
    const movieSlug = tokens[0] ?? "";
    const groupToken = tokens[2];
    const groupPrefix = `${movieSlug}-${theatreSlug}-`;
    const formatCode = groupToken?.startsWith(groupPrefix) ? groupToken.slice(groupPrefix.length) : undefined;

    seen.add(record.showtimeId);
    showtimes.push({
      showtimeId: record.showtimeId,
      status: record.status ?? "Sellable",
      showDateTimeUtc: record.showDateTimeUtc,
      movieSlug,
      formatCode,
    });
  }

  return { movieTitles, showtimes };
}

/**
 * Parse the embedded `seatingLayout` object off a showtime seats page.
 *
 * @param html - The page HTML (or pre-extracted flight text).
 * @returns The layout, or undefined when the page carries none.
 */
export function parseSeatingLayout(html: string): AmcSeatingLayout | undefined {
  const text = flightText(html);
  const marker = '"seatingLayout":';
  const at = text.indexOf(marker);
  if (at < 0) return undefined;
  const parsed = extractBalancedJson(text, at + marker.length) as
    | { columns?: number; rows?: number; seats?: AmcRawSeat[] }
    | undefined;
  if (!parsed || typeof parsed.columns !== "number" || typeof parsed.rows !== "number" || !Array.isArray(parsed.seats)) {
    return undefined;
  }
  return { columns: parsed.columns, rows: parsed.rows, seats: parsed.seats };
}
