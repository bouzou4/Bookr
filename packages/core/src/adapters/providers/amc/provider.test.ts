import {
  AMC_FIXTURE_VENUE_ID,
  amcSeatsNoLayoutPageHtml,
  amcSeatsPageHtml,
  amcSeatsSoldOutPageHtml,
  amcShowtimesPageHtml,
  amcTheatresSitemapXml,
} from "@bookr/fixtures";
import { FakeClock } from "@bookr/testkit";
import type { Session, Watch } from "@bookr/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockAgent, type Dispatcher, getGlobalDispatcher, setGlobalDispatcher } from "undici";

import { NotSupportedError } from "../../../errors.ts";
import { AmcProvider, createAmcProvider } from "./provider.ts";

function makeWatch(overrides: Partial<Watch> = {}): Watch {
  return {
    id: "w1",
    provider: "amc",
    label: "Odyssey 70mm",
    venue: { id: AMC_FIXTURE_VENUE_ID },
    resourceType: "screening",
    partySize: 2,
    dateRange: { start: "2026-07-17", end: "2026-07-17" },
    timeWindow: { start: "12:00", end: "23:00" },
    timezone: "America/New_York",
    autobook: false,
    enabled: true,
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

async function anonymousSession(provider: AmcProvider): Promise<Session> {
  return provider.authenticate({});
}

let mockAgent: MockAgent;
let original: Dispatcher;
let site: ReturnType<MockAgent["get"]>;

beforeEach(() => {
  original = getGlobalDispatcher();
  mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);
  site = mockAgent.get("https://www.amctheatres.com");
});

afterEach(async () => {
  setGlobalDispatcher(original);
  await mockAgent.close();
});

function mockShowtimesPage(): void {
  site
    .intercept({ path: `/movie-theatres/${AMC_FIXTURE_VENUE_ID}/showtimes?date=2026-07-17`, method: "GET" })
    .reply(200, amcShowtimesPageHtml);
}

describe("AmcProvider", () => {
  it("mints an anonymous session without touching the network", async () => {
    const clock = new FakeClock(new Date("2026-07-15T12:00:00Z"));
    const provider = createAmcProvider({ clock });
    const session = await provider.authenticate({});
    expect(session.state).toBe("active");
    expect(session.data).toEqual({ anonymous: true });
    expect(session.expiresAt).toBe("2026-07-16T12:00:00.000Z");
  });

  it("finds showtimes with venue-local times, seat maps, and occupancy digests", async () => {
    mockShowtimesPage();
    site.intercept({ path: "/showtimes/144408726/seats", method: "GET" }).reply(200, amcSeatsPageHtml);
    site.intercept({ path: "/showtimes/144408720/seats", method: "GET" }).reply(200, amcSeatsSoldOutPageHtml);
    site.intercept({ path: "/showtimes/143870768/seats", method: "GET" }).reply(200, amcSeatsPageHtml);
    const provider = createAmcProvider();

    const slots = await provider.find(makeWatch(), await anonymousSession(provider));

    expect(slots).toHaveLength(3);
    const odyssey = slots.find((s) => s.bookRef === "144408726");
    expect(odyssey?.date).toBe("2026-07-17");
    expect(odyssey?.start).toBe("20:00:00"); // 2026-07-18T00:00Z in America/New_York (UTC-4).
    expect(odyssey?.kind).toBe("IMAX 70mm");
    expect(odyssey?.resourceType).toBe("screening");
    expect(odyssey?.dedupeKey).toBe(
      `amc:${AMC_FIXTURE_VENUE_ID}:2026-07-17:200000:2:the-odyssey-80679:144408726`,
    );
    // 13 sellable seats (the NotASeat void is dropped), 10 open: A1-A6, B4, B2-B1, C5.
    expect(odyssey?.seating?.totalSeats).toBe(13);
    expect(odyssey?.seating?.availableSeats).toBe(10);
    expect(odyssey?.seatMap?.rows).toEqual(["A", "B", "C"]);

    // The sold-out matinee is still emitted (zero blocks) — the scan engine owns the gate.
    const soldOut = slots.find((s) => s.bookRef === "144408720");
    expect(soldOut?.seating?.blocks).toEqual([]);
  });

  it("filters showtimes to the watch's time window before fetching any seat map", async () => {
    mockShowtimesPage();
    // Window 19:00–21:00 keeps only the 20:00 Odyssey showtime; the 17:30 matinee and 22:15 Moana
    // fall outside, so their seats pages must never be requested (no intercept registered for them).
    site.intercept({ path: "/showtimes/144408726/seats", method: "GET" }).reply(200, amcSeatsPageHtml);
    const provider = createAmcProvider();

    const slots = await provider.find(
      makeWatch({ timeWindow: { start: "19:00", end: "21:00" } }),
      await anonymousSession(provider),
    );

    expect(slots.map((s) => s.bookRef)).toEqual(["144408726"]);
  });

  it("skips a showtime whose seats page has no layout instead of failing the whole scan", async () => {
    mockShowtimesPage();
    site.intercept({ path: "/showtimes/144408726/seats", method: "GET" }).reply(200, amcSeatsPageHtml);
    // The Soldout matinee renders no seating layout — it must be skipped, not abort the pass.
    site.intercept({ path: "/showtimes/144408720/seats", method: "GET" }).reply(200, amcSeatsNoLayoutPageHtml);
    site.intercept({ path: "/showtimes/143870768/seats", method: "GET" }).reply(200, amcSeatsPageHtml);
    const provider = createAmcProvider();

    const slots = await provider.find(makeWatch(), await anonymousSession(provider));

    expect(slots.map((s) => s.bookRef).sort()).toEqual(["143870768", "144408726"]);
  });

  it("filters by item query and by format tiers before fetching seat maps", async () => {
    mockShowtimesPage();
    site.intercept({ path: "/showtimes/144408726/seats", method: "GET" }).reply(200, amcSeatsPageHtml);
    site.intercept({ path: "/showtimes/144408720/seats", method: "GET" }).reply(200, amcSeatsSoldOutPageHtml);
    const provider = createAmcProvider();

    // "odyssey" matches both Odyssey showtimes and excludes Moana; no Moana seats fetch occurs
    // (the mock would 501 on an unmatched intercept).
    const slots = await provider.find(
      makeWatch({ item: { query: "odyssey" }, tiers: ["70mm"] }),
      await anonymousSession(provider),
    );

    expect(slots.map((s) => s.bookRef).sort()).toEqual(["144408720", "144408726"]);
    expect(slots.every((s) => s.raw && (s.raw as { title: string }).title.includes("Odyssey"))).toBe(true);
  });

  it("builds deep links: seat picker plain, tickets page with the best block pre-selected", async () => {
    const provider = createAmcProvider();
    const watch = makeWatch();
    const base = {
      provider: "amc" as const,
      venueId: watch.venue.id,
      date: "2026-07-17",
      start: "20:00:00",
      resourceType: "screening" as const,
      dedupeKey: "k",
      bookRef: "144408726",
    };

    expect(provider.bookingUrl(watch, base)).toBe("https://www.amctheatres.com/showtimes/144408726/seats");
    expect(
      provider.bookingUrl(watch, {
        ...base,
        seating: {
          totalSeats: 10,
          availableSeats: 3,
          percentTaken: 70,
          blocks: [{ row: "F", seatIds: ["F5", "F6"], size: 2, position: "center", depth: "middle" }],
        },
      }),
    ).toBe("https://www.amctheatres.com/showtimes/144408726/tickets?seats=F5%2CF6");
    expect(provider.bookingUrl(watch)).toBe(
      `https://www.amctheatres.com/movie-theatres/${AMC_FIXTURE_VENUE_ID}/showtimes`,
    );
  });

  it("resolves venues from the theatres sitemap and from pasted URLs", async () => {
    site.intercept({ path: "/sitemaps/sitemap-theatres.xml", method: "GET" }).reply(200, amcTheatresSitemapXml);
    const provider = createAmcProvider();

    const byName = await provider.resolveVenue("34th street");
    expect(byName).toHaveLength(1);
    expect(byName[0]).toMatchObject({ provider: "amc", id: AMC_FIXTURE_VENUE_ID, name: "AMC 34th Street 14" });

    // URL form needs no directory fetch (the sitemap is already cached anyway).
    const byUrl = await provider.resolveVenue(
      "https://www.amctheatres.com/movie-theatres/los-angeles/amc-the-grove-14/showtimes",
    );
    expect(byUrl[0]).toMatchObject({ id: "los-angeles/amc-the-grove-14", city: "Los Angeles" });
  });

  it("lists screenings (movies, formats, showtimes) without fetching seat maps", async () => {
    mockShowtimesPage();
    const provider = createAmcProvider();

    const screenings = await provider.listScreenings(AMC_FIXTURE_VENUE_ID, "2026-07-17");

    // All three fixture showtimes, with titles resolved from the film-filter options.
    expect(screenings).toHaveLength(3);
    const odyssey = screenings.find((s) => s.ref === "144408726");
    expect(odyssey).toMatchObject({
      provider: "amc",
      filmId: "the-odyssey-80679",
      title: "The Odyssey – IMAX 70mm Event",
      format: "IMAX 70mm",
      status: "Sellable",
    });
    // No seats intercept was registered — proving listScreenings fetches no seat maps.
    expect(screenings.find((s) => s.ref === "144408720")?.status).toBe("Soldout");
  });

  it("exposes seat maps for the picker UI via the optional port method", async () => {
    site.intercept({ path: "/showtimes/144408726/seats", method: "GET" }).reply(200, amcSeatsPageHtml);
    const provider = createAmcProvider();

    const map = await provider.seatMap("144408726");

    expect(map.columns).toBe(6);
    expect(map.rows).toEqual(["A", "B", "C"]);
    const wheelchair = map.seats.find((s) => s.id === "C6");
    expect(wheelchair).toMatchObject({ status: "taken", type: "Wheelchair" });
    // Void positions are dropped entirely; the column gap is what breaks adjacency.
    expect(map.seats.some((s) => s.row === "B" && s.column === 4)).toBe(false);
  });

  it("declines programmatic booking and classifies challenge responses", async () => {
    const provider = createAmcProvider();
    const session = await anonymousSession(provider);
    const slot = {
      provider: "amc" as const,
      venueId: "x",
      date: "2026-07-17",
      start: "20:00:00",
      resourceType: "screening" as const,
      dedupeKey: "k",
    };
    await expect(provider.book(slot, session)).rejects.toBeInstanceOf(NotSupportedError);
    await expect(provider.cancel("ref", session)).rejects.toBeInstanceOf(NotSupportedError);

    site.intercept({ path: "/showtimes/1/seats", method: "GET" }).reply(403, "cloudflare challenge");
    const err = await provider.seatMap("1").catch((e: unknown) => e);
    expect(provider.classifyError(err)).toBe("challenged");
  });
});
