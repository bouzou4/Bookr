import { fetch as undiciFetch, MockAgent } from "undici";
import { afterEach, describe, expect, it } from "vitest";
import type { Session } from "@bookr/shared";
import { pushSession, SessionPushError } from "./push.ts";
import type { FetchLike } from "./push.ts";

const BASE_URL = "https://bookr.example.com";
const INGEST_TOKEN = "test-ingest-token";

const session: Session = {
  provider: "resy",
  state: "active",
  data: { token: "t", apiKey: "k", refreshToken: "r" },
  updatedAt: "2026-07-13T00:00:00.000Z",
};

/** Route through undici's own fetch bound to a MockAgent, sidestepping global-fetch ambiguity. */
function mockedFetch(agent: MockAgent): FetchLike {
  return (url, init) =>
    undiciFetch(url, { ...init, dispatcher: agent } as Parameters<typeof undiciFetch>[1]) as unknown as Promise<Response>;
}

describe("pushSession", () => {
  let agent: MockAgent | undefined;

  afterEach(async () => {
    await agent?.close();
    agent = undefined;
  });

  it("POSTs the session to /api/ingest/:provider with the bearer token", async () => {
    agent = new MockAgent();
    agent.disableNetConnect();
    const pool = agent.get(BASE_URL);

    let capturedBody: string | undefined;
    let capturedHeaders: Record<string, string> | undefined;
    pool
      .intercept({
        path: "/api/ingest/resy",
        method: "POST",
      })
      .reply((req) => {
        capturedBody = req.body as string;
        capturedHeaders = req.headers as Record<string, string>;
        return { statusCode: 200, data: JSON.stringify({ ok: true }) };
      });

    await pushSession(BASE_URL, INGEST_TOKEN, "resy", session, { fetchImpl: mockedFetch(agent) });

    expect(JSON.parse(capturedBody ?? "{}")).toEqual({ session });
    expect(capturedHeaders?.authorization).toBe(`Bearer ${INGEST_TOKEN}`);
    expect(capturedHeaders?.["content-type"]).toBe("application/json");
  });

  it("throws SessionPushError with the status and body on a non-2xx response", async () => {
    agent = new MockAgent();
    agent.disableNetConnect();
    agent
      .get(BASE_URL)
      .intercept({ path: "/api/ingest/resy", method: "POST" })
      .reply(401, "bad ingest token");

    await expect(pushSession(BASE_URL, "wrong-token", "resy", session, { fetchImpl: mockedFetch(agent) })).rejects.toThrow(
      SessionPushError,
    );
  });

  it("includes the response status and body text on the thrown error", async () => {
    agent = new MockAgent();
    agent.disableNetConnect();
    agent.get(BASE_URL).intercept({ path: "/api/ingest/resy", method: "POST" }).reply(500, "boom");

    try {
      await pushSession(BASE_URL, INGEST_TOKEN, "resy", session, { fetchImpl: mockedFetch(agent) });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(SessionPushError);
      const error = err as SessionPushError;
      expect(error.status).toBe(500);
      expect(error.body).toBe("boom");
      expect(error.message).toContain("500");
    }
  });
});
