import { useState } from "react";
import { KeyRound } from "lucide-react";
import type { CredentialStatus, ProviderName, SessionState } from "@bookr/shared";
import { api } from "../api/client.ts";
import { formatDateTime } from "../lib/format.ts";
import { useAsync } from "../hooks/useAsync.ts";
import { IngestForm } from "../components/IngestForm.tsx";
import { PageHeader } from "../components/PageHeader.tsx";
import { EmptyState } from "../components/EmptyState.tsx";
import { Badge } from "../components/ui/badge.tsx";
import { Button } from "../components/ui/button.tsx";
import { Card } from "../components/ui/card.tsx";
import { Skeleton } from "../components/ui/skeleton.tsx";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog.tsx";

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
 * Credentials screen: shows per-provider session status and lets the operator hand over a
 * freshly captured session (e.g. after a provider challenge) via the ingest endpoint.
 */
export function CredentialsPage(): React.JSX.Element {
  const { data: statuses, error, loading, reload } = useAsync(() => api.credentials.status(), []);
  const [handoverProvider, setHandoverProvider] = useState<ProviderName | null>(null);

  function closeHandover(): void {
    setHandoverProvider(null);
  }

  return (
    <section>
      <PageHeader
        eyebrow="Access"
        title="Credentials"
        description="Session status for every provider Bookr books through, and a place to hand over a freshly captured token."
      />

      {loading && (
        <div className="space-y-3">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      )}

      {error && (
        <p role="alert" className="text-destructive text-sm">
          Failed to load credentials: {error.message}
        </p>
      )}

      {statuses && statuses.length === 0 && (
        <EmptyState
          icon={KeyRound}
          title="No providers configured."
          description="Providers appear here once Bookr has attempted to log in."
        />
      )}

      {statuses && statuses.length > 0 && (
        <div className="space-y-3">
          {statuses.map((status) => (
            <Card key={status.provider} className="gap-0 p-4 sm:p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <Badge variant="secondary" className="font-mono uppercase">
                    {status.provider}
                  </Badge>
                  <SessionStateBadge status={status} />
                </div>
                <div className="flex items-center justify-between gap-4 sm:justify-end sm:gap-8">
                  <div>
                    <p className="text-muted-foreground text-[0.68rem] tracking-wide uppercase">Expires</p>
                    <p className="text-sm">{status.expiresAt ? formatDateTime(status.expiresAt) : "—"}</p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => setHandoverProvider(status.provider)}>
                    Hand over token
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={handoverProvider !== null} onOpenChange={(open) => !open && closeHandover()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hand over session{handoverProvider ? ` — ${handoverProvider}` : ""}</DialogTitle>
            <DialogDescription>
              Paste the ingest token and the raw session blob captured by the off-box login tool.
            </DialogDescription>
          </DialogHeader>
          {handoverProvider && (
            <IngestForm
              provider={handoverProvider}
              onIngested={() => {
                closeHandover();
                reload();
              }}
            />
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={closeHandover}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
