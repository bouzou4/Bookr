import { describe, expect, it } from "vitest";
import { createExitState } from "./exit-state.ts";

describe("createExitState", () => {
  it("starts at success", () => {
    expect(createExitState()).toEqual({ code: 0 });
  });
});
