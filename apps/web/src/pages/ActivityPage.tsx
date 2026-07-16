import { useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  Bell,
  BellOff,
  CalendarCheck,
  CalendarX,
  CheckCheck,
  KeyRound,
  Radar,
  RefreshCw,
  Rss,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import type { ActivityEvent, ActivityType } from "@bookr/shared";
import { api } from "../api/client.ts";
import { useAsync } from "../hooks/useAsync.ts";
import { PageHeader } from "../components/PageHeader.tsx";
import { EmptyState } from "../components/EmptyState.tsx";
import { Badge } from "../components/ui/badge.tsx";
import { Button } from "../components/ui/button.tsx";
import { Card } from "../components/ui/card.tsx";
import { Label } from "../components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select.tsx";
import { Skeleton } from "../components/ui/skeleton.tsx";
import { cn } from "../lib/utils.ts";

/** The subset of event types the operator can filter the feed to. */
const TYPES: ActivityType[] = [
  "slot-found",
  "notified",
  "booked",
  "book-failed",
  "auth-challenged",
  "error",
  "pass-complete",
];

/** Sentinel select value standing in for "no filter", since Radix Select rejects an empty string. */
const ALL_TYPES = "all";

/** Visual treatment (leading icon + badge color) for one event type. */
interface TypeStyle {
  icon: LucideIcon;
  badge: "signal" | "warn" | "full" | "secondary" | "outline";
}

/** Maps every known activity type to its icon and status color, per the control-room palette. */
const TYPE_STYLES: Record<ActivityType, TypeStyle> = {
  "slot-found": { icon: Radar, badge: "signal" },
  notified: { icon: Bell, badge: "signal" },
  booked: { icon: CalendarCheck, badge: "signal" },
  "pass-complete": { icon: CheckCheck, badge: "outline" },
  "auth-challenged": { icon: ShieldAlert, badge: "warn" },
  "book-failed": { icon: CalendarX, badge: "warn" },
  "notify-failed": { icon: BellOff, badge: "warn" },
  cancelled: { icon: XCircle, badge: "warn" },
  error: { icon: AlertTriangle, badge: "full" },
  "session-ingested": { icon: KeyRound, badge: "secondary" },
};

/** Icon medallion background/foreground classes matching a badge color. */
const ICON_WRAP_CLASS: Record<TypeStyle["badge"], string> = {
  signal: "bg-signal/15 text-signal",
  warn: "bg-warn/15 text-warn",
  full: "bg-full/15 text-full",
  secondary: "bg-secondary text-secondary-foreground",
  outline: "bg-muted text-muted-foreground",
};

/**
 * Formats an ISO timestamp as a short relative time (e.g. "3m ago", "yesterday"). Falls back to
 * the raw string when it can't be parsed; the raw value always remains available via the
 * rendered element's `title`/`dateTime` attributes.
 */
function formatRelativeTime(iso: string): string {
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return iso;
  const diffSeconds = Math.round((ms - Date.now()) / 1000);
  const unitSeconds: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31536000],
    ["month", 2592000],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  for (const [unit, secondsInUnit] of unitSeconds) {
    if (Math.abs(diffSeconds) >= secondsInUnit) {
      return rtf.format(Math.round(diffSeconds / secondsInUnit), unit);
    }
  }
  return rtf.format(diffSeconds, "second");
}

/** One row of the feed: a leading status icon plus a card carrying the event's details. */
function ActivityRow({ event, isLast }: { event: ActivityEvent; isLast: boolean }): React.JSX.Element {
  const style = TYPE_STYLES[event.type] ?? { icon: Rss, badge: "outline" as const };
  const Icon = style.icon;

  return (
    <div className="relative flex gap-3">
      {!isLast && (
        <span aria-hidden="true" className="bg-border absolute top-9 bottom-[-1rem] left-[17px] w-px" />
      )}
      <div
        className={cn(
          "relative z-10 flex size-9 shrink-0 items-center justify-center rounded-full",
          ICON_WRAP_CLASS[style.badge],
        )}
      >
        <Icon className="size-4" />
      </div>
      <Card className="min-w-0 flex-1 gap-2 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={style.badge} className="uppercase">
            {event.type}
          </Badge>
          {event.provider && (
            <Badge variant="outline" className="text-muted-foreground uppercase">
              {event.provider}
            </Badge>
          )}
          <time dateTime={event.at} title={event.at} className="tnum text-muted-foreground ml-auto shrink-0 text-xs">
            {formatRelativeTime(event.at)}
          </time>
        </div>
        {event.detail && <p className="text-sm leading-relaxed break-words">{event.detail}</p>}
      </Card>
    </div>
  );
}

/**
 * Activity screen: a recent-events feed, optionally filtered by event type, with a manual
 * refresh so the operator can pull the latest without waiting for the next scheduled reload.
 * Rendered as a vertical timeline, newest first, with each event's type color-coded to match the
 * status palette used across the dashboard.
 */
export function ActivityPage(): React.JSX.Element {
  const [type, setType] = useState<string>("");
  const { data: events, error, loading, reload } = useAsync(
    () => api.activity.recent({ limit: 100, type: type || undefined }),
    [type],
  );

  return (
    <section>
      <PageHeader
        eyebrow="Feed"
        title="Activity"
        description="Every scan, notification, and booking attempt Bookr has recorded, newest first."
        actions={
          <>
            <div className="flex items-center gap-2">
              <Label htmlFor="activity-type-filter" className="text-muted-foreground text-xs uppercase">
                Type
              </Label>
              <Select value={type || ALL_TYPES} onValueChange={(next) => setType(next === ALL_TYPES ? "" : next)}>
                <SelectTrigger id="activity-type-filter" size="sm" className="w-40">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_TYPES}>All</SelectItem>
                  {TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" size="sm" onClick={reload} className="gap-2">
              <RefreshCw className="size-4" />
              Refresh
            </Button>
          </>
        }
      />

      {loading && (
        <div className="space-y-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex gap-3">
              <Skeleton className="size-9 shrink-0 rounded-full" />
              <Skeleton className="h-20 w-full rounded-xl" />
            </div>
          ))}
        </div>
      )}

      {error && (
        <p role="alert" className="text-destructive text-sm">
          Failed to load activity: {error.message}
        </p>
      )}

      {events && events.length === 0 && (
        <EmptyState
          icon={Rss}
          title="No activity yet."
          description="Once Bookr starts scanning your watches, every slot found, notification, and booking attempt will show up here."
        />
      )}

      {events && events.length > 0 && (
        <div className="activity-feed space-y-4">
          {events.map((event, index) => (
            <ActivityRow
              key={event.id ?? `${event.at}-${event.type}`}
              event={event}
              isLast={index === events.length - 1}
            />
          ))}
        </div>
      )}
    </section>
  );
}
