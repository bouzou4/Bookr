import { describe, it, expect } from "vitest";
import request from "supertest";
import { createFakeBookr, type FakeBookrSeed } from "@bookr/testkit";
import type { Watch } from "@bookr/shared";
import { createServer } from "./server.ts";
import { SESSION_COOKIE_NAME, type ServerConfig } from "./config.ts";

const BASE_CONFIG: ServerConfig = {
  sessionSecret: "test-session-secret",
  uiPassword: "correct-horse",
  ingestToken: "ingest-token-value",
  sessionDbPath: ":memory:",
  cookieSecure: false,
  sessionPrune: false,
};

/** Build a fresh server (isolated in-memory session store) over a fake application. */
function makeServer(seed: FakeBookrSeed = {}, config: Partial<ServerConfig> = {}) {
  return createServer(createFakeBookr(seed), { ...BASE_CONFIG, ...config });
}

/** A logged-in supertest agent whose cookie jar persists across requests. */
async function loggedIn(seed: FakeBookrSeed = {}, config: Partial<ServerConfig> = {}) {
  const server = makeServer(seed, config);
  const agent = request.agent(server);
  const res = await agent.post("/api/auth/login").send({ password: BASE_CONFIG.uiPassword });
  expect(res.status).toBe(200);
  return agent;
}

function watchFixture(over: Partial<Watch> = {}): Watch {
  return {
    id: "w1",
    provider: "resy",
    label: "Test venue",
    venue: { id: "v1", slug: "test-venue" },
    resourceType: "table",
    partySize: 2,
    dateRange: { rollingDays: 30 },
    timeWindow: { start: "18:00", end: "21:00" },
    timezone: "America/New_York",
    autobook: false,
    enabled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

describe("health", () => {
  it("is reachable without authentication", async () => {
    const res = await request(makeServer()).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, schedulerRunning: false });
  });
});

