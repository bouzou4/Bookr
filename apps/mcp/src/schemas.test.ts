import { describe, expect, it } from "vitest";
import {
  activityQueryInputSchema,
  bookSlotInputSchema,
  removeWatchInputSchema,
  updateWatchInputSchema,
} from "./schemas.ts";

describe("updateWatchInputSchema", () => {
  it("accepts an id with a partial patch", () => {
    const parsed = updateWatchInputSchema.parse({ id: "w1", patch: { label: "new label" } });
    expect(parsed).toEqual({ id: "w1", patch: { label: "new label" } });
  });

  it("rejects an empty id", () => {
    expect(() => updateWatchInputSchema.parse({ id: "", patch: {} })).toThrow();
  });
});

describe("removeWatchInputSchema", () => {
  it("requires a non-empty id", () => {
    expect(() => removeWatchInputSchema.parse({})).toThrow();
    expect(removeWatchInputSchema.parse({ id: "w1" })).toEqual({ id: "w1" });
  });
});

describe("activityQueryInputSchema", () => {
  it("allows an empty query", () => {
    expect(activityQueryInputSchema.parse({})).toEqual({});
  });

  it("validates the type enum", () => {
    expect(() => activityQueryInputSchema.parse({ type: "not-a-type" })).toThrow();
    expect(activityQueryInputSchema.parse({ type: "booked", limit: 5 })).toEqual({
      type: "booked",
      limit: 5,
    });
  });
});

describe("bookSlotInputSchema", () => {
  it("requires confirm to be present and boolean", () => {
    expect(() =>
      bookSlotInputSchema.parse({ watchId: "w1", dedupeKey: "k1" }),
    ).toThrow();
    expect(bookSlotInputSchema.parse({ watchId: "w1", dedupeKey: "k1", confirm: false })).toEqual({
      watchId: "w1",
      dedupeKey: "k1",
      confirm: false,
    });
  });
});
