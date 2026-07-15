import { afterEach, describe, expect, it, vi } from "vitest";

const execFileMock =
  vi.fn<
    (
      command: string,
      args: readonly string[],
      options: { env?: NodeJS.ProcessEnv },
      callback: (error: (Error & { code?: unknown }) | null, stdout: string, stderr: string) => void,
    ) => void
  >();

vi.mock("node:child_process", () => ({
  execFile: (
    command: string,
    args: readonly string[],
    options: { env?: NodeJS.ProcessEnv },
    callback: (error: (Error & { code?: unknown }) | null, stdout: string, stderr: string) => void,
  ) => execFileMock(command, args, options, callback),
}));

// Imported after the mock so the module under test picks up the mocked child_process. No real
// process is ever spawned by this suite.
const { createNodeCommandRunner } = await import("./command-runner.ts");

describe("createNodeCommandRunner", () => {
  afterEach(() => {
    execFileMock.mockReset();
  });

  it("resolves with stdout, stderr, and code 0 on success", async () => {
    execFileMock.mockImplementation((_command, _args, _options, callback) => {
      callback(null, "vault items", "");
    });

    const runner = createNodeCommandRunner("bw");
    const result = await runner(["list", "items"]);

    expect(result).toEqual({ stdout: "vault items", stderr: "", code: 0 });
    expect(execFileMock).toHaveBeenCalledWith("bw", ["list", "items"], expect.anything(), expect.any(Function));
  });

  it("merges the injected env on top of process.env when provided", async () => {
    execFileMock.mockImplementation((_command, _args, _options, callback) => callback(null, "", ""));

    const runner = createNodeCommandRunner("bw");
    await runner(["config", "server", "https://vault.example"], { BW_CLIENTID: "id-123" });

    const passedOptions = execFileMock.mock.calls[0]?.[2];
    expect(passedOptions?.env?.BW_CLIENTID).toBe("id-123");
  });

  it("passes process.env unchanged when no env override is given", async () => {
    execFileMock.mockImplementation((_command, _args, _options, callback) => callback(null, "", ""));

    const runner = createNodeCommandRunner("bw");
    await runner(["sync"]);

    const passedOptions = execFileMock.mock.calls[0]?.[2];
    expect(passedOptions?.env).toBe(process.env);
  });

  it("resolves with the numeric exit code from a failed process", async () => {
    execFileMock.mockImplementation((_command, _args, _options, callback) => {
      const error = Object.assign(new Error("exit 2"), { code: 2 });
      callback(error, "", "some failure");
    });

    const runner = createNodeCommandRunner("bw");
    const result = await runner(["unlock"]);

    expect(result).toEqual({ stdout: "", stderr: "some failure", code: 2 });
  });

  it("falls back to code 1 when the spawn error has no numeric code", async () => {
    execFileMock.mockImplementation((_command, _args, _options, callback) => {
      const error = Object.assign(new Error("spawn bw ENOENT"), { code: "ENOENT" });
      callback(error, "", "");
    });

    const runner = createNodeCommandRunner("bw");
    const result = await runner(["login"]);

    expect(result.code).toBe(1);
  });

  it("defaults the command to bw when none is given", async () => {
    execFileMock.mockImplementation((_command, _args, _options, callback) => callback(null, "", ""));

    const runner = createNodeCommandRunner();
    await runner(["--version"]);

    expect(execFileMock).toHaveBeenCalledWith("bw", ["--version"], expect.anything(), expect.any(Function));
  });
});
