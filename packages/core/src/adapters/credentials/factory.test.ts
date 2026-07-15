import type { Config } from "@bookr/shared";
import { describe, expect, it } from "vitest";
import { EnvCredentialsProvider } from "./env-credentials-provider.ts";
import { createCredentialsProvider } from "./factory.ts";
import { VaultwardenCredentialsProvider } from "./vaultwarden-credentials-provider.ts";

function baseConfig(overrides: Partial<Config> = {}): Config {
  return {
    port: 8080,
    publicBaseUrl: "http://localhost:8080",
    pollIntervalSeconds: 60,
    pollJitterPct: 0.25,
    credentialsProvider: "env",
    apprise: { url: "http://localhost:8000", key: "bookr" },
    ingestToken: "",
    uiPassword: "",
    sessionSecret: "",
    dataDir: "./data",
    vaultwarden: undefined,
    ...overrides,
  };
}

describe("createCredentialsProvider", () => {
  it("builds an EnvCredentialsProvider when credentialsProvider is 'env'", () => {
    const provider = createCredentialsProvider({ config: baseConfig(), env: {} });
    expect(provider).toBeInstanceOf(EnvCredentialsProvider);
  });

  it("builds a VaultwardenCredentialsProvider with an injected runner when configured", () => {
    const config = baseConfig({
      credentialsProvider: "vaultwarden",
      vaultwarden: { server: "https://vault.example.internal", folder: "Bookr", itemPrefix: undefined },
    });
    const env = { BW_CLIENTID: "id", BW_CLIENTSECRET: "secret", BW_PASSWORD: "password" };
    const runner = async () => ({ stdout: "", stderr: "", code: 0 });

    const provider = createCredentialsProvider({ config, env, runner });
    expect(provider).toBeInstanceOf(VaultwardenCredentialsProvider);
  });

  it("throws when vaultwarden is selected without server configuration", () => {
    const config = baseConfig({ credentialsProvider: "vaultwarden", vaultwarden: undefined });
    expect(() => createCredentialsProvider({ config, env: {} })).toThrow(/VW_SERVER/);
  });

  it("throws when vaultwarden is selected without the Bitwarden API-key triple", () => {
    const config = baseConfig({
      credentialsProvider: "vaultwarden",
      vaultwarden: { server: "https://vault.example.internal", folder: "Bookr", itemPrefix: undefined },
    });
    expect(() => createCredentialsProvider({ config, env: {} })).toThrow(/BW_CLIENTID/);
  });

  it("defaults to a real command runner when none is injected", () => {
    const config = baseConfig({
      credentialsProvider: "vaultwarden",
      vaultwarden: { server: "https://vault.example.internal", folder: "Bookr", itemPrefix: undefined },
    });
    const env = { BW_CLIENTID: "id", BW_CLIENTSECRET: "secret", BW_PASSWORD: "password" };

    // No runner injected: the factory falls back to createNodeCommandRunner(). This only
    // constructs the provider (nothing is invoked), so no process is spawned by this test.
    const provider = createCredentialsProvider({ config, env });
    expect(provider).toBeInstanceOf(VaultwardenCredentialsProvider);
  });
});
