import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { server } from "../test/server.ts";
import { ActivityPage } from "./ActivityPage.tsx";

/**
 * `slot-found` is both an option value in the type filter <select> and the rendered event type
 * in the feed, so lookups for it must be scoped to the feed list to stay unambiguous.
 */
function feed(): HTMLElement {
  return document.querySelector(".activity-feed") as HTMLElement;
}

describe("ActivityPage", () => {
  it("renders recent events", async () => {
    render(<ActivityPage />);
    expect(await screen.findByText("Table for 2 at 19:00")).toBeTruthy();
    expect(within(feed()).getByText("slot-found")).toBeTruthy();
  });

  it("shows an empty state", async () => {
    server.use(http.get("/api/activity", () => HttpResponse.json([])));
    render(<ActivityPage />);
    expect(await screen.findByText("No activity yet.")).toBeTruthy();
  });

  it("shows a load error", async () => {
    server.use(http.get("/api/activity", () => HttpResponse.json({ error: "boom" }, { status: 500 })));
    render(<ActivityPage />);
    expect(await screen.findByRole("alert")).toBeTruthy();
  });

  it("refetches with the selected type filter", async () => {
    const user = userEvent.setup();
    server.use(
      http.get("/api/activity", ({ request }) => {
        const url = new URL(request.url);
        if (url.searchParams.get("type") === "booked") {
          return HttpResponse.json([
            { id: 2, at: "2026-07-13T11:00:00.000Z", type: "booked", provider: "resy", detail: "Booked!" },
          ]);
        }
        return HttpResponse.json([]);
      }),
    );
    render(<ActivityPage />);
    await screen.findByText("No activity yet.");
    await user.selectOptions(screen.getByLabelText("Type"), "booked");
    expect(await screen.findByText("Booked!")).toBeTruthy();
  });

  it("supports a manual refresh", async () => {
    const user = userEvent.setup();
    render(<ActivityPage />);
    await screen.findByText("Table for 2 at 19:00");
    await user.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByText("Table for 2 at 19:00")).toBeTruthy();
    expect(within(feed()).getByText("slot-found")).toBeTruthy();
  });
});
