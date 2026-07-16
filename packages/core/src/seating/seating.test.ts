import { describe, expect, it } from "vitest";
import type { Seat, SeatMap, SeatStatus } from "@bookr/shared";
import { passesSeatingGate, resolveAcceptableSeats } from "./gate.ts";
import { layoutSignature } from "./signature.ts";
import { depthOf, summarizeSeatMap, zoneOf } from "./summary.ts";

/** Build a seat with AMC-style right-to-left naming: column 1 in row A of a 14-wide room is "A14". */
function seat(row: string, column: number, columns: number, status: SeatStatus = "available", type?: string): Seat {
  return { id: `${row}${String(columns - column + 1)}`, row, column, status, type };
}

/**
 * A miniature auditorium, 3 rows × 6 columns, aisle void at column 4 of row B:
 *
 * ```
 *        SCREEN
 * A: 1 2 3 4 5 6     (all available)
 * B: 1 2 3 _ 5 6     (void at col 4; B taken except cols 5,6)
 * C: 1 2 3 4 5 6     (all taken)
 * ```
 */
function miniMap(): SeatMap {
  const cols = 6;
  return {
    rows: ["A", "B", "C"],
    columns: cols,
    seats: [
      ...[1, 2, 3, 4, 5, 6].map((c) => seat("A", c, cols)),
      ...[1, 2, 3].map((c) => seat("B", c, cols, "taken")),
      ...[5, 6].map((c) => seat("B", c, cols)),
      ...[1, 2, 3, 4, 5, 6].map((c) => seat("C", c, cols, "taken")),
    ],
  };
}

describe("summarizeSeatMap", () => {
  it("reports occupancy over sellable seats and finds blocks best-first", () => {
    const summary = summarizeSeatMap(miniMap());
    expect(summary.totalSeats).toBe(17);
    expect(summary.availableSeats).toBe(8);
    expect(summary.percentTaken).toBe(53);
    // Row A is one 6-wide run; row B contributes a 2-wide run right of the aisle.
    expect(summary.blocks.map((b) => ({ row: b.row, size: b.size }))).toEqual([
      { row: "A", size: 6 },
      { row: "B", size: 2 },
    ]);
  });

  it("breaks runs on missing column indices (aisles/voids)", () => {
    const cols = 5;
    const map: SeatMap = {
      rows: ["A"],
      columns: cols,
      seats: [seat("A", 1, cols), seat("A", 2, cols), seat("A", 4, cols), seat("A", 5, cols)],
    };
    const summary = summarizeSeatMap(map);
    expect(summary.blocks.map((b) => b.size)).toEqual([2, 2]);
  });

  it("keeps seat ids in physical (column) order even when names run right-to-left", () => {
    const summary = summarizeSeatMap(miniMap());
    const rowA = summary.blocks[0];
    expect(rowA?.seatIds).toEqual(["A6", "A5", "A4", "A3", "A2", "A1"]);
  });

  it("masks block-finding to acceptable seats while occupancy stays whole-room", () => {
    // Acceptable ids A5/A4/A3 are physically columns 2-4 (names run right-to-left).
    const summary = summarizeSeatMap(miniMap(), new Set(["A3", "A4", "A5"]));
    expect(summary.blocks).toHaveLength(1);
    expect(summary.blocks[0]?.seatIds).toEqual(["A5", "A4", "A3"]);
    expect(summary.availableSeats).toBe(8);
    expect(summary.percentTaken).toBe(53);
  });

  it("prefers center blocks over larger side blocks", () => {
    const cols = 9;
    const map: SeatMap = {
      rows: ["A"],
      columns: cols,
      // Left block of 3 (cols 1-3), center block of 2 (cols 5-6).
      seats: [1, 2, 3, 5, 6].map((c) => seat("A", c, cols)),
    };
    const [best] = summarizeSeatMap(map).blocks;
    expect(best?.position).toBe("center");
    expect(best?.size).toBe(2);
  });

  it("handles empty and sold-out maps", () => {
    expect(summarizeSeatMap({ rows: [], columns: 0, seats: [] })).toEqual({
      totalSeats: 0,
      availableSeats: 0,
      percentTaken: 0,
      blocks: [],
    });
    const soldOut: SeatMap = { rows: ["A"], columns: 2, seats: [seat("A", 1, 2, "taken"), seat("A", 2, 2, "taken")] };
    const summary = summarizeSeatMap(soldOut);
    expect(summary.percentTaken).toBe(100);
    expect(summary.blocks).toEqual([]);
  });

  it("excludes unavailable (non-sellable) seats from occupancy", () => {
    const map: SeatMap = {
      rows: ["A"],
      columns: 3,
      seats: [seat("A", 1, 3), seat("A", 2, 3, "unavailable", "Companion"), seat("A", 3, 3, "taken")],
    };
    const summary = summarizeSeatMap(map);
    expect(summary.totalSeats).toBe(2);
    expect(summary.availableSeats).toBe(1);
  });
});

describe("zoneOf / depthOf", () => {
  it("classifies thirds", () => {
    expect(zoneOf(1, 12)).toBe("left");
    expect(zoneOf(6, 12)).toBe("center");
    expect(zoneOf(11, 12)).toBe("right");
    expect(depthOf(0, 9)).toBe("front");
    expect(depthOf(4, 9)).toBe("middle");
    expect(depthOf(8, 9)).toBe("back");
  });
});

describe("resolveAcceptableSeats", () => {
  const map = miniMap();

  it("explicit picker seats win over everything", () => {
    const set = resolveAcceptableSeats({ seats: ["A1"], zones: ["left"] }, map, ["B5"]);
    expect(set).toEqual(new Set(["A1"]));
  });

  it("cached per-theater set wins over zones/depths", () => {
    const set = resolveAcceptableSeats({ zones: ["left"] }, map, ["A2", "A3"]);
    expect(set).toEqual(new Set(["A2", "A3"]));
  });

  it("falls back to zone/depth filtering by seat position", () => {
    const set = resolveAcceptableSeats({ zones: ["center"], depths: ["front"] }, map);
    // Center third of 6 columns = columns 3-4; front third of 3 rows = row A.
    expect(set).toEqual(new Set(["A4", "A3"]));
  });

  it("returns undefined (unrestricted) with no preferences", () => {
    expect(resolveAcceptableSeats(undefined, map)).toBeUndefined();
    expect(resolveAcceptableSeats({}, map, [])).toBeUndefined();
  });
});

describe("passesSeatingGate", () => {
  it("requires one contiguous block to seat the whole party", () => {
    const summary = summarizeSeatMap(miniMap(), new Set(["A1", "A2", "B5", "B6"]));
    expect(passesSeatingGate(summary, 2)).toBe(true);
    expect(passesSeatingGate(summary, 3)).toBe(false);
  });
});

describe("layoutSignature", () => {
  it("is invariant under availability changes but not geometry changes", () => {
    const before = miniMap();
    const after: SeatMap = {
      ...before,
      seats: before.seats.map((s) => ({ ...s, status: "taken" as const })),
    };
    expect(layoutSignature(after)).toBe(layoutSignature(before));

    const renovated: SeatMap = { ...before, seats: before.seats.slice(1) };
    expect(layoutSignature(renovated)).not.toBe(layoutSignature(before));
  });

  it("ignores seat ordering in the input", () => {
    const map = miniMap();
    const shuffled: SeatMap = { ...map, seats: [...map.seats].reverse() };
    expect(layoutSignature(shuffled)).toBe(layoutSignature(map));
  });
});
