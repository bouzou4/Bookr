import { describe, expect, it } from "vitest";
import * as fixtures from "./index.ts";

describe("resy fixtures", () => {
  it("exposes the api key and representative payloads", () => {
    expect(fixtures.RESY_PUBLIC_API_KEY).toMatch(/^[A-Za-z0-9]+$/);
    expect(fixtures.resyAuthPasswordResponse.token).toContain("FAKE");
    expect(fixtures.resyUserResponse.is_global_dining_access).toBe(true);
    expect(fixtures.resyFindResponse.results.venues[0]?.slots).toHaveLength(1);
    expect(fixtures.resyCalendarResponse.scheduled[0]?.inventory.reservation).toBe("available");
    expect(fixtures.resyDetailsResponse.book_token.value).toContain("|");
    expect(fixtures.resyBookResponse.reservation_id).toBeGreaterThan(0);
    expect(fixtures.resyCancelResponse.cancelled).toBe(true);
    expect(fixtures.resyVenueSearchResponse.search.hits[0]?.url_slug).toBe("carbone");
  });
});
