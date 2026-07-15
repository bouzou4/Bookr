import { describe, expect, it } from "vitest";
import { processIo } from "./io.ts";

describe("processIo", () => {
  it("wraps the real process streams", () => {
    const io = processIo();
    expect(io.stdout).toBe(process.stdout);
    expect(io.stderr).toBe(process.stderr);
  });
});
