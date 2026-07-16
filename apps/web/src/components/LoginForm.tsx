import { useState } from "react";
import type { FormEvent } from "react";
import { Loader2, Ticket } from "lucide-react";
import { ApiError, api } from "../api/client.ts";
import { Button } from "./ui/button.tsx";
import { Input } from "./ui/input.tsx";
import { Label } from "./ui/label.tsx";

/** Props for {@link LoginForm}. */
export interface LoginFormProps {
  /** Called after a successful login, so the parent can re-fetch protected data. */
  onLoggedIn: () => void;
}

/**
 * Single-field password login for the dashboard's session-cookie auth. Bookr is a single-operator
 * tool, so there is no username — only the shared `UI_PASSWORD`. Rendered as a centered card over
 * a subtly lit backdrop so the sign-in is the deliberate first impression of the console.
 */
export function LoginForm({ onLoggedIn }: LoginFormProps): React.JSX.Element {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setSubmitting(true);
    setError(undefined);
    try {
      await api.auth.login(password);
      onLoggedIn();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "login failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4">
      <div
        aria-hidden
        className="bg-primary/20 pointer-events-none absolute -top-40 left-1/2 size-[36rem] -translate-x-1/2 rounded-full blur-[120px]"
      />
      <form
        onSubmit={handleSubmit}
        className="bg-card/90 relative z-10 w-full max-w-sm rounded-2xl border p-8 shadow-lg backdrop-blur"
      >
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <span className="bg-primary text-primary-foreground flex size-11 items-center justify-center rounded-xl shadow-sm">
            <Ticket className="size-6" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Bookr</h1>
            <p className="text-muted-foreground text-sm">Reservation & seat watch console</p>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            value={password}
            autoFocus
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
          />
        </div>

        <Button type="submit" disabled={submitting || password.length === 0} className="mt-5 w-full gap-2">
          {submitting && <Loader2 className="size-4 animate-spin" />}
          {submitting ? "Signing in…" : "Sign in"}
        </Button>

        {error && (
          <p role="alert" className="text-destructive mt-4 text-center text-sm">
            {error}
          </p>
        )}
      </form>
    </div>
  );
}
