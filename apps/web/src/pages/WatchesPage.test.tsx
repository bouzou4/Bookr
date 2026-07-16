import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { server } from "../test/server.ts";
import { sampleWatch } from "../test/fixtures.ts";
import { WatchesPage } from "./WatchesPage.tsx";

describe("WatchesPage", () => {
  it("lists existing watches", async () => {
    render(<WatchesPage />);
    expect(await screen.findByText("Carbone Friday")).toBeTruthy();
    expect(screen.getByText("resy")).toBeTruthy();
  });

  it("shows a load error", async () => {
    server.use(http.get("/api/watches", () => HttpResponse.json({ error: "boom" }, { status: 500 })));
    render(<WatchesPage />);
    expect(await screen.findByRole("alert")).toBeTruthy();
  });

  it("shows an empty state", async () => {
    server.use(http.get("/api/watches", () => HttpResponse.json([])));
    render(<WatchesPage />);
    expect(await screen.findByText("No watches yet.")).toBeTruthy();
  });

  it("creates a new watch through the form", async () => {
    const user = userEvent.setup();
    server.use(http.get("/api/watches", () => HttpResponse.json([])));
    render(<WatchesPage />);
    await screen.findByText("No watches yet.");

    await user.click(screen.getByRole("button", { name: "New watch" }));
    await user.type(screen.getByLabelText("Label"), "Bar seats");
    // Venue is resolved by search now, not a raw id field.
    await user.type(screen.getByLabelText("Venue"), "test");
    await user.click(screen.getByRole("button", { name: "Search" }));
    await user.click(await screen.findByRole("button", { name: /Test Venue 42/ }));
    await user.clear(screen.getByLabelText("Timezone (IANA)"));
    await user.type(screen.getByLabelText("Timezone (IANA)"), "America/New_York");

    server.use(http.get("/api/watches", () => HttpResponse.json([sampleWatch])));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("heading", { name: "Watches" })).toBeTruthy();
  });

  it("rejects an invalid form submission with a field error", async () => {
    const user = userEvent.setup();
    server.use(http.get("/api/watches", () => HttpResponse.json([])));
    render(<WatchesPage />);
    await user.click(screen.getByRole("button", { name: "New watch" }));

    // Label and venue id are left blank; zod should reject the submission client-side.
    await user.clear(screen.getByLabelText("Timezone (IANA)"));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findAllByText(/required|expected|Invalid|Number must be greater/i)).not.toHaveLength(0);
  });

  it("toggles enabled state", async () => {
    const user = userEvent.setup();
    render(<WatchesPage />);
    const row = (await screen.findByText("Carbone Friday")).closest("tr");
    expect(row).toBeTruthy();
    await user.click(within(row as HTMLElement).getByRole("button", { name: "Disable" }));
    expect(await screen.findByText("Carbone Friday")).toBeTruthy();
  });

  it("edits an existing watch", async () => {
    const user = userEvent.setup();
    render(<WatchesPage />);
    const row = (await screen.findByText("Carbone Friday")).closest("tr");
    await user.click(within(row as HTMLElement).getByRole("button", { name: "Edit" }));
    expect(await screen.findByRole("heading", { name: "Edit Carbone Friday" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(await screen.findByRole("heading", { name: "Watches" })).toBeTruthy();
  });

  it("deletes a watch after confirmation", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<WatchesPage />);
    const row = (await screen.findByText("Carbone Friday")).closest("tr");
    await user.click(within(row as HTMLElement).getByRole("button", { name: "Delete" }));
    expect(window.confirm).toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("surfaces a mutation error", async () => {
    const user = userEvent.setup();
    render(<WatchesPage />);
    const row = (await screen.findByText("Carbone Friday")).closest("tr");
    server.use(http.put("/api/watches/:id", () => HttpResponse.json({ error: "locked" }, { status: 409 })));
    await user.click(within(row as HTMLElement).getByRole("button", { name: "Disable" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
  });
});
