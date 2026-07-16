import { AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import type { CredentialStatus, SessionState } from "@bookr/shared";
import { api } from "../api/client.ts";
import { formatDateTime, formatRelative } from "../lib/format.ts";
import { useAsync } from "../hooks/useAsync.ts";
import { PageHeader } from "../components/PageHeader.tsx";
import { Badge } from "../components/ui/badge.tsx";
import { Button } from "../components/ui/button.tsx";
import { Card } from "../components/ui/card.tsx";
import { Skeleton } from "../components/ui/skeleton.tsx";

/** Picks the badge tone that best conveys how urgently a session state needs attention. */
function sessionBadgeVariant(state: SessionState): "signal" | "warn" | "full" {
  if (state === "active") return "signal";
  if (state === "expired") return "full";
  return "warn"; // challenged, missing, or any other non-active state needs a look
}

/**
 * Color-coded badge for a provider's session state. Exposes `data-needs-attention` so tests (and
 * any future styling) can key off the server's own attention flag rather than re-deriving it.
 */
function SessionStateBadge({ status }: { status: CredentialStatus }): React.JSX.Element {
  return (
    <Badge variant={sessionBadgeVariant(status.sessionState)} data-needs-attention={status.needsAttention || undefined}>
      {status.sessionState}
    </Badge>
  );
}

/**
 * Health screen: overall service health from the public health endpoint (last scan pass,
 * scheduler state), plus per-provider session state from the authenticated credentials endpoint
 * — the `/api/health` payload is intentionally minimal and carries no provider detail.
 */
export function HealthPage(): React.JSX.Element {
  const { data: health, error, loading, reload: reloadHealth } = useAsync(() => api.health.status(), []);
  const { data: providers, reload: reloadProviders } = useAsync(() => api.credentials.status(), []);

  function reload(): void {
    reloadHealth();
    reloadProviders();
  }

  return (
    <section>
      <PageHeader
        eyebrow="Status"
        title="Health"
        description="Scheduler status and per-provider session health at a glance."
        actions={
          <Button variant="outline" onClick={reload} className="gap-2">
            <RefreshCw className="size-4" />
            Refresh
          </Button>
        }
      />

      {loading && (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      )}

      {error && (
        <p role="alert" className="text-destructive text-sm">
          Failed to load health: {error.message}
        </p>
      )}

      {health && (
        <div className="space-y-6">
          <Card
            className={`flex flex-col gap-4 border p-5 sm:flex-row sm:items-center sm:justify-between ${
              health.ok ? "border-signal/30 bg-signal/10" : "border-full/30 bg-full/10"
            }`}
          >
            <div className="flex items-center gap-3">
              {health.ok ? (
                <CheckCircle2 className="text-signal size-8 shrink-0" />
              ) : (
                <AlertTriangle className="text-full size-8 shrink-0" />
              )}
              <div>
                <p className={`font-display text-xl font-semibold ${health.ok ? "text-signal" : "text-full"}`}>
                  {health.ok ? "Healthy" : "Needs attention"}
                </p>
                <p className="text-muted-foreground text-sm">Overall service status</p>
              </div>
            </div>
            <div className="flex items-center gap-8">
              <div>
                <p className="text-muted-foreground text-[0.68rem] tracking-wide uppercase">Scheduler</p>
                <p className="tnum text-sm font-medium">{health.schedulerRunning ? "running" : "stopped"}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-[0.68rem] tracking-wide uppercase">Last pass</p>
                <p className="text-sm font-medium">
                  {health.lastPassAt ? formatRelative(health.lastPassAt) : "never"}
                </p>
              </div>
            </div>
          </Card>

          <div>
            <h3 className="text-muted-foreground mb-3 text-xs font-medium tracking-wide uppercase">Providers</h3>
            <div className="space-y-3">
              {(providers ?? []).map((p) => (
                <Card key={p.provider} className="gap-0 p-4 sm:p-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-3">
                      <Badge variant="secondary" className="font-mono uppercase">
                        {p.provider}
                      </Badge>
                      <SessionStateBadge status={p} />
                    </div>
                    <div>
                      <p className="text-muted-foreground text-[0.68rem] tracking-wide uppercase">Expires</p>
                      <p className="text-sm">{p.expiresAt ? formatDateTime(p.expiresAt) : "—"}</p>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
