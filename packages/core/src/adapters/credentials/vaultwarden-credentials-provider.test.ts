import { describe, expect, it, vi } from "vitest";
import type { CommandResult, CommandRunner } from "./command-runner.ts";
import { VaultwardenCredentialsProvider } from "./vaultwarden-credentials-provider.ts";

/** A single scripted vault item, matching the shape `bw list items` returns. */
interface ScriptedItem {
  name: string;
  login?: { username?: string | null; password?: string | null };
  fields?: { name?: string | null; value?: string | null }[];
  notes?: string | null;
}

interface FakeRunnerCall {
  args: string[];
  env?: Record<string, string | undefined>;
}

/**
 * Builds a fake `bw` command runner that scripts a successful login → unlock → sync → list
 * flow using canned JSON, so tests never spawn a real process.
 */
function makeFakeRunner(options: {
  folderName?: string;
  items?: ScriptedItem[];
  unlockStdout?: string;
  overrides?: Partial<Record<string, (args: string[], env?: Record<string, string | undefined>) => CommandResult>>;
}): { runner: CommandRunner; calls: FakeRunnerCall[] } {
  const folderName = options.folderName ?? "Bookr";
  const items = options.items ?? [];
  const calls: FakeRunnerCall[] = [];

  const handlers: Record<string, (args: string[], env?: Record<string, string | undefined>) => CommandResult> = {
    config: () => ({ stdout: "", stderr: "", code: 0 }),
    login: () => ({ stdout: "", stderr: "", code: 0 }),
    unlock: () => ({ stdout: options.unlockStdout ?? "session-token-abc\n", stderr: "", code: 0 }),
    sync: () => ({ stdout: "", stderr: "", code: 0 }),
    list: (args) => {
      if (args[1] === "folders") {
        return { stdout: JSON.stringify([{ id: "folder-1", name: folderName }]), stderr: "", code: 0 };
      }
      return { stdout: JSON.stringify(items), stderr: "", code: 0 };
    },
    ...options.overrides,
  };

  const runner: CommandRunner = async (args, env) => {
    calls.push({ args, env });
    const handler = handlers[args[0] ?? ""];
    if (handler === undefined) {
      throw new Error(`unscripted bw subcommand: ${args[0]}`);
    }
    return handler(args, env);
  };

  return { runner, calls };
}

const defaultItems: ScriptedItem[] = [
  {
    name: "resy",
    login: { username: "adam@example.com", password: "pw-resy" },
    fields: [{ name: "API Key", value: "resy-api-key" }],
  },
  { name: "apprise_key", fields: [{ name: "value", value: "apprise-secret" }] },
  { name: "ingest_token", login: { password: "ingest-secret" } },
  { name: "ui_password", notes: "  notes-secret  " },
];

function makeProvider(overrides: Partial<Parameters<typeof makeFakeRunner>[0]> = {}) {
  const { runner, calls } = makeFakeRunner({ items: defaultItems, ...overrides });
  const provider = new VaultwardenCredentialsProvider({
    server: "https://vault.example.internal",
    folder: "Bookr",
    clientId: "client-id",
    clientSecret: "client-secret-value",
    password: "master-password-value",
    runner,
  });
  return { provider, calls };
}

