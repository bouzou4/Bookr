/**
 * A {@link BookingProvider} for Resy. It translates Resy's private web API — auth, profile,
 * availability, and booking endpoints — into the shared Bookr vocabulary, carrying the mandatory
 * browser-like header set on every request and self-healing the public api_key when it is rotated.
 *
 * @packageDocumentation
 */

import {
  type BookResult,
  type ErrorClass,
  type ProviderCapabilities,
  type ProviderCredentials,
  type ProviderName,
  type Session,
  type Slot,
  type VenueMatch,
  type Watch,
  formatDedupeKey,
  parseDedupeKey,
} from "@bookr/shared";

import type { BookingProvider } from "../../../ports/booking-provider.ts";
import type { Clock } from "../../../ports/clock.ts";
import { ProviderError } from "../../../errors.ts";
import { type ResyPaymentMethod, type ResySessionData, readResySessionData } from "./session.ts";

/** Base URL of Resy's API host. */
const RESY_API_BASE = "https://api.resy.com";
/** Origin of resy.com used to scrape a fresh api_key when the baked-in key is rejected. */
const RESY_SITE_BASE = "https://resy.com";
/** The public web api_key Resy's browser client has shipped for years; the self-heal fallback. */
const RESY_DEFAULT_API_KEY = "VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5";
/** A real Chrome User-Agent; Resy returns 500 when this header is absent. */
const RESY_CHROME_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";
/** Origin/Referer Resy's booking widget sends; required to pass origin checks. */
const RESY_WIDGET_ORIGIN = "https://widgets.resy.com";
/** Fallback JWT lifetime (~45 days) when a token cannot be decoded for its expiry. */
const DEFAULT_TOKEN_TTL_MS = 45 * 24 * 60 * 60 * 1000;

