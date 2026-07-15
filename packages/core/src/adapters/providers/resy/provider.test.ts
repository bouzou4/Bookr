import {
  RESY_PUBLIC_API_KEY,
  resyAuthPasswordResponse,
  resyBookResponse,
  resyCalendarResponse,
  resyCancelResponse,
  resyDetailsResponse,
  resyFindResponse,
  resyUserResponse,
  resyVenueSearchResponse,
} from "@bookr/fixtures";
import { FakeClock } from "@bookr/testkit";
import type { ProviderCredentials, Session, Watch } from "@bookr/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockAgent, type Dispatcher, getGlobalDispatcher, setGlobalDispatcher } from "undici";

import { ProviderError } from "../../../errors.ts";
import { ResyProvider, createResyProvider } from "./provider.ts";
import { readResySessionData } from "./session.ts";

const CREDS: ProviderCredentials = { username: "diner@example.test", password: "hunter2" };

function makeWatch(overrides: Partial<Watch> = {}): Watch {
  return {
    id: "w1",
    provider: "resy",
    label: "Carbone dinner",
    venue: { id: "6194", slug: "carbone" },
    resourceType: "table",
    partySize: 2,
    dateRange: { start: "2026-07-20", end: "2026-07-21" },
    timeWindow: { start: "18:00", end: "21:00" },
    timezone: "America/New_York",
    autobook: false,
    enabled: true,
    createdAt: "2026-07-01T00:00:00Z",
    updatedAt: "2026-07-01T00:00:00Z",
    ...overrides,
  };
}

function activeSession(overrides: Record<string, unknown> = {}): Session {
  return {
    provider: "resy",
    state: "active",
    data: {
      token: "access-token",
      refreshToken: "refresh-123",
      apiKey: RESY_PUBLIC_API_KEY,
      paymentMethodId: 31876445,
      paymentMethods: [{ id: 31876445, type: "amex", display: "1004" }],
      ...overrides,
    },
    updatedAt: "2026-07-13T00:00:00Z",
  };
}

let mockAgent: MockAgent;
let original: Dispatcher;
let api: ReturnType<MockAgent["get"]>;

beforeEach(() => {
  original = getGlobalDispatcher();
  mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);
  api = mockAgent.get("https://api.resy.com");
});

afterEach(async () => {
  setGlobalDispatcher(original);
  await mockAgent.close();
});

function newProvider(): ResyProvider {
  return new ResyProvider({ clock: new FakeClock() });
}

describe("ResyProvider capabilities", () => {
  it("advertises headless auth and single-phase autobook", () => {
    const provider = createResyProvider();
    expect(provider.name).toBe("resy");
    expect(provider.capabilities).toEqual({ headlessAuth: true, autobook: true, twoPhaseBook: false });
  });
});

describe("authenticate", () => {
  it("captures token, refresh cookie, GDA flags, and the Amex payment method", async () => {
    api
      .intercept({ path: "/4/auth/password", method: "POST" })
      .reply(200, resyAuthPasswordResponse, {
        headers: { "set-cookie": "production_refresh_token=REFRESH-XYZ; Path=/; HttpOnly" },
      });
    api.intercept({ path: "/2/user", method: "GET" }).reply(200, resyUserResponse);

    const session = await newProvider().authenticate(CREDS);
    const data = readResySessionData(session);

    expect(session.state).toBe("active");
    expect(data.token).toBe(resyAuthPasswordResponse.token);
    expect(data.refreshToken).toBe("REFRESH-XYZ");
    expect(data.globalDiningAccess).toBe(true);
    expect(data.guestId).toBe(987654);
    expect(data.paymentMethodId).toBe(31876445);
  });

  it("falls back to the v3 auth endpoint when v4 is absent", async () => {
    api.intercept({ path: "/4/auth/password", method: "POST" }).reply(404, {});
    api.intercept({ path: "/3/auth/password", method: "POST" }).reply(200, resyAuthPasswordResponse);
    api.intercept({ path: "/2/user", method: "GET" }).reply(200, resyUserResponse);

    const session = await newProvider().authenticate(CREDS);
    expect(readResySessionData(session).token).toBe(resyAuthPasswordResponse.token);
  });

  it("throws a classified ProviderError on a rejected login", async () => {
    api.intercept({ path: "/4/auth/password", method: "POST" }).reply(400, { message: "bad" });
    await expect(newProvider().authenticate(CREDS)).rejects.toBeInstanceOf(ProviderError);
  });

  it("still returns a session when the profile call fails", async () => {
    api.intercept({ path: "/4/auth/password", method: "POST" }).reply(200, resyAuthPasswordResponse);
    api.intercept({ path: "/2/user", method: "GET" }).reply(500, {});
    const session = await newProvider().authenticate(CREDS);
    expect(session.state).toBe("active");
  });
});