describe("VaultwardenCredentialsProvider", () => {
  it("maps a vault item's login and API-key field to provider credentials", async () => {
    const { provider } = makeProvider();
    await expect(provider.getProviderCredentials("resy")).resolves.toEqual({
      username: "adam@example.com",
      password: "pw-resy",
      apiKey: "resy-api-key",
    });
  });

  it("returns an empty object when no vault item matches the provider", async () => {
    const { provider } = makeProvider();
    await expect(provider.getProviderCredentials("sohohouse")).resolves.toEqual({});
  });

  it("reads a secret from a custom 'value' field first", async () => {
    const { provider } = makeProvider();
    await expect(provider.getSecret("apprise_key")).resolves.toBe("apprise-secret");
  });

  it("falls back to login.password for a secret with no value field", async () => {
    const { provider } = makeProvider();
    await expect(provider.getSecret("ingest_token")).resolves.toBe("ingest-secret");
  });

  it("falls back to trimmed notes as a last resort for a secret value", async () => {
    const { provider } = makeProvider();
    await expect(provider.getSecret("ui_password")).resolves.toBe("notes-secret");
  });

  it("returns undefined for a secret with no matching vault item", async () => {
    const { provider } = makeProvider();
    await expect(provider.getSecret("session_secret")).resolves.toBeUndefined();
  });

  it("runs the login/unlock/sync/list sequence with the documented arguments and env", async () => {
    const { provider, calls } = makeProvider();
    await provider.init();

    expect(calls[0]).toMatchObject({ args: ["config", "server", "https://vault.example.internal"] });
    expect(calls[1]).toMatchObject({
      args: ["login", "--apikey"],
      env: { BW_CLIENTID: "client-id", BW_CLIENTSECRET: "client-secret-value" },
    });
    expect(calls[2]).toMatchObject({
      args: ["unlock", "--passwordenv", "BW_PASSWORD", "--raw"],
      env: { BW_PASSWORD: "master-password-value" },
    });
    expect(calls[3]).toMatchObject({ args: ["sync"], env: { BW_SESSION: "session-token-abc" } });
    expect(calls[4]).toMatchObject({ args: ["list", "folders"], env: { BW_SESSION: "session-token-abc" } });
    expect(calls[5]).toMatchObject({
      args: ["list", "items", "--folderid", "folder-1"],
      env: { BW_SESSION: "session-token-abc" },
    });
  });

  it("caches vault contents after the first fetch (init only runs the flow once)", async () => {
    const { provider, calls } = makeProvider();

    await provider.getProviderCredentials("resy");
    await provider.getSecret("apprise_key");
    await provider.getProviderCredentials("resy");

    expect(calls.filter((c) => c.args[0] === "sync")).toHaveLength(1);
    expect(calls.filter((c) => c.args[0] === "login")).toHaveLength(1);
  });

  it("applies an item-name prefix when configured", async () => {
    const { runner } = makeFakeRunner({
      items: [{ name: "bookr-resy", login: { username: "prefixed", password: "pw" } }],
    });
    const provider = new VaultwardenCredentialsProvider({
      server: "https://vault.example.internal",
      folder: "Bookr",
      itemPrefix: "bookr-",
      clientId: "id",
      clientSecret: "secret",
      password: "password",
      runner,
    });

    await expect(provider.getProviderCredentials("resy")).resolves.toEqual({
      username: "prefixed",
      password: "pw",
    });
  });

  it("throws a descriptive error when the configured folder is not found", async () => {
    const { provider } = makeProvider({ folderName: "SomeOtherFolder" });
    await expect(provider.init()).rejects.toThrow(/folder "Bookr" was not found/);
  });

  it("throws a redacted error when a bw subcommand exits non-zero, never leaking the secret", async () => {
    const { runner } = makeFakeRunner({
      items: defaultItems,
      overrides: {
        unlock: () => ({
          stdout: "",
          stderr: "invalid master password: master-password-value",
          code: 1,
        }),
      },
    });
    const provider = new VaultwardenCredentialsProvider({
      server: "https://vault.example.internal",
      folder: "Bookr",
      clientId: "id",
      clientSecret: "secret",
      password: "master-password-value",
      runner,
    });

    await expect(provider.init()).rejects.toThrow(/exit code 1/);
    try {
      await provider.getSecret("session_secret");
      throw new Error("expected rejection");
    } catch (err) {
      expect(String(err)).not.toContain("master-password-value");
      expect(String(err)).toContain("[redacted]");
    }
  });

  it("throws without leaking vault contents when a list command returns non-JSON output", async () => {
    const { runner } = makeFakeRunner({
      overrides: {
        list: (args) => (args[1] === "folders" ? { stdout: "not json", stderr: "", code: 0 } : { stdout: "[]", stderr: "", code: 0 }),
      },
    });
    const provider = new VaultwardenCredentialsProvider({
      server: "https://vault.example.internal",
      folder: "Bookr",
      clientId: "id",
      clientSecret: "secret",
      password: "password",
      runner,
    });

    await expect(provider.init()).rejects.toThrow(/unparsable folder list output/);
  });

  it("never logs secret material to the console", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { provider } = makeProvider();
    await provider.getProviderCredentials("resy");
    await provider.getSecret("apprise_key");
    await provider.getSecret("ingest_token");
    await provider.getSecret("ui_password");

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();

    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
