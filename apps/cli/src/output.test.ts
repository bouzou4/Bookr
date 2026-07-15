import { describe, expect, it } from "vitest";
import { formatKeyValue, formatTable, printItem, printJson, printKeyValue, printRows, printTable } from "./output.ts";
import { captureIo } from "./test-support.ts";

describe("formatTable", () => {
  it("renders a placeholder for an empty row set", () => {
    expect(formatTable([], ["a", "b"])).toBe("(none)");
  });

  it("pads columns to the widest value, including the header", () => {
    const table = formatTable([{ name: "Al", age: 100 }, { name: "Bo", age: 7 }], ["name", "age"]);
    const lines = table.split("\n");
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe("name  age");
    expect(lines[1]).toBe("----  ---");
  });

  it("renders missing/null/object cells sensibly", () => {
    const table = formatTable([{ a: undefined, b: null, c: { x: 1 } }], ["a", "b", "c"]);
    expect(table).toContain('{"x":1}');
  });
});

describe("formatKeyValue", () => {
  it("aligns keys to the widest one", () => {
    const text = formatKeyValue({ id: "1", description: "long key here" });
    const lines = text.split("\n");
    expect(lines[0]?.startsWith("id ")).toBe(true);
  });

  it("handles an empty record", () => {
    expect(formatKeyValue({})).toBe("");
  });
});

describe("print helpers", () => {
  it("printJson writes pretty-printed JSON with a trailing newline", () => {
    const io = captureIo();
    printJson(io, { a: 1 });
    expect(io.out()).toBe('{\n  "a": 1\n}\n');
  });

  it("printTable/printKeyValue delegate to the formatters", () => {
    const io = captureIo();
    printTable(io, [{ a: 1 }], ["a"]);
    expect(io.out()).toContain("a\n");
    const io2 = captureIo();
    printKeyValue(io2, { a: 1 });
    expect(io2.out()).toBe("a  1\n");
  });

  it("printRows/printItem switch between JSON and human forms", () => {
    const io = captureIo();
    printRows(io, true, [{ a: 1 }], ["a"]);
    expect(JSON.parse(io.out())).toEqual([{ a: 1 }]);

    const io2 = captureIo();
    printRows(io2, false, [{ a: 1 }], ["a"]);
    expect(io2.out()).toContain("a");

    const io3 = captureIo();
    printItem(io3, true, { a: 1 });
    expect(JSON.parse(io3.out())).toEqual({ a: 1 });

    const io4 = captureIo();
    printItem(io4, false, { a: 1 });
    expect(io4.out()).toBe("a  1\n");
  });
});
