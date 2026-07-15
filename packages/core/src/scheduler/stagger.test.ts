import { describe, expect, it } from "vitest";
import { distinctVenueKeys, planStagger } from "./stagger.ts";

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
});

describe("planStagger", () => {
  it("spreads distinct venues evenly across the interval", () => {
    const offsets = planStagger(
      [
        { provider: "resy", venueId: "1" },
        { provider: "resy", venueId: "2" },
        { provider: "resy", venueId: "3" },
      ],
      60_000,
    );
    expect(offsets.get("resy:1")).toBe(0);
    expect(offsets.get("resy:2")).toBe(20_000);
    expect(offsets.get("resy:3")).toBe(40_000);
  });

  it("collapses same-venue watches to one offset", () => {
    const offsets = planStagger(
      [
        { provider: "resy", venueId: "1" },
        { provider: "resy", venueId: "1" },
      ],
      60_000,
    );
    expect(offsets.size).toBe(1);
    expect(offsets.get("resy:1")).toBe(0);
  });

  it("returns an empty plan for no venues", () => {
    expect(planStagger([], 60_000).size).toBe(0);
  });
});
