import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { sampleWatch } from "../test/fixtures.ts";
import { WatchForm } from "./WatchForm.tsx";

describe("WatchForm", () => {
  it("pre-fills fields from an existing watch, including a fixed date range", async () => {
    const fixedWatch = { ...sampleWatch, dateRange: { start: "2026-07-20", end: "2026-07-25" } };
    render(<WatchForm initial={fixedWatch} onSubmit={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByLabelText("Label")).toHaveProperty("value", "Carbone Friday");
    expect(screen.getByLabelText("Start date")).toHaveProperty("value", "2026-07-20");
  });

  it("submits validated input for a rolling-days watch", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<WatchForm onSubmit={onSubmit} onCancel={vi.fn()} />);

    await user.type(screen.getByLabelText("Label"), "Test watch");
    await user.type(screen.getByLabelText("Venue id"), "42");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const [input] = onSubmit.mock.calls[0]!;
    expect(input.label).toBe("Test watch");
    expect(input.venue).toEqual({ id: "42", slug: undefined });
    expect(input.dateRange).toEqual({ rollingDays: 14 });
  });

  it("switches to a fixed date range and submits it", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<WatchForm onSubmit={onSubmit} onCancel={vi.fn()} />);

    await user.type(screen.getByLabelText("Label"), "Fixed range watch");
    await user.type(screen.getByLabelText("Venue id"), "42");
    await user.click(screen.getByRole("radio", { name: "Fixed" }));
    await user.type(screen.getByLabelText("Start date"), "2026-08-01");
    await user.type(screen.getByLabelText("End date"), "2026-08-05");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const [fixedInput] = onSubmit.mock.calls[0]!;
    expect(fixedInput.dateRange).toEqual({ start: "2026-08-01", end: "2026-08-05" });
  });

  it("shows field errors and does not submit when validation fails", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<WatchForm onSubmit={onSubmit} onCancel={vi.fn()} />);

    // Label and venue id left blank.
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getAllByText(/./, { selector: ".field-error" }).length).toBeGreaterThan(0);
  });

  it("calls onCancel when cancelled", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<WatchForm onSubmit={vi.fn()} onCancel={onCancel} />);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
