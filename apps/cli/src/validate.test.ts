import { describe, expect, it } from "vitest";
import { parseWindow } from "./validate.ts";
import { CliValidationError } from "./errors.ts";

describe("parseWindow", () => {
  it("splits a valid HH:MM-HH:MM window", () => {
    expect(parseWindow("18:00-21:00")).toEqual({ start: "18:00", end: "21:00" });
  });

  it("throws CliValidationError with no separator", () => {
    expect(() => parseWindow("18002100")).toThrow(CliValidationError);
  });

  it("throws CliValidationError with nothing before the separator", () => {
    expect(() => parseWindow("-21:00")).toThrow(CliValidationError);
  });

  it("throws CliValidationError with nothing after the separator", () => {
    expect(() => parseWindow("18:00-")).toThrow(CliValidationError);
  });
});