describe("refresh", () => {
  it("renews the access token from the refresh cookie", async () => {
    api.intercept({ path: "/3/auth/refresh", method: "POST" }).reply(200, { token: "new-token" });
    api.intercept({ path: "/2/user", method: "GET" }).reply(200, resyUserResponse);

    const session = await newProvider().refresh(activeSession(), CREDS);
    expect(readResySessionData(session).token).toBe("new-token");
  });

  it("fails as auth-expired when there is no refresh token", async () => {
    const session = activeSession({ refreshToken: undefined });
    await expect(newProvider().refresh(session, CREDS)).rejects.toMatchObject({ errorClass: "auth-expired" });
  });

  it("classifies a rejected refresh token as auth-expired", async () => {
    api.intercept({ path: "/3/auth/refresh", method: "POST" }).reply(401, {}).times(2);
    // 401 triggers a single api_key self-heal retry; both attempts fail.
    mockAgent
      .get("https://resy.com")
      .intercept({ path: "/", method: "GET" })
      .reply(200, "<script src=\"/modules/app.deadbeef.js\"></script>");
    mockAgent
      .get("https://resy.com")
      .intercept({ path: "/modules/app.deadbeef.js", method: "GET" })
      .reply(200, 'x=1;apiKey:"HEALED";y=2');
    await expect(newProvider().refresh(activeSession(), CREDS)).rejects.toMatchObject({ errorClass: "auth-expired" });
  });
});

describe("find", () => {
  it("queries the calendar then only fans out to available days", async () => {
    api.intercept({ path: /^\/4\/venue\/calendar/, method: "GET" }).reply(200, resyCalendarResponse);
    api.intercept({ path: /^\/4\/find/, method: "GET" }).reply(200, resyFindResponse);

    const slots = await newProvider().find(makeWatch(), activeSession());
    expect(slots).toHaveLength(1);
    const [slot] = slots;
    expect(slot?.date).toBe("2026-07-20");
    expect(slot?.start).toBe("18:15:00");
    expect(slot?.kind).toBe("Bar Counter");
    expect(slot?.bookRef).toBe(resyFindResponse.results.venues[0]?.slots[0]?.config.token);
    expect(slot?.exclusive).toBeUndefined();
    expect(slot?.dedupeKey).toContain("resy:6194:2026-07-20:181500:2:1521665");
    expect(slot?.raw).toBeDefined();
  });

  it("returns no slots when the calendar has no available days", async () => {
    api.intercept({ path: /^\/4\/venue\/calendar/, method: "GET" }).reply(200, {
      scheduled: [{ date: "2026-07-20", inventory: { reservation: "sold-out" } }],
    });
    const slots = await newProvider().find(makeWatch(), activeSession());
    expect(slots).toEqual([]);
  });

  it("tags Global Dining Access slots as exclusive", async () => {
    api.intercept({ path: /^\/4\/venue\/calendar/, method: "GET" }).reply(200, resyCalendarResponse);
    api.intercept({ path: /^\/4\/find/, method: "GET" }).reply(200, {
      results: {
        venues: [
          {
            slots: [
              {
                date: { start: "2026-07-20 19:00:00" },
                config: { id: 99, type: "Global Dining Access", token: "rgs://resy/6194/99", is_global_dining_access: true },
              },
            ],
          },
        ],
      },
    });
    const slots = await newProvider().find(makeWatch(), activeSession());
    expect(slots[0]?.exclusive).toBe(true);
  });

  it("falls back to POST when the find GET is rejected as method-not-allowed", async () => {
    api.intercept({ path: /^\/4\/venue\/calendar/, method: "GET" }).reply(200, resyCalendarResponse);
    api.intercept({ path: /^\/4\/find/, method: "GET" }).reply(405, {});
    api.intercept({ path: /^\/4\/find/, method: "POST" }).reply(200, resyFindResponse);
    const slots = await newProvider().find(makeWatch(), activeSession());
    expect(slots).toHaveLength(1);
  });

  it("resolves a rolling date range against venue-local today", async () => {
    let calendarPath = "";
    api
      .intercept({ path: /^\/4\/venue\/calendar/, method: "GET" })
      .reply((opts) => {
        calendarPath = String(opts.path);
        return { statusCode: 200, data: JSON.stringify({ scheduled: [] }) };
      });
    await newProvider().find(makeWatch({ dateRange: { rollingDays: 3 } }), activeSession());
    expect(calendarPath).toContain("start_date=2026-07-13");
    expect(calendarPath).toContain("end_date=2026-07-16");
  });
});

