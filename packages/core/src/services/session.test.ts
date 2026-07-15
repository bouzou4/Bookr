import { describe, expect, it } from "vitest";
import { loadConfig } from "@bookr/shared";
import type { ProviderName, Session } from "@bookr/shared";
import { FakeClock, FakeCredentialsProvider, FakeNotifier, FakeProvider, FakeRepository } from "@bookr/testkit";
import type { BookingProvider } from "../ports/booking-provider.ts";
import { ProviderError } from "../errors.ts";
import type { ServiceContext } from "./context.ts";
import { classify, ensureLiveSession, getProvider } from "./session.ts";

function makeCtx(provider: BookingProvider): { ctx: ServiceContext; repo: FakeRepository; notifier: FakeNotifier } {
  const clock = new FakeClock(new Date("2026-07-13T16:00:00Z"));
  const repo = new FakeRepository(clock);
  const notifier = new FakeNotifier();
  const ctx: ServiceContext = {
    repository: repo,
    notifier,
    credentialsProvider: new FakeCredentialsProvider(),
    providers: new Map<ProviderName, BookingProvider>([["resy", provider]]),
    clock,
    config: loadConfig({}),
    runtime: {},
  };
  return { ctx, repo, notifier };
}

describe("getProvider", () => {
  it("throws when no provider is registered", () => {
    const { ctx } = makeCtx(new FakeProvider());
    expect(() => getProvider(ctx, "opentable")).toThrow(ProviderError);
  });
});

describe("classify", () => {
  it("prefers the class on a ProviderError", () => {
    expect(classify(new FakeProvider(), new ProviderError("rate-limited", "x"))).toBe("rate-limited");
  });
  it("falls back to the provider classifier", () => {
    expect(classify(new FakeProvider(), new Error("x"))).toBe("other");
  });
});

describe("ensureLiveSession", () => {
  it("authenticates when no session is stored", async () => {
    const provider = new FakeProvider();
    const { ctx, repo } = makeCtx(provider);
    const session = await ensureLiveSession(ctx, provider);
    expect(session.state).toBe("active");
    expect(provider.calls.authenticate).toBe(1);
    expect(repo.sessions.get("resy")?.state).toBe("active");
  });

  it("refreshes a session near expiry", async () => {
    const provider = new FakeProvider();
    const { ctx, repo } = makeCtx(provider);
    repo.sessions.put({
      provider: "resy",
      state: "active",
      data: {},
      expiresAt: new Date("2026-07-13T16:01:00Z").toISOString(), // within the 5-min lead
      updatedAt: "",
    });
    await ensureLiveSession(ctx, provider);
    expect(provider.calls.refresh).toBe(1);
    expect(provider.calls.authenticate).toBe(0);
  });

  it("refreshes an expired session", async () => {
    const provider = new FakeProvider();
    const { ctx, repo } = makeCtx(provider);
    repo.sessions.put({ provider: "resy", state: "expired", data: {}, updatedAt: "" });
    await ensureLiveSession(ctx, provider);
    expect(provider.calls.refresh).toBe(1);
  });

  it("re-authenticates when refresh reports the token is dead", async () => {
    const provider = new FakeProvider();
    provider.refresh = async (): Promise<Session> => {
      throw new ProviderError("auth-expired", "dead");
    };
    const { ctx, repo } = makeCtx(provider);
    repo.sessions.put({ provider: "resy", state: "expired", data: {}, updatedAt: "" });
    await ensureLiveSession(ctx, provider);
    expect(provider.calls.authenticate).toBe(1);
  });

  it("rethrows a non-auth refresh failure", async () => {
    const provider = new FakeProvider();
    provider.refresh = async (): Promise<Session> => {
      throw new ProviderError("rate-limited", "slow");
    };
    const { ctx, repo } = makeCtx(provider);
    repo.sessions.put({ provider: "resy", state: "expired", data: {}, updatedAt: "" });
    await expect(ensureLiveSession(ctx, provider)).rejects.toThrow(/slow/);
  });

  it("throws without hammering when the stored session is already challenged", async () => {
    const provider = new FakeProvider();
    const { ctx, repo } = makeCtx(provider);
    repo.sessions.put({ provider: "resy", state: "challenged", data: {}, updatedAt: "" });
    await expect(ensureLiveSession(ctx, provider)).rejects.toMatchObject({ errorClass: "challenged" });
    expect(provider.calls.authenticate).toBe(0);
  });

  it("raises a warning and records when authentication returns a challenge", async () => {
    const provider = new FakeProvider();
    provider.authenticate = async (): Promise<Session> => ({
      provider: "resy",
      state: "challenged",
      data: {},
      updatedAt: "",
    });
    const { ctx, repo, notifier } = makeCtx(provider);
    await expect(ensureLiveSession(ctx, provider)).rejects.toMatchObject({ errorClass: "challenged" });
    expect(notifier.bySeverity("warning")).toHaveLength(1);
    expect(repo.sessions.get("resy")?.state).toBe("challenged");
    expect(repo.activity.recent({ type: "auth-challenged" })).toHaveLength(1);
  });

  it("pauses the provider when an auth step throws a challenge (not just returns one)", async () => {
    const provider = new FakeProvider();
    let authCalls = 0;
    provider.authenticate = async (): Promise<Session> => {
      authCalls += 1;
      throw new ProviderError("challenged", "captcha");
    };
    const { ctx, repo, notifier } = makeCtx(provider);
    await expect(ensureLiveSession(ctx, provider)).rejects.toMatchObject({ errorClass: "challenged" });
    // The thrown challenge must persist the paused state so the next pass short-circuits.
    expect(repo.sessions.get("resy")?.state).toBe("challenged");
    expect(notifier.bySeverity("warning")).toHaveLength(1);
    // A second call does not touch the provider again — no login storm / ban path.
    await expect(ensureLiveSession(ctx, provider)).rejects.toMatchObject({ errorClass: "challenged" });
    expect(authCalls).toBe(1);
  });

  it("treats a missing session as a standing challenge when the provider cannot auth headlessly", async () => {
    const provider = new FakeProvider({ capabilities: { headlessAuth: false } });
    const { ctx, repo, notifier } = makeCtx(provider);
    await expect(ensureLiveSession(ctx, provider)).rejects.toMatchObject({ errorClass: "challenged" });
    // It never attempts a headless login it cannot complete; it asks the operator to hand one over.
    expect(provider.calls.authenticate).toBe(0);
    expect(repo.sessions.get("resy")?.state).toBe("challenged");
    expect(notifier.bySeverity("warning")).toHaveLength(1);
  });
});
