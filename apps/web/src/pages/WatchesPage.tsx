import { useState } from "react";
import { Clock, MapPin, Pencil, Plus, Radar, Trash2, Users, Zap } from "lucide-react";
import type { Watch, WatchInput } from "@bookr/shared";
import { ApiError, api } from "../api/client.ts";
import { useAsync } from "../hooks/useAsync.ts";
import { WatchForm } from "../components/WatchForm.tsx";
import { PageHeader } from "../components/PageHeader.tsx";
import { EmptyState } from "../components/EmptyState.tsx";
import { Badge } from "../components/ui/badge.tsx";
import { Button } from "../components/ui/button.tsx";
import { Card } from "../components/ui/card.tsx";
import { Separator } from "../components/ui/separator.tsx";
import { Skeleton } from "../components/ui/skeleton.tsx";
import { Switch } from "../components/ui/switch.tsx";

function describeDateRange(watch: Watch): string {
  return "rollingDays" in watch.dateRange
    ? `next ${watch.dateRange.rollingDays}d`
    : `${watch.dateRange.start} → ${watch.dateRange.end}`;
}

/** A labelled metadata cell used inside a watch row. */
function Meta({ icon: Icon, label, value }: { icon: typeof Clock; label: string; value: string }): React.JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <Icon className="text-muted-foreground size-4 shrink-0" />
      <div className="min-w-0">
        <p className="text-muted-foreground text-[0.68rem] tracking-wide uppercase">{label}</p>
        <p className="tnum truncate text-sm">{value}</p>
      </div>
    </div>
  );
}

/**
 * Watches screen: lists every configured watch as a responsive row-card and lets the operator
 * create, edit, delete, and enable/disable them. Validation happens in {@link WatchForm}; this
 * page only wires form submission to the REST client and refreshes the list afterward.
 */
export function WatchesPage(): React.JSX.Element {
  const { data: watches, error, loading, reload } = useAsync(() => api.watches.list(), []);
  const [editing, setEditing] = useState<Watch | "new" | null>(null);
  const [actionError, setActionError] = useState<string>();

  async function handleSubmit(input: WatchInput): Promise<void> {
    setActionError(undefined);
    try {
      if (editing && editing !== "new") {
        await api.watches.update(editing.id, input);
      } else {
        await api.watches.create(input);
      }
      setEditing(null);
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "save failed");
    }
  }

  async function handleToggle(watch: Watch): Promise<void> {
    setActionError(undefined);
    try {
      await api.watches.update(watch.id, { enabled: !watch.enabled });
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "update failed");
    }
  }

  async function handleDelete(watch: Watch): Promise<void> {
    if (!window.confirm(`Delete watch "${watch.label}"?`)) return;
    setActionError(undefined);
    try {
      await api.watches.remove(watch.id);
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "delete failed");
    }
  }

  if (editing) {
    return (
      <section>
        <PageHeader
          eyebrow={editing === "new" ? "New watch" : "Editing"}
          title={editing === "new" ? "New watch" : `Edit ${editing.label}`}
          description="Point Bookr at a venue and the exact availability worth pinging you about."
        />
        <Card className="p-6">
          <WatchForm
            initial={editing === "new" ? undefined : editing}
            onSubmit={handleSubmit}
            onCancel={() => setEditing(null)}
          />
        </Card>
      </section>
    );
  }

  return (
    <section>
      <PageHeader
        eyebrow="Reservations"
        title="Watches"
        description="Every venue Bookr is scanning for a newly-freed slot."
        actions={
          <Button onClick={() => setEditing("new")} className="gap-2">
            <Plus className="size-4" />
            New watch
          </Button>
        }
      />

      {actionError && (
        <p role="alert" className="text-destructive mb-4 text-sm">
          {actionError}
        </p>
      )}

      {loading && (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      )}

      {error && (
        <p role="alert" className="text-destructive text-sm">
          Failed to load watches: {error.message}
        </p>
      )}

      {watches && watches.length === 0 && (
        <EmptyState
          icon={Radar}
          title="No watches yet."
          description="Create your first watch to start scanning a venue for freed reservations or seats."
          action={
            <Button onClick={() => setEditing("new")} className="gap-2">
              <Plus className="size-4" />
              Create watch
            </Button>
          }
        />
      )}

      {watches && watches.length > 0 && (
        <div className="space-y-3">
          {watches.map((watch) => (
            <Card
              key={watch.id}
              data-watch-row
              className={`gap-0 p-4 transition-opacity md:p-5 ${watch.enabled ? "" : "opacity-60"}`}
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate text-base font-semibold">{watch.label}</h3>
                    <Badge variant="secondary" className="uppercase">
                      {watch.provider}
                    </Badge>
                    {watch.autobook && (
                      <Badge variant="signal" className="gap-1">
                        <Zap className="size-3" />
                        auto
                      </Badge>
                    )}
                  </div>
                  <p className="text-muted-foreground mt-1 flex items-center gap-1.5 text-sm">
                    <MapPin className="size-3.5 shrink-0" />
                    <span className="truncate">{watch.venue.slug ?? watch.venue.id}</span>
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:w-[26rem] lg:shrink-0">
                  <Meta icon={Users} label="Party" value={`${watch.partySize}`} />
                  <Meta icon={Clock} label="Window" value={`${watch.timeWindow.start}–${watch.timeWindow.end}`} />
                  <Meta icon={Radar} label="Dates" value={describeDateRange(watch)} />
                </div>

                <Separator className="lg:hidden" />

                <div className="flex items-center justify-between gap-2 lg:justify-end">
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <Switch
                      checked={watch.enabled}
                      onCheckedChange={() => void handleToggle(watch)}
                      aria-label={watch.enabled ? "Disable watch" : "Enable watch"}
                    />
                    <span className="text-muted-foreground w-14">{watch.enabled ? "Enabled" : "Paused"}</span>
                  </label>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" aria-label="Edit" onClick={() => setEditing(watch)}>
                      <Pencil className="size-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Delete"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => void handleDelete(watch)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
