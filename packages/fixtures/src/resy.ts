/*
 * Representative Resy API response payloads for use as mocked HTTP replies in adapter tests.
 * Shapes mirror the real api.resy.com responses; all tokens and ids are fabricated.
 */

/** The public web api_key Resy's browser client sends on every request. */
export const RESY_PUBLIC_API_KEY = "VbWk7s3L4KiK5fzlO7JD3Q5EYolJI7n5";

/** `POST /4/auth/password` — token in body; the refresh token arrives via Set-Cookie. */
export const resyAuthPasswordResponse = {
  token: "eyJ0eXAiOiJKV1QiLCJhbGciOiJFUzI1NiJ9.FAKE.SIGNATURE",
  payment_methods: [{ id: 31876445 }],
};

/** `GET /2/user` — profile including Global Dining Access flags and the Amex payment method. */
export const resyUserResponse = {
  guest_id: 987654,
  payment_method_id: 31876445,
  payment_methods: [{ id: 31876445, type: "amex", display: "1004" }],
  is_global_dining_access: true,
  is_platinum_night_eligible: true,
  is_rga: false,
  feature_flags: {},
};

/** `GET /4/find` — one available slot at Carbone. */
export const resyFindResponse = {
  results: {
    venues: [
      {
        venue: { id: { resy: 6194 }, name: "Carbone" },
        slots: [
          {
            date: { start: "2026-07-20 18:15:00", end: "2026-07-20 20:15:00" },
            config: {
              id: 1521665,
              type: "Bar Counter",
              token: "rgs://resy/6194/1521665/2/2026-07-20/2026-07-20/18:15:00/2/Bar Counter",
              is_visible: true,
            },
          },
        ],
      },
    ],
  },
};

/** `GET /4/venue/calendar` — one available day, one sold-out day. */
export const resyCalendarResponse = {
  scheduled: [
    { date: "2026-07-20", inventory: { reservation: "available" } },
    { date: "2026-07-21", inventory: { reservation: "sold-out" } },
  ],
};

/** `POST /3/details` — the short-lived book_token and available payment methods. */
export const resyDetailsResponse = {
  book_token: {
    value: "7TWgoK_Vi5aSUfHvc6pN|jXBy9PG_FAKE",
    date_expires: "2026-07-20T23:01:37Z",
  },
  user: {
    payment_methods: [{ id: 31876445, is_default: true, provider: "stripe", display: "1004" }],
  },
};

/** `POST /3/book` — successful booking confirmation. */
export const resyBookResponse = {
  resy_token: "wF4wAvd6kAYiXDjhFqrhOoUsTlKKolFgwarZ-FAKE",
  reservation_id: 123456789,
  venue_opt_in: false,
};

/** `POST /3/cancel` — successful cancellation acknowledgement. */
export const resyCancelResponse = {
  cancelled: true,
};

/** `POST /3/venuesearch/search` — slug/name resolution to a numeric venue id. */
export const resyVenueSearchResponse = {
  search: {
    hits: [{ id: { resy: 6194 }, name: "Carbone", url_slug: "carbone", location: { name: "New York" } }],
  },
};
