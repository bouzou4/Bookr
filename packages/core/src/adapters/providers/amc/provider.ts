/**
 * A {@link BookingProvider} for AMC Theatres. It reads amctheatres.com's server-rendered pages —
 * theatre showtimes and per-showtime seating layouts — entirely anonymously (only a browser-like
 * User-Agent is required), normalises them into the shared vocabulary, and attaches full seat
 * maps so the scan engine can apply the acceptable-seat gate. Notify-first: booking is not
 * supported programmatically; deep links land on AMC's own seat picker, pre-selecting the best
 * block when one is known.
 *
 * @packageDocumentation
 */

import {
  type BookResult,
  type ErrorClass,
  type ProviderCapabilities,
  type ProviderCredentials,
  type ProviderName,
  type Screening,
  type Seat,
  type SeatMap,
  type Session,
  type Slot,
  type VenueMatch,
  type Watch,
  formatDedupeKey,
} from "@bookr/shared";

import type { BookingProvider } from "../../../ports/booking-provider.ts";
import type { Clock } from "../../../ports/clock.ts";
import { NotSupportedError, ProviderError } from "../../../errors.ts";
import { summarizeSeatMap } from "../../../seating/summary.ts";
import { type AmcSeatingLayout, type AmcShowtime, parseSeatingLayout, parseShowtimesPage } from "./flight.ts";

/** Base URL of amctheatres.com. */
const AMC_SITE_BASE = "https://www.amctheatres.com";
/** A real Chrome User-Agent; sufficient to pass AMC's edge for page fetches. */
const AMC_CHROME_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
/** Anonymous sessions carry no credential; refresh them daily anyway to keep timestamps honest. */
const ANONYMOUS_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
/** How long a fetched theatre directory (sitemap) stays fresh. */
const SITEMAP_TTL_MS = 24 * 60 * 60 * 1000;

/** Human-readable labels for AMC's presentation-format codes; unknown codes pass through raw. */
const FORMAT_LABELS: Record<string, string> = {
  digital: "Digital",
  laseratamc: "Laser at AMC",
  imax: "IMAX",
  imaxwithlaseratamc: "IMAX with Laser at AMC",
  imax70mm: "IMAX 70mm",
  "70mm": "70mm",
  dolbycinemaatamc: "Dolby Cinema",
  dolbycinemaatamcprime: "Dolby Cinema Prime",
  amcprime: "AMC Prime",
  "4dx": "4DX",
  reald3d: "RealD 3D",
  dbox: "D-BOX",
};

/** A minimal {@link Clock} backed by the real system time. */
const systemClock: Clock = {
  now: () => new Date(),
  sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** Construction options for {@link AmcProvider}. */
export interface AmcProviderOptions {
  /** Clock used for all time comparisons; inject a fake in tests. Defaults to system time. */
  clock?: Clock;
}

/** Convert a UTC instant to a venue-local `YYYY-MM-DD` + `HH:MM:SS` pair. */
function utcToVenueLocal(iso: string, timezone: string): { date: string; start: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value ?? "00";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    start: `${get("hour")}:${get("minute")}:${get("second")}`,
  };
}