/** A minimal {@link Clock} backed by the real system time. */
const systemClock: Clock = {
  now: () => new Date(),
  sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** Construction options for {@link ResyProvider}. */
export interface ResyProviderOptions {
  /** Clock used for all time comparisons; inject a fake in tests. Defaults to system time. */
  clock?: Clock;
  /** Override the initial api_key (otherwise the shipped default is used, with scrape fallback). */
  apiKey?: string;
}

/** Options passed to the internal request helper. */
interface RequestOptions {
  /** Access token to send as the Resy auth headers. */
  token?: string;
  /** Query-string parameters. */
  query?: Record<string, string | number>;
  /** Form-urlencoded body fields. */
  form?: Record<string, string>;
  /** JSON body. */
  json?: unknown;
  /** Extra request headers (merged over the mandatory set). */
  headers?: Record<string, string>;
  /** Cookie header value (used to present the refresh token). */
  cookie?: string;
  /** When false, do not attempt an api_key self-heal on 401/403. Defaults to true. */
  heal?: boolean;
}

/**
 * Booking provider implementation for Resy.
 *
 * All calls carry the browser-like header set Resy demands; availability uses a
 * calendar→find fan-out so only days the venue calendar reports as available are queried; and
 * booking follows the details→book flow, attaching a payment method only when the venue requires
 * one and preferring the American Express card to retain Global Dining Access perks.
 */
export class ResyProvider implements BookingProvider {
  /** This provider serves Resy. */
  readonly name: ProviderName = "resy";

  /** Resy supports headless auth and programmatic single-phase booking. */
  readonly capabilities: ProviderCapabilities = {
    headlessAuth: true,
    autobook: true,
    twoPhaseBook: false,
  };

  private readonly clock: Clock;
  private apiKey: string;
  private apiKeyHealed = false;

  /**
   * @param options - Optional clock and api_key overrides.
   */
  constructor(options: ResyProviderOptions = {}) {
    this.clock = options.clock ?? systemClock;
    this.apiKey = options.apiKey ?? RESY_DEFAULT_API_KEY;
  }

  /**
   * Log in with an email/password and capture a full Resy session: the access token, the
   * `production_refresh_token` cookie, and the account's Global Dining Access flags and preferred
   * payment method.
   *
   * @param creds - Resy credentials (`username` = email, `password`).
   * @returns An active session.
   * @throws {@link ProviderError} On authentication failure.
   */
  async authenticate(creds: ProviderCredentials): Promise<Session> {
    if (creds.apiKey) this.apiKey = creds.apiKey;
    const email = creds.username ?? "";
    const password = creds.password ?? "";
    const form = { email, password };

    let res = await this.request("POST", "/4/auth/password", { form });
    if (res.status === 404 || res.status === 405) {
      res = await this.request("POST", "/3/auth/password", { form });
    }
    if (!res.ok) throw this.errorFor(res, "authentication failed");

    const body = (await res.json()) as { token?: string; payment_methods?: { id: number }[] };
    if (typeof body.token !== "string") {
      throw new ProviderError("other", "Resy auth response had no token");
    }

    const refreshToken = this.readRefreshCookie(res);
    const data: ResySessionData = {
      token: body.token,
      refreshToken,
      apiKey: this.apiKey,
      paymentMethods: body.payment_methods,
    };
    await this.hydrateProfile(data);
    return this.sessionFrom(data);
  }

  /**
   * Renew the access token using the stored `production_refresh_token`, then re-read the profile.
   *
   * @param session - The current session carrying a refresh token.
   * @param creds - Credentials, used only to re-apply an api_key override.
   * @returns A refreshed active session.
   * @throws {@link ProviderError} With class `auth-expired` when the refresh token is rejected.
   */
  async refresh(session: Session, creds: ProviderCredentials): Promise<Session> {
    if (creds.apiKey) this.apiKey = creds.apiKey;
    const data = readResySessionData(session);
    if (data.apiKey) this.apiKey = data.apiKey;
    if (!data.refreshToken) {
      throw new ProviderError("auth-expired", "no Resy refresh token to renew with");
    }

    const res = await this.request("POST", "/3/auth/refresh", {
      cookie: `production_refresh_token=${data.refreshToken}`,
      form: {},
    });
    if (!res.ok) throw this.errorFor(res, "token refresh failed");

    const body = (await res.json()) as { token?: string };
    if (typeof body.token !== "string") {
      throw new ProviderError("auth-expired", "Resy refresh response had no token");
    }

    const next: ResySessionData = {
      ...data,
      token: body.token,
      refreshToken: this.readRefreshCookie(res) ?? data.refreshToken,
      apiKey: this.apiKey,
    };
    await this.hydrateProfile(next);
    return this.sessionFrom(next);
  }

  /**
   * Find current availability for a watch using a calendar→find fan-out: the venue calendar is
   * queried once for the whole date range, then the slot endpoint is called only for the days the
   * calendar reports as available.
   *
   * @param watch - The watch describing venue, date range, and party size.
   * @param session - An active session.
   * @returns Matching openings, one {@link Slot} per Resy configuration.
   * @throws {@link ProviderError} On a non-success response.
   */
  async find(watch: Watch, session: Session): Promise<Slot[]> {
    const data = readResySessionData(session);
    if (data.apiKey) this.apiKey = data.apiKey;
    const range = this.resolveDateRange(watch);

    const calRes = await this.request("GET", "/4/venue/calendar", {
      token: data.token,
      headers: { "Accept-Encoding": "deflate, gzip" },
      query: {
        venue_id: watch.venue.id,
        num_seats: watch.partySize,
        start_date: range.start,
        end_date: range.end,
      },
    });
    if (!calRes.ok) throw this.errorFor(calRes, "venue calendar request failed");

    const calendar = (await calRes.json()) as {
      scheduled?: { date: string; inventory?: { reservation?: string } }[];
    };
    const availableDays = (calendar.scheduled ?? [])
      .filter((d) => d.inventory?.reservation === "available")
      .filter((d) => d.date >= range.start && d.date <= range.end)
      .map((d) => d.date);

    const slots: Slot[] = [];
    for (const day of availableDays) {
      const daySlots = await this.findDay(watch, data, day);
      slots.push(...daySlots);
    }
    return slots;
  }

  /**
   * Book a slot via the details→book flow.
   *
   * A fresh, short-lived `book_token` is fetched from `/3/details`; the booking is then submitted
   * to `/3/book`, adding a payment method only if the first attempt is rejected for payment. A
   * captcha challenge yields a `challenged` result with a deep link for manual completion.
   *
   * @param slot - The slot to book (its `bookRef` holds the Resy config token).
   * @param session - An active session.
   * @returns The booking outcome.
   * @throws {@link ProviderError} With class `auth-expired` when the session is unauthorized.
   */
  async book(slot: Slot, session: Session): Promise<BookResult> {
    const data = readResySessionData(session);
    if (data.apiKey) this.apiKey = data.apiKey;
    const configId = slot.bookRef;
    if (typeof configId !== "string" || configId.length === 0) {
      throw new ProviderError("other", "slot has no Resy book reference");
    }
    const partySize = parseDedupeKey(slot.dedupeKey).partySize;
    const deepLink = this.deepLinkForSlot(slot, partySize);

    const detailsRes = await this.request("POST", "/3/details", {
      token: data.token,
      form: { config_id: configId, day: slot.date, party_size: String(partySize) },
    });
    if (detailsRes.status === 404) {
      return { status: "failed", deepLink, detail: "slot no longer available" };
    }
    if (!detailsRes.ok) throw this.errorFor(detailsRes, "booking details request failed");

    const details = (await detailsRes.json()) as {
      book_token?: { value?: string; date_expires?: string };
      user?: { payment_methods?: ResyPaymentMethod[] };
    };
    const bookToken = details.book_token?.value;
    if (typeof bookToken !== "string") {
      return { status: "failed", deepLink, detail: "no book token returned" };
    }
    const expires = details.book_token?.date_expires;
    if (expires && new Date(expires).getTime() <= this.clock.now().getTime()) {
      return { status: "failed", deepLink, detail: "book token expired before use" };
    }

    const paymentMethodId = this.preferredPaymentMethod(data, details.user?.payment_methods);

    let res = await this.request("POST", "/3/book", { token: data.token, form: { book_token: bookToken } });
    if (res.status === 402 && paymentMethodId != null) {
      res = await this.request("POST", "/3/book", {
        token: data.token,
        form: { book_token: bookToken, struct_payment_method: JSON.stringify({ id: paymentMethodId }) },
      });
    }
    return this.interpretBookResponse(res, deepLink);
  }

  /**
   * Cancel a booking via Resy's cancellation endpoint.
   *
   * @param cancelRef - The `resy_token` captured when the booking was made.
   * @param session - An active session.
   * @throws {@link ProviderError} On a non-success response.
   */
  async cancel(cancelRef: string, session: Session): Promise<void> {
    const data = readResySessionData(session);
    if (data.apiKey) this.apiKey = data.apiKey;

    const res = await this.request("POST", "/3/cancel", {
      token: data.token,
      form: { resy_token: cancelRef },
    });
    if (!res.ok) throw this.errorFor(res, "cancellation failed");
  }

  /**
   * Build a user-facing deep link into the Resy booking widget.
   *
   * @param watch - The watch context.
   * @param slot - An optional specific slot to preselect.
   * @returns An absolute widget URL.
   */
  bookingUrl(watch: Watch, slot?: Slot): string {
    const params = new URLSearchParams({ venueId: watch.venue.id, seats: String(watch.partySize) });
    const date = slot?.date ?? this.firstDate(watch);
    if (date) params.set("date", date);
    if (slot?.start) params.set("time", slot.start.slice(0, 5));
    return `${RESY_WIDGET_ORIGIN}/?${params.toString()}`;
  }

  /**
   * Resolve free text (name, slug, or URL) to candidate Resy venues. Resy has no slug lookup, so
   * this uses the unauthenticated venue-search endpoint and returns its fuzzy hits.
   *
   * @param query - The search string.
   * @returns Candidate venue matches.
   * @throws {@link ProviderError} On a non-success response.
   */
  async resolveVenue(query: string): Promise<VenueMatch[]> {
    const res = await this.request("POST", "/3/venuesearch/search", {
      json: { query, per_page: 10 },
    });
    if (!res.ok) throw this.errorFor(res, "venue search failed");

    const body = (await res.json()) as {
      search?: { hits?: { id?: { resy?: number }; url_slug?: string; name?: string; location?: { name?: string } }[] };
    };
    const hits = body.search?.hits ?? [];
    return hits
      .map((hit): VenueMatch | undefined => {
        const id = hit.id?.resy;
        if (id == null) return undefined;
        return {
          provider: "resy",
          id: String(id),
          slug: hit.url_slug,
          name: hit.name ?? String(id),
          city: hit.location?.name,
        };
      })
      .filter((m): m is VenueMatch => m !== undefined);
  }

  /**
   * Map a raw error onto a normalised category. {@link ProviderError} instances pass through their
   * class; HTTP-status-bearing errors map by code (401/419 → auth, 403 → challenged, 404 →
   * not-found, 429 and 5xx → rate-limited, per Resy's ambiguous CloudFront enforcement).
   *
   * @param err - The thrown value.
   * @returns The normalised error class.
   */
  classifyError(err: unknown): ErrorClass {
    if (err instanceof ProviderError) return err.errorClass;
    const status = this.extractStatus(err);
    if (status != null) return classifyStatus(status);
    const message = String((err as { message?: unknown })?.message ?? err).toLowerCase();
    if (/captcha|challenge/.test(message)) return "challenged";
    if (/rate.?limit|too many|429/.test(message)) return "rate-limited";
    if (/not found|404/.test(message)) return "not-found";
    return "other";
  }

  // --- internals -------------------------------------------------------------

  private async findDay(watch: Watch, data: ResySessionData, day: string): Promise<Slot[]> {
    const query = { lat: 0, long: 0, day, party_size: watch.partySize, venue_id: watch.venue.id };
    let res = await this.request("GET", "/4/find", { token: data.token, query });
    if (res.status === 405) {
      res = await this.request("POST", "/4/find", { token: data.token, json: query });
    }
    if (!res.ok) throw this.errorFor(res, `availability request failed for ${day}`);

    const body = (await res.json()) as {
      results?: { venues?: { slots?: unknown[] }[] };
    };
    const venues = body.results?.venues ?? [];
    const slots: Slot[] = [];
    for (const venue of venues) {
      for (const raw of venue.slots ?? []) {
        const mapped = this.mapSlot(watch, raw);
        if (mapped) slots.push(mapped);
      }
    }
    return slots;
  }

  private mapSlot(watch: Watch, raw: unknown): Slot | undefined {
    const slot = raw as {
      date?: { start?: string };
      config?: { id?: number | string; type?: string; token?: string; is_global_dining_access?: boolean };
      is_global_dining_access?: boolean;
    };
    const dateStart = slot.date?.start;
    if (typeof dateStart !== "string") return undefined;
    const [date, start] = dateStart.split(" ");
    if (!date || !start) return undefined;

    const config = slot.config ?? {};
    const kind = typeof config.type === "string" ? config.type : undefined;
    const configId = config.id != null ? String(config.id) : undefined;
    const exclusive = this.isExclusive(slot, config) ? true : undefined;

    return {
      provider: "resy",
      venueId: watch.venue.id,
      date,
      start,
      resourceType: watch.resourceType,
      kind,
      exclusive,
      dedupeKey: formatDedupeKey({
        provider: "resy",
        venueId: watch.venue.id,
        date,
        start,
        partySize: watch.partySize,
        kind: configId,
      }),
      bookRef: typeof config.token === "string" ? config.token : undefined,
      raw,
    };
  }

  private isExclusive(
    slot: { is_global_dining_access?: boolean },
    config: { is_global_dining_access?: boolean },
  ): boolean {
    // Rely only on Resy's authoritative boolean marker. Matching the human-readable seating-type
    // name is not a reliable Global Dining Access signal and risks false positives.
    return slot.is_global_dining_access === true || config.is_global_dining_access === true;
  }

  private preferredPaymentMethod(data: ResySessionData, fromDetails?: ResyPaymentMethod[]): number | undefined {
    const pools = [fromDetails, data.paymentMethods];
    for (const pool of pools) {
      const amex = pool?.find((pm) => pm.type === "amex");
      if (amex) return amex.id;
    }
    if (data.paymentMethodId != null) return data.paymentMethodId;
    return fromDetails?.[0]?.id ?? data.paymentMethods?.[0]?.id;
  }

  private async interpretBookResponse(res: Response, deepLink: string): Promise<BookResult> {
    const text = await res.text();
    if (isCaptcha(res.status, text)) {
      return { status: "challenged", deepLink, detail: "Resy presented a captcha; complete the booking manually" };
    }
    if (res.ok) {
      const body = safeJson(text) as { reservation_id?: number | string; resy_token?: string };
      const confirmationId = body.reservation_id != null ? String(body.reservation_id) : (body.resy_token ?? "");
      if (confirmationId.length === 0) {
        // A 2xx with neither a reservation id nor a token: the reservation cannot be confirmed or
        // later cancelled, so surface it as unconfirmed rather than reporting a false success.
        return { status: "locked-unconfirmed", deepLink, detail: "Resy accepted the request but returned no confirmation id" };
      }
      return { status: "booked", confirmationId, deepLink, cancelRef: body.resy_token };
    }
    if (res.status === 419) {
      throw new ProviderError("auth-expired", "Resy booking rejected the session (419)", { detail: text.slice(0, 200) });
    }
    if (res.status === 404) {
      return { status: "failed", deepLink, detail: "slot no longer available" };
    }
    if (res.status === 402) {
      return { status: "failed", deepLink, detail: "payment method required and unavailable" };
    }
    if (res.status === 403) {
      return { status: "challenged", deepLink, detail: "Resy blocked the booking request" };
    }
    return { status: "failed", deepLink, detail: `booking failed (${res.status})` };
  }

  private async hydrateProfile(data: ResySessionData): Promise<void> {
    let res: Response;
    try {
      res = await this.request("GET", "/2/user", { token: data.token });
    } catch {
      return;
    }
    if (!res.ok) return;
    const body = (await res.json()) as {
      guest_id?: number;
      payment_method_id?: number;
      payment_methods?: ResyPaymentMethod[];
      is_global_dining_access?: boolean;
      is_platinum_night_eligible?: boolean;
      is_rga?: boolean;
      feature_flags?: unknown;
    };
    data.guestId = body.guest_id;
    data.paymentMethods = body.payment_methods ?? data.paymentMethods;
    const amex = data.paymentMethods?.find((pm) => pm.type === "amex");
    data.paymentMethodId = amex?.id ?? body.payment_method_id ?? data.paymentMethodId;
    data.globalDiningAccess = body.is_global_dining_access;
    data.platinumNightEligible = body.is_platinum_night_eligible;
    data.rga = body.is_rga;
    data.featureFlags = body.feature_flags;
  }

  private sessionFrom(data: ResySessionData): Session {
    const now = this.clock.now();
    return {
      provider: "resy",
      state: "active",
      data,
      expiresAt: new Date(jwtExpiry(data.token) ?? now.getTime() + DEFAULT_TOKEN_TTL_MS).toISOString(),
      updatedAt: now.toISOString(),
    };
  }

  private resolveDateRange(watch: Watch): { start: string; end: string } {
    if ("rollingDays" in watch.dateRange) {
      const start = this.venueLocalToday(watch.timezone);
      return { start, end: addDays(start, watch.dateRange.rollingDays) };
    }
    return { start: watch.dateRange.start, end: watch.dateRange.end };
  }

  private firstDate(watch: Watch): string {
    if ("rollingDays" in watch.dateRange) return this.venueLocalToday(watch.timezone);
    return watch.dateRange.start;
  }

  private venueLocalToday(timezone: string): string {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(this.clock.now());
  }

  private deepLinkForSlot(slot: Slot, partySize: number): string {
    const params = new URLSearchParams({
      venueId: slot.venueId,
      seats: String(partySize),
      date: slot.date,
      time: slot.start.slice(0, 5),
    });
    return `${RESY_WIDGET_ORIGIN}/?${params.toString()}`;
  }

  private readRefreshCookie(res: Response): string | undefined {
    for (const cookie of readSetCookies(res)) {
      const match = /(?:^|\s)production_refresh_token=([^;]+)/.exec(cookie);
      if (match?.[1]) return match[1];
    }
    return undefined;
  }

  private errorFor(res: Response, message: string): ProviderError {
    const cls = classifyStatus(res.status);
    return new ProviderError(cls, `${message} (${res.status})`, {
      retryable: cls === "rate-limited",
      detail: `HTTP ${res.status}`,
    });
  }

  private extractStatus(err: unknown): number | undefined {
    const record = err as { status?: unknown; statusCode?: unknown };
    if (typeof record?.status === "number") return record.status;
    if (typeof record?.statusCode === "number") return record.statusCode;
    return undefined;
  }

  private async request(method: string, path: string, options: RequestOptions = {}): Promise<Response> {
    const send = (): Promise<Response> => this.rawFetch(method, path, options);
    let res = await send();
    if (res.status === 401 && options.heal !== false && !this.apiKeyHealed) {
      this.apiKeyHealed = true;
      await this.selfHealApiKey();
      res = await send();
    }
    return res;
  }

  private async rawFetch(method: string, path: string, options: RequestOptions): Promise<Response> {
    const url = new URL(path, RESY_API_BASE);
    if (options.query) {
      for (const [key, value] of Object.entries(options.query)) url.searchParams.set(key, String(value));
    }

    const headers: Record<string, string> = {
      Authorization: `ResyAPI api_key="${this.apiKey}"`,
      "User-Agent": RESY_CHROME_USER_AGENT,
      Origin: RESY_WIDGET_ORIGIN,
      Referer: `${RESY_WIDGET_ORIGIN}/`,
      ...options.headers,
    };
    if (options.token) {
      headers["X-Resy-Auth-Token"] = options.token;
      headers["X-Resy-Universal-Auth"] = options.token;
    }
    if (options.cookie) headers["Cookie"] = options.cookie;

    let body: string | undefined;
    if (options.form) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      body = new URLSearchParams(options.form).toString();
    } else if (options.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(options.json);
    }

    return fetch(url, { method, headers, body });
  }

  private async selfHealApiKey(): Promise<void> {
    try {
      const htmlRes = await fetch(`${RESY_SITE_BASE}/`, { headers: { "User-Agent": RESY_CHROME_USER_AGENT } });
      const html = await htmlRes.text();
      const scriptMatch = /modules\/app\.[A-Za-z0-9]+\.js/.exec(html);
      if (!scriptMatch) return;
      const jsRes = await fetch(`${RESY_SITE_BASE}/${scriptMatch[0]}`, {
        headers: { "User-Agent": RESY_CHROME_USER_AGENT },
      });
      const js = await jsRes.text();
      const keyMatch = /apiKey:"([^"]+)"/.exec(js);
      if (keyMatch?.[1]) this.apiKey = keyMatch[1];
    } catch {
      // A failed self-heal leaves the current key in place; the caller surfaces the original error.
    }
  }
}

