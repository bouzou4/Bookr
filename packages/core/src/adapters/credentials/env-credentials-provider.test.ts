import { describe, expect, it } from "vitest";
import { EnvCredentialsProvider, SECRET_ENV_VARS } from "./env-credentials-provider.ts";

describe("EnvCredentialsProvider", () => {
  it("init resolves without touching the environment", async () => {
    const provider = new EnvCredentialsProvider({});
    await expect(provider.init()).resolves.toBeUndefined();
  });

  it("reads username, password, and api key for a provider from CRED_<PROVIDER>_* vars", async () => {
    const provider = new EnvCredentialsProvider({
      CRED_RESY_USERNAME: "adam@example.com",
      CRED_RESY_PASSWORD: "hunter2",
      CRED_RESY_API_KEY: "abc123",
    });

    await expect(provider.getProviderCredentials("resy")).resolves.toEqual({
      username: "adam@example.com",
      password: "hunter2",
      apiKey: "abc123",
    });
  });

  it("omits fields that are unset in the environment", async () => {
    const provider = new EnvCredentialsProvider({ CRED_SOHOHOUSE_USERNAME: "member" });

    await expect(provider.getProviderCredentials("sohohouse")).resolves.toEqual({
      username: "member",
    });
  });

  it("returns an empty object for a provider with no configured credentials", async () => {
    const provider = new EnvCredentialsProvider({});
    await expect(provider.getProviderCredentials("opentable")).resolves.toEqual({});
  });

  it("uppercases the provider name when building the env var key", async () => {
    const provider = new EnvCredentialsProvider({ CRED_OPENTABLE_API_KEY: "ot-key" });
    await expect(provider.getProviderCredentials("opentable")).resolves.toEqual({ apiKey: "ot-key" });
  });

  it.each(Object.entries(SECRET_ENV_VARS))("reads the %s secret from its mapped env var", async (name, envVar) => {
    const provider = new EnvCredentialsProvider({ [envVar]: `value-for-${name}` });
    await expect(provider.getSecret(name as keyof typeof SECRET_ENV_VARS)).resolves.toBe(`value-for-${name}`);
  });

  it("returns undefined for a secret that is not set", async () => {
    const provider = new EnvCredentialsProvider({});
    await expect(provider.getSecret("session_secret")).resolves.toBeUndefined();
  });
});