/** Title-case a URL slug: `"amc-34th-street-14"` → `"AMC 34th Street 14"`. */
function slugToName(slug: string): string {
  return slug
    .split("-")
    .map((word) => (word === "amc" ? "AMC" : /^\d/.test(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(" ");
}

/** Map an HTTP status onto a normalised error class. */
function classifyStatus(status: number): ErrorClass {
  if (status === 401 || status === 419) return "auth-expired";
  if (status === 403) return "challenged";
  if (status === 404) return "not-found";
  if (status === 429) return "rate-limited";
  if (status >= 500) return "rate-limited";
  return "other";
}

/**
 * Booking provider implementation for AMC Theatres.
 *
 * Venue identity is the page-path pair `"{market}/{slug}"` (e.g.
 * `"new-york-city/amc-34th-street-14"`) — the segment every showtimes URL needs. Availability is
 * a two-step fan-out: one showtimes page per day in range, then one seats page per showtime that
 * survives the watch's film/format filters. Slots carry the full {@link SeatMap}; the scan engine
 * owns the acceptable-seat gate.
 */
export class AmcProvider implements BookingProvider {
  /** This provider serves AMC. */
  readonly name: ProviderName = "amc";

  /** Anonymous catalog access; no programmatic booking (notify-first by design). */
  readonly capabilities: ProviderCapabilities = {
    headlessAuth: true,
    autobook: false,
    twoPhaseBook: false,
  };

  private readonly clock: Clock;
  private sitemap: { entries: VenueMatch[]; fetchedAt: number } | undefined;

  /**
   * @param options - Optional clock override.
   */
  constructor(options: AmcProviderOptions = {}) {
    this.clock = options.clock ?? systemClock;
  }

  /**
   * Mint an anonymous session. AMC's catalog needs no login, so this never touches the network
   * and can never be challenged.
   *
   * @param _creds - Ignored; no credentials exist for anonymous access.
   * @returns An active anonymous session.
   */
  async authenticate(_creds: ProviderCredentials): Promise<Session> {
    const now = this.clock.now();
    return {
      provider: "amc",
      state: "active",
      data: { anonymous: true },
      expiresAt: new Date(now.getTime() + ANONYMOUS_SESSION_TTL_MS).toISOString(),
      updatedAt: now.toISOString(),
    };
  }

  /**
   * Re-mint the anonymous session.
   *
   * @param _session - Ignored.
   * @param creds - Passed through to {@link AmcProvider.authenticate}.
   * @returns A fresh anonymous session.
   */
  async refresh(_session: Session, creds: ProviderCredentials): Promise<Session> {
    return this.authenticate(creds);
  }

  /**
   * Find current screenings for a watch: one showtimes page per day in range, filtered by the
   * watch's film (`item`) and format (`tiers`) before any seat-map fetch, then one seats page per
   * surviving showtime. Every emitted slot carries the full seat map and an unmasked occupancy
   * digest; sold-out showtimes are emitted too (with zero blocks) so the scan engine's gate — not
   * this adapter — decides what is alertable.
   *
   * @param watch - The watch describing theatre, date range, film, and formats.
   * @param _session - Unused; access is anonymous.
   * @returns Matching screenings, one {@link Slot} per showtime.
   * @throws {@link ProviderError} On a non-success page response.
   */
  async find(watch: Watch, _session: Session): Promise<Slot[]> {
    const theatreSlug = watch.venue.id.split("/")[1] ?? watch.venue.id;
    const range = this.resolveDateRange(watch);

    const slots: Slot[] = [];
    for (let day = range.start; day <= range.end; day = addDays(day, 1)) {
      const page = await this.fetchText(`/movie-theatres/${watch.venue.id}/showtimes?date=${day}`);
      const { movieTitles, showtimes } = parseShowtimesPage(page, theatreSlug);

      for (const showtime of showtimes) {
        const title = movieTitles.get(showtime.movieSlug) ?? showtime.movieSlug;
        if (!this.matchesItem(watch, showtime, title)) continue;
        const kind = showtime.formatCode ? (FORMAT_LABELS[showtime.formatCode] ?? showtime.formatCode) : undefined;
        if (!this.matchesTiers(watch.tiers, showtime.formatCode, kind)) continue;

        const local = utcToVenueLocal(showtime.showDateTimeUtc, watch.timezone);
        if (local.date !== day) continue; // The page lists the venue-local day; keep them aligned.
        // Filter to the watch's time window BEFORE the (expensive) seat-map fetch. The scan engine
        // re-applies this filter authoritatively; doing it here avoids fetching a seat map for every
        // showtime of the day only to discard the ones outside the window.
        if (!withinWindow(local.start.slice(0, 5), watch.timeWindow)) continue;

        // Some reserved-seating showtimes don't server-render a layout (not yet seatable, or a
        // presentation that hides the map). A missing layout is per-showtime, not per-watch: skip
        // just this one so the rest of the theatre's showtimes still scan. Real transport failures
        // (rate-limit/challenge) throw before parsing and still abort the pass for a retry.
        let seatMap: SeatMap;
        try {
          seatMap = await this.fetchSeatMap(String(showtime.showtimeId));
        } catch (err) {
          if (err instanceof ProviderError && err.errorClass === "schema-drift") continue;
          throw err;
        }
        slots.push({
          provider: "amc",
          venueId: watch.venue.id,
          date: local.date,
          start: local.start,
          resourceType: "screening",
          kind,
          seatMap,
          seating: summarizeSeatMap(seatMap),
          dedupeKey: formatDedupeKey({
            provider: "amc",
            venueId: watch.venue.id,
            date: local.date,
            start: local.start,
            partySize: watch.partySize,
            kind: `${showtime.movieSlug}:${String(showtime.showtimeId)}`,
          }),
          bookRef: String(showtime.showtimeId),
          raw: { ...showtime, title },
        });
      }
    }
    return slots;
  }

  /**
   * Fetch the seating layout for a showtime and normalise it into the shared {@link SeatMap}.
   * Also serves the picker UI via the optional provider port method.
   *
   * @param ref - The AMC showtime id.
   * @param _session - Unused; access is anonymous.
   * @returns The seat map.
   * @throws {@link ProviderError} When the page carries no layout.
   */
  async seatMap(ref: string, _session?: Session): Promise<SeatMap> {
    return this.fetchSeatMap(ref);
  }

  /**
   * List everything a theatre is showing on a date — films, formats, showtimes, and sellability —
   * from one showtimes page, without fetching any seat maps. Backs the dashboard's movie/showtime
   * picker so users pick from what's actually playing instead of typing titles.
   *
   * @param venueId - The `"{market}/{slug}"` theatre id.
   * @param date - Venue-local `YYYY-MM-DD`.
   * @param _session - Unused; access is anonymous.
   * @returns The screenings that day, in page order.
   */
  async listScreenings(venueId: string, date: string, _session?: Session): Promise<Screening[]> {
    const theatreSlug = venueId.split("/")[1] ?? venueId;
    const page = await this.fetchText(`/movie-theatres/${venueId}/showtimes?date=${date}`);
    const { movieTitles, showtimes } = parseShowtimesPage(page, theatreSlug);
    return showtimes.map((s): Screening => ({
      provider: "amc",
      ref: String(s.showtimeId),
      filmId: s.movieSlug,
      title: movieTitles.get(s.movieSlug) ?? s.movieSlug,
      format: s.formatCode ? (FORMAT_LABELS[s.formatCode] ?? s.formatCode) : undefined,
      startUtc: s.showDateTimeUtc,
      status: s.status,
    }));
  }

  /**
   * Programmatic booking is not supported (checkout is behind AMC's contract-gated APIs).
   *
   * @param _slot - Unused.
   * @param _session - Unused.
   */
  async book(_slot: Slot, _session: Session): Promise<BookResult> {
    throw new NotSupportedError("AMC bookings must be completed on amctheatres.com");
  }

  /**
   * Programmatic cancellation is not supported.
   *
   * @param _cancelRef - Unused.
   * @param _session - Unused.
   */
  async cancel(_cancelRef: string, _session: Session): Promise<void> {
    throw new NotSupportedError("AMC bookings must be managed on amctheatres.com");
  }

  /**
   * Build a deep link into AMC's own flow: the showtime's seat picker, or — when the slot carries
   * a best open block — the tickets page with those seats pre-selected.
   *
   * @param watch - The watch context.
   * @param slot - An optional specific screening to link to.
   * @returns An absolute URL.
   */
  bookingUrl(watch: Watch, slot?: Slot): string {
    if (slot?.bookRef) {
      const best = slot.seating?.blocks[0];
      if (best) {
        return `${AMC_SITE_BASE}/showtimes/${String(slot.bookRef)}/tickets?seats=${encodeURIComponent(best.seatIds.join(","))}`;
      }
      return `${AMC_SITE_BASE}/showtimes/${String(slot.bookRef)}/seats`;
    }
    return `${AMC_SITE_BASE}/movie-theatres/${watch.venue.id}/showtimes`;
  }

  /**
   * Resolve free text (theatre name, city, slug, or an amctheatres.com URL) against AMC's public
   * theatre directory (the theatres sitemap, cached for a day).
   *
   * @param query - The search string.
   * @returns Candidate theatre matches; `id` is the `"{market}/{slug}"` page-path pair.
   * @throws {@link ProviderError} On a non-success sitemap response.
   */
  async resolveVenue(query: string): Promise<VenueMatch[]> {
    const urlMatch = /movie-theatres\/([a-z0-9-]+)\/([a-z0-9-]+)/.exec(query);
    if (urlMatch) {
      const [, market, slug] = urlMatch as unknown as [string, string, string];
      return [{ provider: "amc", id: `${market}/${slug}`, slug, name: slugToName(slug), city: slugToName(market) }];
    }

    const entries = await this.theatreDirectory();
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    return entries
      .filter((v) => {
        const haystack = `${v.id} ${v.name.toLowerCase()} ${(v.city ?? "").toLowerCase()}`;
        return tokens.every((t) => haystack.includes(t));
      })
      .slice(0, 10);
  }

  /**
   * Map a raw error onto a normalised category. Cloudflare challenge responses surface as 403s
   * and classify as `challenged`.
   *
   * @param err - The thrown value.
   * @returns The normalised error class.
   */
  classifyError(err: unknown): ErrorClass {
    if (err instanceof ProviderError) return err.errorClass;
    const status = (err as { status?: unknown }).status;
    if (typeof status === "number") return classifyStatus(status);
    const message = String((err as { message?: unknown }).message ?? err).toLowerCase();
    if (/cloudflare|challenge|captcha/.test(message)) return "challenged";
    if (/rate.?limit|too many|429/.test(message)) return "rate-limited";
    return "other";
  }

  // --- internals -------------------------------------------------------------

  private matchesItem(watch: Watch, showtime: AmcShowtime, title: string): boolean {
    if (!watch.item) return true;
    if (watch.item.id) return showtime.movieSlug === watch.item.id;
    if (watch.item.query) {
      const q = watch.item.query.toLowerCase();
      return title.toLowerCase().includes(q) || showtime.movieSlug.includes(q.replaceAll(/\s+/g, "-"));
    }
    return true;
  }

  private matchesTiers(tiers: string[] | undefined, code: string | undefined, label: string | undefined): boolean {
    if (!tiers?.length) return true;
    const haystack = `${code ?? ""} ${label ?? ""}`.toLowerCase();
    return tiers.some((tier) => haystack.includes(tier.toLowerCase()));
  }

  private async fetchSeatMap(showtimeId: string): Promise<SeatMap> {
    const page = await this.fetchText(`/showtimes/${showtimeId}/seats`);
    const layout = parseSeatingLayout(page);
    if (!layout) {
      throw new ProviderError("schema-drift", `no seating layout found for showtime ${showtimeId}`);
    }
    return toSeatMap(layout);
  }

  private async theatreDirectory(): Promise<VenueMatch[]> {
    const now = this.clock.now().getTime();
    if (this.sitemap && now - this.sitemap.fetchedAt < SITEMAP_TTL_MS) return this.sitemap.entries;

    const xml = await this.fetchText("/sitemaps/sitemap-theatres.xml");
    const entries: VenueMatch[] = [];
    for (const match of xml.matchAll(/movie-theatres\/([a-z0-9-]+)\/([a-z0-9-]+)/g)) {
      const [, market, slug] = match as unknown as [string, string, string];
      entries.push({ provider: "amc", id: `${market}/${slug}`, slug, name: slugToName(slug), city: slugToName(market) });
    }
    this.sitemap = { entries, fetchedAt: now };
    return entries;
  }

  private async fetchText(path: string): Promise<string> {
    const res = await fetch(`${AMC_SITE_BASE}${path}`, {
      headers: {
        "User-Agent": AMC_CHROME_USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!res.ok) {
      const cls = classifyStatus(res.status);
      throw new ProviderError(cls, `AMC page request failed (${String(res.status)}) for ${path}`, {
        retryable: cls === "rate-limited",
      });
    }
    return res.text();
  }

  private resolveDateRange(watch: Watch): { start: string; end: string } {
    if ("rollingDays" in watch.dateRange) {
      const start = new Intl.DateTimeFormat("en-CA", {
        timeZone: watch.timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(this.clock.now());
      return { start, end: addDays(start, watch.dateRange.rollingDays) };
    }
    return { start: watch.dateRange.start, end: watch.dateRange.end };
  }
}

/** Convert AMC's raw layout into the shared {@link SeatMap}: voids dropped, rows labelled. */
function toSeatMap(layout: AmcSeatingLayout): SeatMap {
  const rowLabels = new Map<number, string>();
  const seats: Seat[] = [];
  for (const raw of layout.seats) {
    if (raw.type === "NotASeat" || raw.shouldDisplay === false) continue;
    const label = raw.name.replaceAll(/\d/g, "") || String(raw.row);
    if (!rowLabels.has(raw.row)) rowLabels.set(raw.row, label);
    seats.push({
      id: raw.name,
      row: label,
      column: raw.column,
      status: raw.available ? "available" : "taken",
      type: raw.type === "CanReserve" ? undefined : raw.type,
    });
  }
  const rows = [...rowLabels.entries()].sort((a, b) => a[0] - b[0]).map(([, label]) => label);
  return { rows, columns: layout.columns, seats };
}

/** Whether a `"HH:MM"` time falls within a venue-local window (supports a window that wraps midnight). */
function withinWindow(hhmm: string, window: { start: string; end: string }): boolean {
  return window.start <= window.end
    ? hhmm >= window.start && hhmm <= window.end
    : hhmm >= window.start || hhmm <= window.end;
}

/** Add whole days to an ISO `YYYY-MM-DD` date using UTC arithmetic to avoid DST drift. */
function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const base = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  return new Date(base + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Create an AMC {@link BookingProvider}.
 *
 * @param options - Optional clock override.
 * @returns A ready-to-use AMC provider.
 */
export function createAmcProvider(options: AmcProviderOptions = {}): AmcProvider {
  return new AmcProvider(options);
}