/** Read all `Set-Cookie` header values from a response across runtime variations. */
function readSetCookies(res: Response): string[] {
  const getSetCookie = (res.headers as { getSetCookie?: () => string[] }).getSetCookie;
  if (typeof getSetCookie === "function") return getSetCookie.call(res.headers);
  const single = res.headers.get("set-cookie");
  return single ? [single] : [];
}

/** Decode a JWT's `exp` claim (ms) without verifying its signature, or undefined on failure. */
function jwtExpiry(token: string): number | undefined {
  const parts = token.split(".");
  if (parts.length < 2 || !parts[1]) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64").toString("utf8")) as { exp?: number };
    return typeof payload.exp === "number" ? payload.exp * 1000 : undefined;
  } catch {
    return undefined;
  }
}

/** Add whole days to an ISO `YYYY-MM-DD` date using UTC arithmetic to avoid DST drift. */
function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const base = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1);
  return new Date(base + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
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

/** Detect a captcha/challenge in a booking response. */
function isCaptcha(status: number, text: string): boolean {
  return /captcha|recaptcha|are you human|challenge/i.test(text) || (status === 403 && /verify/i.test(text));
}

/** Parse JSON, returning an empty object rather than throwing on malformed bodies. */
function safeJson(text: string): unknown {
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

/**
 * Create a Resy {@link BookingProvider}.
 *
 * @param options - Optional clock and api_key overrides.
 * @returns A ready-to-use Resy provider.
 */
export function createResyProvider(options: ResyProviderOptions = {}): ResyProvider {
  return new ResyProvider(options);
}
