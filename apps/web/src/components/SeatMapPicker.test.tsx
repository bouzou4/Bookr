import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SeatMapView } from "@bookr/shared";
import { SeatMapPicker } from "./SeatMapPicker.tsx";

const view: SeatMapView = {
  map: {
    rows: ["A", "B"],
    columns: 3,
    seats: [
      { id: "A3", row: "A", column: 1, status: "available" },
      { id: "A2", row: "A", column: 2, status: "taken" },
      { id: "A1", row: "A", column: 3, status: "available" },
      { id: "B3", row: "B", column: 1, status: "available", type: "Wheelchair" },
      { id: "B2", row: "B", column: 2, status: "available", type: "Companion" },
    ],
  },
  signature: "sig-test",
  summary: { totalSeats: 5, availableSeats: 4, percentTaken: 20, blocks: [] },
};

describe("SeatMapPicker", () => {
  it("renders every seat with occupancy and type context", () => {
    render(<SeatMapPicker view={view} selected={[]} onChange={vi.fn()} />);
    expect(screen.getAllByRole("button")).toHaveLength(5);
    expect(screen.getByTitle("A2 (occupied)")).toBeDefined();
    expect(screen.getByTitle("Wheelchair B3")).toBeDefined();
    expect(screen.getByText("4/5 open (20% taken)")).toBeDefined();
  });

  it("toggles seats on click, including currently occupied ones", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<SeatMapPicker view={view} selected={["A3"]} onChange={onChange} />);

    // Selecting an occupied seat is deliberate: the watch alerts when it frees up.
    await user.click(screen.getByTitle("A2 (occupied)"));
    expect(onChange).toHaveBeenLastCalledWith(expect.arrayContaining(["A3", "A2"]));

    await user.click(screen.getByTitle("A3"));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("marks selected seats pressed and reports the selection count", () => {
    render(<SeatMapPicker view={view} selected={["A3", "A1"]} onChange={vi.fn()} />);
    expect(screen.getByTitle("A3").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTitle("A2 (occupied)").getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByText("2 acceptable seats")).toBeDefined();
  });
});