describe("resolveVenue", () => {
  it("maps venue-search hits to VenueMatch", async () => {
    api.intercept({ path: "/3/venuesearch/search", method: "POST" }).reply(200, resyVenueSearchResponse);
    const matches = await newProvider().resolveVenue("carbone");
    expect(matches).toEqual([{ provider: "resy", id: "6194", slug: "carbone", name: "Carbone", city: "New York" }]);
  });
});

describe("book", () => {
  function bookableSlot() {
    return {
      provider: "resy" as const,
      venueId: "6194",
      date: "2026-07-20",
      start: "18:15:00",
      resourceType: "table" as const,
      dedupeKey: "resy:6194:2026-07-20:181500:2:1521665",
      bookRef: "rgs://resy/6194/1521665/2/2026-07-20/2026-07-20/18:15:00/2/Bar Counter",
    };
  }

  it("books a slot that needs no payment method", async () => {
    api.intercept({ path: "/3/details", method: "POST" }).reply(200, resyDetailsResponse);
    api.intercept({ path: "/3/book", method: "POST" }).reply(201, resyBookResponse);
    const result = await newProvider().book(bookableSlot(), activeSession());
    expect(result).toMatchObject({
      status: "booked",
      confirmationId: "123456789",
      cancelRef: resyBookResponse.resy_token,
    });
  });

  it("retries with the Amex payment method after a 402", async () => {
    api.intercept({ path: "/3/details", method: "POST" }).reply(200, resyDetailsResponse);
    api.intercept({ path: "/3/book", method: "POST" }).reply(402, { message: "payment required" });
    api.intercept({ path: "/3/book", method: "POST" }).reply(200, resyBookResponse);
    const result = await newProvider().book(bookableSlot(), activeSession());
    expect(result.status).toBe("booked");
  });

  it("reports a vanished slot when details 404s", async () => {
    api.intercept({ path: "/3/details", method: "POST" }).reply(404, {});
    const result = await newProvider().book(bookableSlot(), activeSession());
    expect(result).toMatchObject({ status: "failed", detail: "slot no longer available" });
  });

  it("returns challenged when the booking hits a captcha", async () => {
    api.intercept({ path: "/3/details", method: "POST" }).reply(200, resyDetailsResponse);
    api.intercept({ path: "/3/book", method: "POST" }).reply(403, "please solve this captcha");
    const result = await newProvider().book(bookableSlot(), activeSession());
    expect(result.status).toBe("challenged");
  });

  it("throws auth-expired on a 419 from the booking endpoint", async () => {
    api.intercept({ path: "/3/details", method: "POST" }).reply(200, resyDetailsResponse);
    api.intercept({ path: "/3/book", method: "POST" }).reply(419, "unauthorized");
    await expect(newProvider().book(bookableSlot(), activeSession())).rejects.toMatchObject({
      errorClass: "auth-expired",
    });
  });

  it("fails when the book token has already expired", async () => {
    api.intercept({ path: "/3/details", method: "POST" }).reply(200, {
      book_token: { value: "tok", date_expires: "2020-01-01T00:00:00Z" },
    });
    const result = await newProvider().book(bookableSlot(), activeSession());
    expect(result).toMatchObject({ status: "failed", detail: "book token expired before use" });
  });
});