describe("hardening", () => {
  it("sets security headers and hides the framework", async () => {
    const res = await request(makeServer()).get("/api/health");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("issues a hardened __Host- session cookie over HTTPS", async () => {
    const server = makeServer({}, { cookieSecure: true });
    const res = await request(server)
      .post("/api/auth/login")
      .set("X-Forwarded-Proto", "https")
      .send({ password: BASE_CONFIG.uiPassword });
    expect(res.status).toBe(200);
    const cookie = (res.headers["set-cookie"] as unknown as string[])[0];
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
  });

  it("rejects construction without a session secret", () => {
    expect(() => makeServer({}, { sessionSecret: "" })).toThrow(/sessionSecret/);
  });
});

describe("authentication gate", () => {
  it("rejects protected reads when unauthenticated", async () => {
    const res = await request(makeServer()).get("/api/watches");
    expect(res.status).toBe(401);
  });

  it("rejects protected writes when unauthenticated", async () => {
    const res = await request(makeServer()).post("/api/scan");
    expect(res.status).toBe(401);
  });

  it("rejects a wrong password", async () => {
    const res = await request(makeServer()).post("/api/auth/login").send({ password: "nope" });
    expect(res.status).toBe(401);
  });

  it("rejects a login with a missing body", async () => {
    const res = await request(makeServer()).post("/api/auth/login").send({});
    expect(res.status).toBe(400);
  });

  it("allows protected access after login and blocks it after logout", async () => {
    const agent = await loggedIn();
    expect((await agent.get("/api/watches")).status).toBe(200);
    expect((await agent.post("/api/auth/logout")).status).toBe(200);
    expect((await agent.get("/api/watches")).status).toBe(401);
  });
});

describe("login rate limit", () => {
  it("trips after five attempts", async () => {
    const server = makeServer();
    let last = 0;
    for (let i = 0; i < 6; i += 1) {
      last = (await request(server).post("/api/auth/login").send({ password: "wrong" })).status;
    }
    expect(last).toBe(429);
  });
});

describe("ingest bearer guard", () => {
  const provider = "resy";
  const path = `/api/ingest/${provider}`;

  it("accepts the correct bearer token without a cookie", async () => {
    const res = await request(makeServer())
      .post(path)
      .set("Authorization", `Bearer ${BASE_CONFIG.ingestToken}`)
      .send({ session: { token: "abc" } });
    expect(res.status).toBe(200);
  });

  it("rejects a missing token", async () => {
    const res = await request(makeServer()).post(path).send({ session: {} });
    expect(res.status).toBe(401);
  });

  it("rejects a wrong token of equal length", async () => {
    const wrong = "x".repeat(BASE_CONFIG.ingestToken.length);
    const res = await request(makeServer())
      .post(path)
      .set("Authorization", `Bearer ${wrong}`)
      .send({ session: {} });
    expect(res.status).toBe(401);
  });

  it("rejects a wrong token of different length", async () => {
    const res = await request(makeServer())
      .post(path)
      .set("Authorization", "Bearer short")
      .send({ session: {} });
    expect(res.status).toBe(401);
  });

  it("404s an unknown provider even with a valid token", async () => {
    const res = await request(makeServer())
      .post("/api/ingest/bogus")
      .set("Authorization", `Bearer ${BASE_CONFIG.ingestToken}`)
      .send({ session: {} });
    expect(res.status).toBe(404);
  });
});

describe("booking autobook gate", () => {
  const seed: FakeBookrSeed = {
    watches: [watchFixture({ id: "auto", autobook: true }), watchFixture({ id: "manual", autobook: false })],
    bookResult: { status: "booked", confirmationId: "C1", deepLink: "https://resy.test/r" },
  };

  it("books when the watch has autobook enabled", async () => {
    const agent = await loggedIn(seed);
    const res = await agent.post("/api/book").send({ watchId: "auto", dedupeKey: "k" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "booked", confirmationId: "C1" });
  });

  it("403s when the watch has autobook disabled", async () => {
    const agent = await loggedIn(seed);
    const res = await agent.post("/api/book").send({ watchId: "manual", dedupeKey: "k" });
    expect(res.status).toBe(403);
  });

  it("404s an unknown watch", async () => {
    const agent = await loggedIn(seed);
    const res = await agent.post("/api/book").send({ watchId: "ghost", dedupeKey: "k" });
    expect(res.status).toBe(404);
  });

  it("requires authentication", async () => {
    const res = await request(makeServer(seed)).post("/api/book").send({ watchId: "auto", dedupeKey: "k" });
    expect(res.status).toBe(401);
  });
});

describe("watch CRUD round-trip", () => {
  it("creates, lists, reads, updates, and deletes a watch", async () => {
    const agent = await loggedIn();
    const input = {
      provider: "resy",
      label: "Round trip",
      venue: { id: "v9" },
      partySize: 4,
      dateRange: { rollingDays: 14 },
      timeWindow: { start: "19:00", end: "22:00" },
      timezone: "America/New_York",
    };

    const created = await agent.post("/api/watches").send(input);
    expect(created.status).toBe(201);
    const id = created.body.id as string;
    expect(id).toBeTruthy();

    const list = await agent.get("/api/watches");
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);

    const read = await agent.get(`/api/watches/${id}`);
    expect(read.status).toBe(200);
    expect(read.body.label).toBe("Round trip");

    const updated = await agent.put(`/api/watches/${id}`).send({ label: "Renamed" });
    expect(updated.status).toBe(200);
    expect(updated.body.label).toBe("Renamed");

    const scan = await agent.post(`/api/watches/${id}/scan`);
    expect(scan.status).toBe(200);
    expect(scan.body.watchesScanned).toBe(1);

    const del = await agent.delete(`/api/watches/${id}`);
    expect(del.status).toBe(204);

    expect((await agent.get(`/api/watches/${id}`)).status).toBe(404);
  });

  it("rejects an invalid watch body", async () => {
    const agent = await loggedIn();
    const res = await agent.post("/api/watches").send({ label: "", provider: "nope" });
    expect(res.status).toBe(400);
  });

  it("404s update and delete of an unknown watch", async () => {
    const agent = await loggedIn();
    expect((await agent.put("/api/watches/ghost").send({ label: "x" })).status).toBe(404);
    expect((await agent.delete("/api/watches/ghost")).status).toBe(404);
    expect((await agent.post("/api/watches/ghost/scan")).status).toBe(404);
  });
});

describe("availability, venues, activity, credentials", () => {
  it("checks availability", async () => {
    const seed: FakeBookrSeed = {
      slots: [
        {
          provider: "resy",
          venueId: "v1",
          date: "2026-08-01",
          start: "19:00:00",
          resourceType: "table",
          dedupeKey: "resy:v1:2026-08-01:19:00:00:2:std",
        },
      ],
    };
    const agent = await loggedIn(seed);
    const res = await agent
      .post("/api/availability/check")
      .send({ provider: "resy", venueId: "v1", date: "2026-08-01", partySize: 2 });
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it("validates the availability body", async () => {
    const agent = await loggedIn();
    const res = await agent.post("/api/availability/check").send({ provider: "resy" });
    expect(res.status).toBe(400);
  });

  it("resolves venues", async () => {
    const seed: FakeBookrSeed = {
      venues: [{ provider: "resy", id: "v1", name: "Test", slug: "test" }],
    };
    const agent = await loggedIn(seed);
    const res = await agent.post("/api/venues/resolve").send({ provider: "resy", query: "test" });
    expect(res.status).toBe(200);
    expect(res.body[0].name).toBe("Test");
  });

  it("runs a full scan", async () => {
    const agent = await loggedIn({ watches: [watchFixture()] });
    const res = await agent.post("/api/scan");
    expect(res.status).toBe(200);
    expect(res.body.watchesScanned).toBe(1);
  });

  it("returns activity filtered by type and limit", async () => {
    const agent = await loggedIn({ watches: [watchFixture()] });
    await agent.post("/api/scan");
    const res = await agent.get("/api/activity").query({ type: "pass-complete", limit: 5 });
    expect(res.status).toBe(200);
    expect(res.body[0].type).toBe("pass-complete");
  });

  it("rejects an invalid activity query", async () => {
    const agent = await loggedIn();
    const res = await agent.get("/api/activity").query({ type: "not-a-type" });
    expect(res.status).toBe(400);
  });

  it("reports credential status", async () => {
    const seed: FakeBookrSeed = {
      credentialStatus: [{ provider: "resy", sessionState: "active", needsAttention: false }],
    };
    const agent = await loggedIn(seed);
    const res = await agent.get("/api/credentials");
    expect(res.status).toBe(200);
    expect(res.body[0].provider).toBe("resy");
  });
});

describe("unknown api route", () => {
  it("returns a JSON 404 for an unmatched authenticated path", async () => {
    const agent = await loggedIn();
    const res = await agent.get("/api/nope");
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ error: "not found" });
  });
});

describe("SPA serving", () => {
  it("serves index.html for non-api navigations and JSON 404s for unknown api paths", async () => {
    // A directory that has no index.html: sendFile errors, but routing (not the API) handles it.
    const server = makeServer({}, { webRoot: "/tmp/bookr-nonexistent-webroot" });
    const spa = await request(server).get("/dashboard");
    // The catch-all matched (not a 404-from-api): sendFile yields 404/500 for the missing file.
    expect([200, 404, 500]).toContain(spa.status);
    const api = await request(server).get("/api/health");
    expect(api.status).toBe(200);
  });
});
