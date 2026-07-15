import { describe, expect, it } from "vitest";
import { HttpResponse, http } from "msw";
import { server } from "../test/server.ts";
import { sampleActivityEvent, sampleHealth, sampleWatch } from "../test/fixtures.ts";
import { ApiError, api } from "./client.ts";

describe("api client", () => {
  it("lists watches", async () => {
    const watches = await api.watches.list();
    expect(watches).toEqual([sampleWatch]);
  });

  it("creates a watch", async () => {
    const created = await api.watches.create({
      provider: "resy",
      label: "New watch",
      venue: { id: "9" },
      resourceType: "table",
      partySize: 2,
      dateRange: { rollingDays: 7 },
      timeWindow: { start: "18:00", end: "20:00" },
      timezone: "America/New_York",
      autobook: false,
      enabled: true,
    });
    expect(created.label).toBe("New watch");
    expect(created.id).toBe("w2");
  });

  it("deletes a watch (204 with no body)", async () => {
    await expect(api.watches.remove("w1")).resolves.toBeUndefined();
  });

  it("fetches activity with query params", async () => {
    server.use(
      http.get("/api/activity", ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get("limit")).toBe("5");
        expect(url.searchParams.get("type")).toBe("booked");
        return HttpResponse.json([sampleActivityEvent]);
      }),
    );
    const events = await api.activity.recent({ limit: 5, type: "booked" });
    expect(events).toHaveLength(1);
  });

  it("fetches health", async () => {
    const health = await api.health.status();
    expect(health).toEqual(sampleHealth);
  });

  it("sends the ingest bearer token, not a cookie", async () => {
    server.use(
      http.post("/api/ingest/resy", ({ request }) => {
        expect(request.headers.get("authorization")).toBe("Bearer secret-token");
        return new HttpResponse(null, { status: 200 });
      }),
    );
    await expect(api.credentials.ingest("resy", "secret-token", { token: "abc" })).resolves.toBeUndefined();
  });

  it("throws an ApiError with the server's error message on failure", async () => {
    server.use(
      http.get("/api/watches", () => HttpResponse.json({ error: "nope" }, { status: 401 })),
    );
    await expect(api.watches.list()).rejects.toMatchObject({ status: 401, message: "nope" });
  });

  it("falls back to status text when the error body isn't JSON", async () => {
    server.use(http.get("/api/watches", () => new HttpResponse("plain text", { status: 500 })));
    const err = await api.watches.list().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
  });

  it("books a slot", async () => {
    const result = await api.booking.book("w1", "resy:1234:2026-07-20:190000:2:");
    expect(result.status).toBe("booked");
  });

  it("runs a scan for all watches and for a single watch", async () => {
    await expect(api.scan.runAll()).resolves.toMatchObject({ watchesScanned: 1 });
    await expect(api.watches.scan("w1")).resolves.toMatchObject({ watchesScanned: 1 });
  });

  it("resolves venues and checks availability", async () => {
    await expect(api.venues.resolve("resy", "carbone")).resolves.toEqual([]);
    await expect(
      api.availability.check({ provider: "resy", venueId: "1234", date: "2026-07-20", partySize: 2 }),
    ).resolves.toEqual([]);
  });

  it("logs in and out", async () => {
    await expect(api.auth.login("correct-password")).resolves.toBeUndefined();
    await expect(api.auth.logout()).resolves.toBeUndefined();
  });
});