describe("cancel", () => {
  it("cancels a booking by resy_token", async () => {
    let sentBody = "";
    api
      .intercept({ path: "/3/cancel", method: "POST" })
      .reply((opts) => {
        sentBody = String(opts.body);
        return { statusCode: 200, data: JSON.stringify(resyCancelResponse) };
      });
    await expect(newProvider().cancel("resy-token-abc", activeSession())).resolves.toBeUndefined();
    expect(sentBody).toContain("resy_token=resy-token-abc");
  });

  it("throws a classified ProviderError on a rejected cancellation", async () => {
    api.intercept({ path: "/3/cancel", method: "POST" }).reply(404, {});
    await expect(newProvider().cancel("resy-token-abc", activeSession())).rejects.toMatchObject({
      errorClass: "not-found",
    });
  });
});

describe("bookingUrl", () => {
  it("builds a widget deep link carrying venue, party, and date", () => {
    const url = newProvider().bookingUrl(makeWatch());
    expect(url).toContain("https://widgets.resy.com/?");
    expect(url).toContain("venueId=6194");
    expect(url).toContain("seats=2");
    expect(url).toContain("date=2026-07-20");
  });
});

describe("classifyError", () => {
  const provider = newProvider();

  it("passes through a ProviderError class", () => {
    expect(provider.classifyError(new ProviderError("rate-limited", "slow"))).toBe("rate-limited");
  });

  it("maps HTTP status codes", () => {
    expect(provider.classifyError({ status: 401 })).toBe("auth-expired");
    expect(provider.classifyError({ status: 403 })).toBe("challenged");
    expect(provider.classifyError({ statusCode: 404 })).toBe("not-found");
    expect(provider.classifyError({ status: 429 })).toBe("rate-limited");
    expect(provider.classifyError({ status: 500 })).toBe("rate-limited");
    expect(provider.classifyError({ status: 418 })).toBe("other");
  });

  it("falls back to message inspection", () => {
    expect(provider.classifyError(new Error("captcha required"))).toBe("challenged");
    expect(provider.classifyError(new Error("rate-limit hit"))).toBe("rate-limited");
    expect(provider.classifyError(new Error("something not found"))).toBe("not-found");
    expect(provider.classifyError("weird")).toBe("other");
  });
});

describe("api_key self-heal", () => {
  it("scrapes a fresh api_key and retries once after a 401", async () => {
    api.intercept({ path: "/3/venuesearch/search", method: "POST" }).reply(401, {});
    api.intercept({ path: "/3/venuesearch/search", method: "POST" }).reply(200, resyVenueSearchResponse);
    const site = mockAgent.get("https://resy.com");
    site.intercept({ path: "/", method: "GET" }).reply(200, '<script src="/modules/app.abc123.js"></script>');
    site.intercept({ path: "/modules/app.abc123.js", method: "GET" }).reply(200, 'window.x={apiKey:"HEALED-KEY"};');

    const matches = await newProvider().resolveVenue("carbone");
    expect(matches).toHaveLength(1);
  });
});

describe("readResySessionData", () => {
  it("rejects a session with no token", () => {
    const session: Session = { provider: "resy", state: "expired", data: {}, updatedAt: "2026-07-13T00:00:00Z" };
    expect(() => readResySessionData(session)).toThrow(/missing an access token/);
  });
});
