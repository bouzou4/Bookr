import { describe, expect, it } from "vitest";
import { dedupeKeyDate, formatDedupeKey, parseDedupeKey, type DedupeKeyParts } from "./dedupe.ts";

const parts: DedupeKeyParts = {
  provider: "resy",
  venueId: "6194",
  date: "2026-07-20",
  start: "19:15:00",
  partySize: 2,
  kind: "Bar Counter",
};

describe("dedupe key", () => {
  it("round-trips parts through format/parse", () => {
    const key = formatDedupeKey(parts);
    expect(key).toBe("resy:6194:2026-07-20:191500:2:Bar Counter");
    expect(parseDedupeKey(key)).toEqual(parts);
  });

  it("round-trips without a kind", () => {
    const noKind: DedupeKeyParts = { ...parts, kind: undefined };
    expect(parseDedupeKey(formatDedupeKey(noKind))).toEqual(noKind);
  });

  it("recovers the date cheaply and safely", () => {
    expect(dedupeKeyDate(formatDedupeKey(parts))).toBe("2026-07-20");
  });

  it("tolerates a colon inside kind", () => {
    const odd: DedupeKeyParts = { ...parts, kind: "Chef:Counter" };
    expect(parseDedupeKey(formatDedupeKey(odd)).kind).toBe("Chef:Counter");
  });

  it("throws on a malformed key", () => {
    expect(() => parseDedupeKey("too:short")).toThrow(/malformed/);
    expect(() => dedupeKeyDate("a:b")).toThrow(/malformed/);
  });
});
