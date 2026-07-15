import { useState } from "react";
import type { FormEvent } from "react";
import { ApiError, api } from "../api/client.ts";

/** Props for {@link LoginForm}. */
export interface LoginFormProps {
  /** Called after a successful login, so the parent can re-fetch protected data. */
  onLoggedIn: () => void;
}

/**
 * Single-field password login form for the dashboard's session-cookie auth. Bookr is a
 * single-operator tool, so there is no username, only the shared `UI_PASSWORD`.
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
    <form className="login-form" onSubmit={handleSubmit}>
      <h1>Bookr</h1>
      <label htmlFor="password">Password</label>
      <input
        id="password"
        type="password"
        value={password}
        autoFocus
        onChange={(e) => setPassword(e.target.value)}
      />
      <button type="submit" disabled={submitting || password.length === 0}>
        {submitting ? "Signing in…" : "Sign in"}
      </button>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </form>
  );
}
