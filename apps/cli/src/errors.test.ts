import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createExitState } from "./exit-state.ts";
import { EXIT_CODES } from "./exit-codes.ts";
import { CliNotFoundError, CliValidationError, reportCommandError } from "./errors.ts";
import { captureIo } from "./test-support.ts";

describe("reportCommandError", () => {
  it("maps a ZodError to invalidInput and flattens issues", () => {
    const io = captureIo();
    const exitState = createExitState();
    const result = z.object({ n: z.number() }).safeParse({ n: "nope" });
    if (result.success) throw new Error("expected parse failure");
    reportCommandError(io, exitState, result.error);
    expect(exitState.code).toBe(EXIT_CODES.invalidInput);
    expect(io.err()).toContain("n:");
  });

  it("maps CliValidationError to invalidInput", () => {
    const io = captureIo();
    const exitState = createExitState();
    reportCommandError(io, exitState, new CliValidationError("bad flag"));
    expect(exitState.code).toBe(EXIT_CODES.invalidInput);
    expect(io.err()).toBe("error: bad flag\n");
  });

  it("maps CliNotFoundError to notFound", () => {
    const io = captureIo();
    const exitState = createExitState();
    reportCommandError(io, exitState, new CliNotFoundError("watch not found: x"));
    expect(exitState.code).toBe(EXIT_CODES.notFound);
  });

  it("maps a generic Error to the error code", () => {
    const io = captureIo();
    const exitState = createExitState();
    reportCommandError(io, exitState, new Error("boom"));
    expect(exitState.code).toBe(EXIT_CODES.error);
    expect(io.err()).toBe("error: boom\n");
  });

  it("stringifies a non-Error throw", () => {
    const io = captureIo();
    const exitState = createExitState();
    reportCommandError(io, exitState, "raw string failure");
    expect(exitState.code).toBe(EXIT_CODES.error);
    expect(io.err()).toBe("error: raw string failure\n");
  });
});
