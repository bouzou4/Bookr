import { describe, expect, it } from "vitest";
import { distinctVenueKeys } from "./stagger.ts";

describe("distinctVenueKeys", () => {
  it("collapses duplicates and preserves first-seen order", () => {
    const keys = distinctVenueKeys([
      { provider: "resy", venueId: "1" },
      { provider: "resy", venueId: "2" },
      { provider: "resy", venueId: "1" },
      { provider: "sohohouse", venueId: "1" },
    ]);
    expect(keys).toEqual(["resy:1", "resy:2", "sohohouse:1"]);
  });

  it("returns an empty list for no venues", () => {
    expect(distinctVenueKeys([])).toEqual([]);
  });
});
