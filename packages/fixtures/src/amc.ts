/*
 * Representative amctheatres.com page payloads for use as mocked HTTP replies in adapter tests.
 * amctheatres.com is a Next.js RSC app: the data Bookr reads is embedded as escaped flight JSON
 * inside `self.__next_f.push([1,"…"])` script chunks. These fixtures rebuild that exact envelope
 * (escaping included) so tests exercise the same extraction path as production. Shapes mirror the
 * real pages; all ids are fabricated.
 */

/** Wrap flight content in the `self.__next_f.push` script envelope a served page carries. */
function flightPage(content: string): string {
  return `<!DOCTYPE html><html><body><script>self.__next_f.push([1,${JSON.stringify(content)}])</script></body></html>`;
}

/** One RSC showtime element's props: the showtime record plus its movie/format linkage. */
function showtimeProps(
  showtimeId: number,
  status: string,
  showDateTimeUtc: string,
  movieSlug: string,
  theatreSlug: string,
  formatCode: string,
): string {
  return JSON.stringify({
    showtime: { showtimeId, policyCodes: [], hasTrailers: true, status, showDateTimeUtc, display: {} },
    "aria-describedby": `${movieSlug} ${movieSlug}-${theatreSlug} ${movieSlug}-${theatreSlug}-${formatCode} ${movieSlug}-${theatreSlug}-${formatCode}-0-attributes`,
  });
}

/** The theatre slug all showtime fixtures belong to. */
export const AMC_FIXTURE_THEATRE_SLUG = "amc-34th-street-14";

/** The `"{market}/{slug}"` venue id matching the fixture theatre. */
export const AMC_FIXTURE_VENUE_ID = "new-york-city/amc-34th-street-14";

/**
 * `GET /movie-theatres/{market}/{slug}/showtimes?date=2026-07-17` — two films: The Odyssey IMAX
 * 70mm (one Sellable evening showtime, one Soldout matinee) and Moana in RealD 3D (AlmostFull).
 * Times are UTC; July in America/New_York is UTC-4, so 2026-07-18T00:00Z renders as 8:00 pm on
 * the 17th.
 */
export const amcShowtimesPageHtml = flightPage(
  [
    // The film-filter options carrying slug → display title.
    '["$","option","the-odyssey-80679",{"value":"the-odyssey-80679","children":"The Odyssey – IMAX 70mm Event"}]',
    '["$","option","moana-72474",{"value":"moana-72474","children":"Moana"}]',
    // Showtime elements, as `["$","$L89",null,{props}]` fragments.
    `["$","$L89",null,${showtimeProps(144408726, "Sellable", "2026-07-18T00:00:00.000Z", "the-odyssey-80679", AMC_FIXTURE_THEATRE_SLUG, "imax70mm")}]`,
    `["$","$L89",null,${showtimeProps(144408720, "Soldout", "2026-07-17T17:30:00.000Z", "the-odyssey-80679", AMC_FIXTURE_THEATRE_SLUG, "imax70mm")}]`,
    `["$","$L89",null,${showtimeProps(143870768, "AlmostFull", "2026-07-17T22:15:00.000Z", "moana-72474", AMC_FIXTURE_THEATRE_SLUG, "reald3d")}]`,
  ].join(","),
);

/** A raw AMC seat position for the seating-layout fixture. */
function rawSeat(name: string, row: number, column: number, available: boolean, type = "CanReserve"): object {
  return { available, column, row, name, type, seatTier: "Regular", shouldDisplay: true };
}

/**
 * `GET /showtimes/{id}/seats` — a 3-row × 6-column auditorium. Seat names run right-to-left
 * against the column index, exactly as AMC renders (column 1 of row A is "A6"). Row A is fully
 * open; row B has a NotASeat void at column 4 and two taken seats; row C holds a wheelchair
 * space (taken) and its companion.
 */
export const amcSeatsPageHtml = flightPage(
  `{"showtime":{"attributes":{"edges":[{"node":{"code":"reclinerseating"}},{"node":{"code":"imax70mm"}}]},"seatingLayout":${JSON.stringify(
    {
      columns: 6,
      rows: 3,
      seats: [
        rawSeat("A6", 1, 1, true),
        rawSeat("A5", 1, 2, true),
        rawSeat("A4", 1, 3, true),
        rawSeat("A3", 1, 4, true),
        rawSeat("A2", 1, 5, true),
        rawSeat("A1", 1, 6, true),
        rawSeat("B6", 2, 1, false),
        rawSeat("B5", 2, 2, false),
        rawSeat("B4", 2, 3, true),
        { available: false, column: 4, row: 2, name: "", type: "NotASeat", seatTier: "", shouldDisplay: false },
        rawSeat("B2", 2, 5, true),
        rawSeat("B1", 2, 6, true),
        rawSeat("C6", 3, 1, false, "Wheelchair"),
        rawSeat("C5", 3, 2, true, "Companion"),
      ],
    },
  )}}`,
);

/** `GET /showtimes/{id}/seats` for a sold-out house: same geometry, every seat taken. */
export const amcSeatsSoldOutPageHtml = flightPage(
  `{"seatingLayout":${JSON.stringify({
    columns: 6,
    rows: 1,
    seats: [rawSeat("A2", 1, 1, false), rawSeat("A1", 1, 2, false)],
  })}}`,
);

/**
 * `GET /showtimes/{id}/seats` for a reserved-seating showtime that does NOT server-render a
 * layout (seen in the wild for not-yet-seatable or specially-presented showtimes): the page
 * exists and is reserved seating, but embeds no `seatingLayout`.
 */
export const amcSeatsNoLayoutPageHtml = flightPage(
  `{"showtime":{"isReservedSeating":true,"attributes":{"edges":[]}}}`,
);

/** `GET /sitemaps/sitemap-theatres.xml` — a three-theatre excerpt of the 522-entry directory. */
export const amcTheatresSitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>https://www.amctheatres.com/movie-theatres/new-york-city/amc-34th-street-14</loc></url>
<url><loc>https://www.amctheatres.com/movie-theatres/new-york-city/amc-empire-25</loc></url>
<url><loc>https://www.amctheatres.com/movie-theatres/los-angeles/amc-the-grove-14</loc></url>
</urlset>`;
