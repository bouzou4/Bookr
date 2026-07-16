/**
 * The seating engine: pure seat-map analysis (occupancy digests, contiguous-block finding), the
 * acceptable-seat alert gate, and layout-geometry signatures for per-theater preference caching.
 *
 * @packageDocumentation
 */

export { depthOf, summarizeSeatMap, zoneOf } from "./summary.ts";
export { passesSeatingGate, resolveAcceptableSeats } from "./gate.ts";
export { layoutSignature } from "./signature.ts";
