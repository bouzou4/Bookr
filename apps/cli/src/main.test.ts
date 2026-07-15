import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeBookr } from "@bookr/testkit";

vi.mock("./bootstrap.ts", () => ({
  bootstrap: vi.fn(() => createFakeBookr()),
}));

describe("main", () => {
  const originalArgv = process.argv;
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("runs the CLI against process.argv and sets process.exitCode", async () => {
    process.argv = ["node", "main.js", "watch", "list"];
    const { main } = await import("./main.ts");
    await main();
    expect(process.exitCode).toBe(0);
    expect(process.stdout.write).toHaveBeenCalled();
  });

  it("sets a non-zero exit code for a failing command", async () => {
    process.argv = ["node", "main.js", "book", "w1", "key"];
    const { main } = await import("./main.ts");
    await main();
    expect(process.exitCode).toBe(2);
  });
});
