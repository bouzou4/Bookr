import { describe, expect, it } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { server } from "../test/server.ts";
import { CredentialsPage } from "./CredentialsPage.tsx";

describe("CredentialsPage", () => {
  it("shows per-provider session status", async () => {
    render(<CredentialsPage />);
    expect(await screen.findByText("resy")).toBeTruthy();
    expect(screen.getByText("active")).toBeTruthy();
  });

  it("flags a provider needing attention", async () => {
    server.use(
      http.get("/api/credentials", () =>
        HttpResponse.json([{ provider: "resy", sessionState: "challenged", needsAttention: true }]),
      ),
    );
    render(<CredentialsPage />);
    const cell = await screen.findByText("challenged");
    expect(cell.className).toContain("needs-attention");
  });

  it("shows a load error", async () => {
    server.use(http.get("/api/credentials", () => HttpResponse.json({ error: "boom" }, { status: 500 })));
    render(<CredentialsPage />);
    expect(await screen.findByRole("alert")).toBeTruthy();
  });

  it("hands over a session token to the ingest endpoint", async () => {
    const user = userEvent.setup();
    let received: { auth: string | null; body: unknown } | undefined;
    server.use(
      http.post("/api/ingest/resy", async ({ request }) => {
        received = { auth: request.headers.get("authorization"), body: await request.json() };
        return new HttpResponse(null, { status: 200 });
      }),
    );
    render(<CredentialsPage />);
    await user.click(await screen.findByRole("button", { name: "Hand over token" }));

    const form = screen.getByRole("form", { name: "Hand over session" });
    await user.type(within(form).getByLabelText("Ingest token"), "topsecret");
    // userEvent's `{` opens a special-key sequence, so a literal `{` is escaped as `{{`; `}` needs
    // no escaping.
    await user.type(within(form).getByLabelText("Session blob (JSON)"), '{{"token":"abc"}');
    await user.click(within(form).getByRole("button", { name: "Hand over token" }));

    // The panel closes (via onIngested) once the POST resolves, so wait for that instead of
    // asserting on `received` immediately after the click.
    await waitFor(() => expect(screen.queryByLabelText("Ingest token")).toBeNull());
    expect(received?.auth).toBe("Bearer topsecret");
    expect(received?.body).toEqual({ session: { token: "abc" } });
  });

  it("rejects an invalid JSON session blob", async () => {
    const user = userEvent.setup();
    render(<CredentialsPage />);
    await user.click(await screen.findByRole("button", { name: "Hand over token" }));
    const form = screen.getByRole("form", { name: "Hand over session" });
    await user.type(within(form).getByLabelText("Ingest token"), "topsecret");
    await user.type(within(form).getByLabelText("Session blob (JSON)"), "not json");
    await user.click(within(form).getByRole("button", { name: "Hand over token" }));
    expect(await screen.findByText("session blob must be valid JSON")).toBeTruthy();
  });

  it("can cancel out of the hand-over panel", async () => {
    const user = userEvent.setup();
    render(<CredentialsPage />);
    await user.click(await screen.findByRole("button", { name: "Hand over token" }));
    expect(screen.getByLabelText("Ingest token")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Ingest token")).toBeNull();
  });
});
