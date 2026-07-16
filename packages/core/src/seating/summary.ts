/**
 * Seat-map analysis: turning a provider's full {@link SeatMap} into the compact
 * {@link SeatingSummary} that drives alert copy and the acceptable-seat gate. Pure functions,
 * provider-agnostic by design — any assigned-seating provider (cinemas, concert halls, trains)
 * reuses them unchanged.
 *
 * @packageDocumentation
 */

import type { Seat, SeatBlock, SeatDepth, SeatMap, SeatZone, SeatingSummary } from "@bookr/shared";

/**
 * Classify a horizontal span into a zone by the third of the auditorium its midpoint falls in.
 *
 * @param midColumn - Midpoint column of the span (may be fractional).
 * @param columns - Total column count of the layout.
 * @returns The zone.
 */
export function zoneOf(midColumn: number, columns: number): SeatZone {
  if (columns <= 0) return "center";
  // Normalize by the cell midpoint so a 6-wide room splits cleanly 1-2 / 3-4 / 5-6.
  const ratio = (midColumn - 0.5) / columns;
  if (ratio < 1 / 3) return "left";
  if (ratio > 2 / 3) return "right";
  return "center";
}

/**
 * Classify a row into a depth by the third of the auditorium it falls in, front-to-back.
 *
 * @param rowIndex - Zero-based row index, row 0 nearest the screen/stage.
 * @param rowCount - Total row count of the layout.
 * @returns The depth.
 */
export function depthOf(rowIndex: number, rowCount: number): SeatDepth {
  if (rowCount <= 0) return "middle";
  const ratio = (rowIndex + 0.5) / rowCount;
  if (ratio < 1 / 3) return "front";
  if (ratio > 2 / 3) return "back";
  return "middle";
}

/** Best-first block order: center beats sides, non-front beats front, then larger, then backer. */
function compareBlocks(a: SeatBlock, b: SeatBlock, rows: string[]): number {
  const positionScore = (blk: SeatBlock): number => (blk.position === "center" ? 1 : 0);
  const depthScore = (blk: SeatBlock): number => (blk.depth === "front" ? 0 : 1);
  return (
    positionScore(b) - positionScore(a) ||
    depthScore(b) - depthScore(a) ||
    b.size - a.size ||
    rows.indexOf(b.row) - rows.indexOf(a.row)
  );
}

/**
 * Digest a seat map into overall occupancy plus the contiguous available blocks, best-first.
 *
 * Adjacency is judged by `column` (physical position — seat *names* can run in the opposite
 * direction, as AMC's do); a missing column index (aisle/void) breaks a run. When `acceptable`
 * is given, blocks are computed over available ∩ acceptable seats only, while the occupancy
 * counts always describe the whole auditorium — "62% full" stays true even when the caller only
 * cares about a hand-picked set.
 *
 * @param map - The full seat map.
 * @param acceptable - Optional set of acceptable seat ids to mask block-finding to.
 * @returns The summary, blocks sorted best-first.
 */
export function summarizeSeatMap(map: SeatMap, acceptable?: ReadonlySet<string>): SeatingSummary {
  const sellable = map.seats.filter((s) => s.status !== "unavailable");
  const available = sellable.filter((s) => s.status === "available");

  const byRow = new Map<string, Seat[]>();
  for (const seat of available) {
    if (acceptable && !acceptable.has(seat.id)) continue;
    const row = byRow.get(seat.row) ?? [];
    row.push(seat);
    byRow.set(seat.row, row);
  }

  const blocks: SeatBlock[] = [];
  for (const [row, seats] of byRow) {
    seats.sort((a, b) => a.column - b.column);
    let run: Seat[] = [];
    const flush = (): void => {
      if (run.length === 0) return;
      const first = run[0] as Seat;
      const last = run[run.length - 1] as Seat;
      blocks.push({
        row,
        seatIds: run.map((s) => s.id),
        size: run.length,
        position: zoneOf((first.column + last.column) / 2, map.columns),
        depth: depthOf(map.rows.indexOf(row), map.rows.length),
      });
      run = [];
    };
    for (const seat of seats) {
      const prev = run[run.length - 1];
      if (prev && seat.column !== prev.column + 1) flush();
      run.push(seat);
    }
    flush();
  }
  blocks.sort((a, b) => compareBlocks(a, b, map.rows));

  const totalSeats = sellable.length;
  const availableSeats = available.length;
  return {
    totalSeats,
    availableSeats,
    percentTaken: totalSeats === 0 ? 0 : Math.round(((totalSeats - availableSeats) / totalSeats) * 100),
    blocks,
  };
}
