import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { ApiError, api } from "./api/client.ts";
import { AppShell, type Tab } from "./components/Nav.tsx";
import { LoginForm } from "./components/LoginForm.tsx";
import { Toaster } from "./components/ui/sonner.tsx";
import { WatchesPage } from "./pages/WatchesPage.tsx";
import { ActivityPage } from "./pages/ActivityPage.tsx";
import { CredentialsPage } from "./pages/CredentialsPage.tsx";
import { HealthPage } from "./pages/HealthPage.tsx";

type AuthState = "checking" | "authenticated" | "anonymous";

/**
 * Root component: gates the dashboard behind the session-cookie login (probed via a lightweight
 * watches fetch, since `/api/health` is intentionally unauthenticated and can't tell us that),
 * then renders the responsive app shell across the four dashboard screens.
 */
export function App(): React.JSX.Element {
  const [auth, setAuth] = useState<AuthState>("checking");
  const [tab, setTab] = useState<Tab>("watches");

  const probe = useCallback(() => {
    setAuth("checking");
    api.watches
      .list()
      .then(() => setAuth("authenticated"))
      .catch((err: unknown) => {
        setAuth(err instanceof ApiError && (err.status === 401 || err.status === 403) ? "anonymous" : "authenticated");
      });
  }, []);

  useEffect(() => {
    probe();
  }, [probe]);

  async function handleLogout(): Promise<void> {
    await api.auth.logout();
    setAuth("anonymous");
  }

  if (auth === "checking") {
    return (
      <div className="text-muted-foreground flex min-h-dvh items-center justify-center gap-2 text-sm">
        <Loader2 className="size-4 animate-spin" />
        Loading…
      </div>
    );
  }
  if (auth === "anonymous") {
    return (
      <>
        <LoginForm onLoggedIn={probe} />
        <Toaster />
      </>
    );
  }

  return (
    <>
      <AppShell active={tab} onSelect={setTab} onLogout={handleLogout}>
        {tab === "watches" && <WatchesPage />}
        {tab === "activity" && <ActivityPage />}
        {tab === "credentials" && <CredentialsPage />}
        {tab === "health" && <HealthPage />}
      </AppShell>
      <Toaster />
    </>
  );
}
