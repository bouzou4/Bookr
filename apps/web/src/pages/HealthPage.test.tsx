import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { server } from "../test/server.ts";
import { HealthPage } from "./HealthPage.tsx";

describe("HealthPage", () => {
  it("renders overall health and per-provider status", async () => {
    render(<HealthPage />);
    expect(await screen.findByText("Healthy")).toBeTruthy();
    expect(screen.getByText("running")).toBeTruthy();
    expect(screen.getByText("resy")).toBeTruthy();
  });

  it("renders a degraded state", async () => {
    server.use(
      http.get("/api/health", () => HttpResponse.json({ ok: false, schedulerRunning: false })),
      // Per-provider detail comes from the authenticated credentials endpoint, not /api/health.
      http.get("/api/credentials", () =>
        HttpResponse.json([{ provider: "resy", sessionState: "challenged", needsAttention: true }]),
      ),
    );
    render(<HealthPage />);
    expect(await screen.findByText("Needs attention")).toBeTruthy();
    expect(screen.getByText("stopped")).toBeTruthy();
    expect(await screen.findByText("challenged")).toBeTruthy();
    expect(screen.getByText("challenged").className).toContain("needs-attention");
  });

  it("shows a load error", async () => {
    server.use(http.get("/api/health", () => HttpResponse.json({ error: "boom" }, { status: 500 })));
    render(<HealthPage />);
    expect(await screen.findByRole("alert")).toBeTruthy();
  });

  it("supports a manual refresh", async () => {
    const user = userEvent.setup();
    render(<HealthPage />);
    await screen.findByText("Healthy");
    await user.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByText("Healthy")).toBeTruthy();
  });
});
