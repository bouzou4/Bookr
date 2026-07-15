import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.ts";

describe("loadConfig", () => {
  it("applies sensible defaults from an empty env", () => {
    const cfg = loadConfig({});
    expect(cfg.port).toBe(8080);
    expect(cfg.pollIntervalSeconds).toBe(60);
    expect(cfg.credentialsProvider).toBe("env");
    expect(cfg.apprise.key).toBe("bookr");
    expect(cfg.vaultwarden).toBeUndefined();
  });

  it("coerces numeric strings", () => {
    const cfg = loadConfig({ PORT: "9090", POLL_INTERVAL_SECONDS: "45", POLL_JITTER_PCT: "0.3" });
    expect(cfg.port).toBe(9090);
    expect(cfg.pollIntervalSeconds).toBe(45);
    expect(cfg.pollJitterPct).toBe(0.3);
  });

  it("builds the vaultwarden block with a default folder", () => {
    const cfg = loadConfig({
      CREDENTIALS_PROVIDER: "vaultwarden",
      VW_SERVER: "https://vault.example.com",
    });
    expect(cfg.vaultwarden).toEqual({
      server: "https://vault.example.com",
      folder: "Bookr",
      itemPrefix: undefined,
    });
  });

  it("requires VW_SERVER when the vaultwarden provider is selected", () => {
    expect(() => loadConfig({ CREDENTIALS_PROVIDER: "vaultwarden" })).toThrow();
  });

  it("rejects an out-of-range jitter", () => {
    expect(() => loadConfig({ POLL_JITTER_PCT: "2" })).toThrow();
  });
});
