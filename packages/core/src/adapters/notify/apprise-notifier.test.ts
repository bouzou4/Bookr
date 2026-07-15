import { MockAgent, setGlobalDispatcher, getGlobalDispatcher } from "undici";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppriseNotifier } from "./apprise-notifier.ts";

const APPRISE_URL = "http://apprise.internal:8000";
const APPRISE_KEY = "bookr";

/** JSON body captured from an intercepted apprise request. */
interface CapturedBody {
  title: string;
  body: string;
  type: string;
  tag: string;
  format: string;
}

let mockAgent: MockAgent;
let originalDispatcher: ReturnType<typeof getGlobalDispatcher>;

beforeEach(() => {
  originalDispatcher = getGlobalDispatcher();
  mockAgent = new MockAgent();
  mockAgent.disableNetConnect();
  setGlobalDispatcher(mockAgent);
});

afterEach(() => {
  setGlobalDispatcher(originalDispatcher);
});

function notifier(): AppriseNotifier {
  return new AppriseNotifier({ url: APPRISE_URL, key: APPRISE_KEY });
}

describe("AppriseNotifier", () => {
  it("sends exactly two POSTs for an urgent severity: a call TwiML body and an sms/email plain body", async () => {
    const pool = mockAgent.get(APPRISE_URL);
    const bodies: CapturedBody[] = [];
    pool
      .intercept({
        path: `/notify/${APPRISE_KEY}`,
        method: "POST",
      })
      .reply((req) => {
        bodies.push(JSON.parse(req.body as string) as CapturedBody);
        return { statusCode: 200, data: { success: true } };
      })
      .times(2);

    await notifier().notify("urgent", {
      title: "Table freed",
      body: "A table for 2 opened at Carbone",
      link: "https://bookr.example.com/book/abc123",
    });

    expect(bodies).toHaveLength(2);

    const call = bodies.find((b) => b.tag === "call");
    const text = bodies.find((b) => b.tag === "sms, email");

    expect(call).toBeDefined();
    expect(call?.body).toMatch(/^<Response><Say>.*<\/Say><\/Response>$/);
    expect(call?.body).toContain("Table freed");
    expect(call?.body).toContain("A table for 2 opened at Carbone");
    expect(call?.body).not.toContain("https://bookr.example.com");
    expect(call?.format).toBe("text");

    expect(text).toBeDefined();
    expect(text?.body).toContain("Table freed");
    expect(text?.body).toContain("https://bookr.example.com/book/abc123");
    expect(text?.format).toBe("text");
  });

  it("sends a single email-tagged POST for warning severity", async () => {
    const pool = mockAgent.get(APPRISE_URL);
    const bodies: CapturedBody[] = [];
    pool
      .intercept({ path: `/notify/${APPRISE_KEY}`, method: "POST" })
      .reply((req) => {
        bodies.push(JSON.parse(req.body as string) as CapturedBody);
        return { statusCode: 200, data: { success: true } };
      })
      .times(1);

    await notifier().notify("warning", {
      title: "Resy session challenged",
      body: "Hand over a fresh session token.",
    });

    expect(bodies).toHaveLength(1);
    const [sent] = bodies;
    expect(sent).toBeDefined();
    expect(sent?.tag).toBe("email");
    expect(sent?.type).toBe("warning");
    expect(sent?.body).toContain("Resy session challenged");
  });

  it("suppresses info severity entirely (no HTTP request)", async () => {
    // No intercept registered — disableNetConnect() means any unexpected request throws.
    await notifier().notify("info", { title: "Scan complete", body: "Nothing new." });
    expect(mockAgent.pendingInterceptors()).toHaveLength(0);
  });

  it("does not throw when apprise responds with a non-2xx status, and logs loudly", async () => {
    const pool = mockAgent.get(APPRISE_URL);
    pool
      .intercept({ path: `/notify/${APPRISE_KEY}`, method: "POST" })
      .reply(424, { success: false })
      .times(1);
    // Only one interceptor is registered; urgent sends two requests. Register a second failure too.
    pool
      .intercept({ path: `/notify/${APPRISE_KEY}`, method: "POST" })
      .reply(424, { success: false })
      .times(1);

    const logger = vi.fn();
    const target = new AppriseNotifier({ url: APPRISE_URL, key: APPRISE_KEY }, { logger });

    await expect(
      target.notify("urgent", { title: "Table freed", body: "Slot at 7pm" }),
    ).resolves.toMatchObject({ delivered: false });

    expect(logger).toHaveBeenCalledTimes(2);
    expect(logger.mock.calls[0]?.[0]).toContain("424");
  });

  it("does not throw when the fetch call itself rejects (network failure), and logs loudly", async () => {
    const failingFetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const logger = vi.fn();
    const target = new AppriseNotifier(
      { url: APPRISE_URL, key: APPRISE_KEY },
      { fetchImpl: failingFetch as unknown as typeof fetch, logger },
    );

    await expect(
      target.notify("warning", { title: "Auth expired", body: "Needs a refresh." }),
    ).resolves.toMatchObject({ delivered: false });

    expect(failingFetch).toHaveBeenCalledTimes(1);
    expect(logger).toHaveBeenCalledTimes(1);
    expect(logger.mock.calls[0]?.[0]).toContain("request failed");
  });

  it("truncates an overlong sms/email body to the 160-character SMS budget", async () => {
    const pool = mockAgent.get(APPRISE_URL);
    const bodies: CapturedBody[] = [];
    pool
      .intercept({ path: `/notify/${APPRISE_KEY}`, method: "POST" })
      .reply((req) => {
        bodies.push(JSON.parse(req.body as string) as CapturedBody);
        return { statusCode: 200, data: { success: true } };
      })
      .times(2);

    await notifier().notify("urgent", {
      title: "A very long venue name that goes on and on",
      body: "x".repeat(300),
      link: "https://bookr.example.com/book/abc123-very-long-dedupe-key-goes-here",
    });

    const text = bodies.find((b) => b.tag === "sms, email");
    expect(text?.body.length).toBeLessThanOrEqual(160);
  });

  it("truncates an overlong call body to the 4000-character TwiML budget", async () => {
    const pool = mockAgent.get(APPRISE_URL);
    const bodies: CapturedBody[] = [];
    pool
      .intercept({ path: `/notify/${APPRISE_KEY}`, method: "POST" })
      .reply((req) => {
        bodies.push(JSON.parse(req.body as string) as CapturedBody);
        return { statusCode: 200, data: { success: true } };
      })
      .times(2);

    await notifier().notify("urgent", {
      title: "Long alert",
      body: "y".repeat(5000),
    });

    const call = bodies.find((b) => b.tag === "call");
    expect(call?.body.length).toBeLessThanOrEqual(4000);
  });

  it("strips a trailing slash from the configured base URL", async () => {
    const pool = mockAgent.get(APPRISE_URL);
    pool
      .intercept({ path: `/notify/${APPRISE_KEY}`, method: "POST" })
      .reply(200, { success: true })
      .times(1);

    const target = new AppriseNotifier({ url: `${APPRISE_URL}/`, key: APPRISE_KEY });
    await expect(
      target.notify("warning", { title: "t", body: "b" }),
    ).resolves.toMatchObject({ delivered: true });
  });

  it("falls back to console.error when no logger override is supplied", async () => {
    const pool = mockAgent.get(APPRISE_URL);
    pool
      .intercept({ path: `/notify/${APPRISE_KEY}`, method: "POST" })
      .reply(500, "boom")
      .times(1);

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await expect(
        notifier().notify("warning", { title: "t", body: "b" }),
      ).resolves.toMatchObject({ delivered: false });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0]?.[0]).toContain("apprise-notifier");
    } finally {
      spy.mockRestore();
    }
  });

  it("falls back to a placeholder detail when the failing response body cannot be read", async () => {
    const logger = vi.fn();
    const unreadableResponseFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.reject(new Error("stream already consumed")),
    } as unknown as Response);

    const target = new AppriseNotifier(
      { url: APPRISE_URL, key: APPRISE_KEY },
      { logger, fetchImpl: unreadableResponseFetch as unknown as typeof fetch },
    );

    await expect(
      target.notify("warning", { title: "t", body: "b" }),
    ).resolves.toMatchObject({ delivered: false });

    expect(logger).toHaveBeenCalledTimes(1);
    expect(logger.mock.calls[0]?.[1]).toBe("<unreadable response body>");
  });
});
