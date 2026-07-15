import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { server } from "../test/server.ts";
import { LoginForm } from "./LoginForm.tsx";

describe("LoginForm", () => {
  it("disables submit until a password is entered", () => {
    render(<LoginForm onLoggedIn={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Sign in" })).toHaveProperty("disabled", true);
  });

  it("calls onLoggedIn after a successful login", async () => {
    const onLoggedIn = vi.fn();
    const user = userEvent.setup();
    render(<LoginForm onLoggedIn={onLoggedIn} />);
    await user.type(screen.getByLabelText("Password"), "correct-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(onLoggedIn).toHaveBeenCalledTimes(1);
  });

  it("shows an error message on a failed login", async () => {
    server.use(http.post("/api/auth/login", () => HttpResponse.json({ error: "wrong password" }, { status: 401 })));
    const user = userEvent.setup();
    render(<LoginForm onLoggedIn={vi.fn()} />);
    await user.type(screen.getByLabelText("Password"), "nope");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("wrong password")).toBeTruthy();
  });
});
