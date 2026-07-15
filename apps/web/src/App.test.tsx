import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { server } from "./test/server.ts";
import { App } from "./App.tsx";

describe("App", () => {
  it("shows the login form when the session probe is unauthenticated", async () => {
    server.use(http.get("/api/watches", () => HttpResponse.json({ error: "unauthorized" }, { status: 401 })));
    render(<App />);
    expect(await screen.findByLabelText("Password")).toBeTruthy();
  });

  it("logs in and then shows the dashboard with tab navigation", async () => {
    server.use(http.get("/api/watches", () => HttpResponse.json({ error: "unauthorized" }, { status: 401 })));
    const user = userEvent.setup();
    render(<App />);

    await screen.findByLabelText("Password");
    await user.type(screen.getByLabelText("Password"), "correct-password");
    server.use(http.get("/api/watches", () => HttpResponse.json([])));
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("heading", { name: "Watches" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Activity" }));
    expect(await screen.findByRole("heading", { name: "Activity" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Credentials" }));
    expect(await screen.findByRole("heading", { name: "Credentials" })).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Health" }));
    expect(await screen.findByRole("heading", { name: "Health" })).toBeTruthy();
  });

  it("goes straight to the dashboard when already authenticated", async () => {
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Watches" })).toBeTruthy();
  });

  it("logs out back to the login form", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Watches" });

    server.use(http.get("/api/watches", () => HttpResponse.json({ error: "unauthorized" }, { status: 401 })));
    await user.click(screen.getByRole("button", { name: "Log out" }));

    await waitFor(async () => {
      expect(await screen.findByLabelText("Password")).toBeTruthy();
    });
  });
});
