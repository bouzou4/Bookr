import type {
  ActivityQuery,
  Clock,
  Repository,
} from "@bookr/core";
import type {
  ActivityEvent,
  DropEvent,
  DropStats,
  ProviderName,
  SeatPrefEntry,
  SeenEntry,
  Session,
  Watch,
} from "@bookr/shared";
import { dedupeKeyDate } from "@bookr/shared";

const BUCKETS = ["0-1", "1-6", "6-24", "24-30", "30-48", "48+"] as const;

function hoursBucket(hours: number): (typeof BUCKETS)[number] {
  if (hours < 1) return "0-1";
  if (hours < 6) return "1-6";
  if (hours < 24) return "6-24";
  if (hours < 30) return "24-30";
  if (hours < 48) return "30-48";
  return "48+";
}

const DAY_MS = 24 * 60 * 60 * 1000;
const SEEN_RETENTION_DAYS = 14;

/**
 * An in-memory {@link Repository} for tests: real dedupe/sweep/prune semantics without a
 * database. Time-relative behaviour (`prune`) reads from the injected {@link Clock}.
 */
export class FakeRepository implements Repository {
  private readonly watchMap = new Map<string, Watch>();
  private readonly sessionMap = new Map<ProviderName, Session>();
  private readonly seenMap = new Map<string, SeenEntry>();
  private activityLog: ActivityEvent[] = [];
  private readonly dropLog: DropEvent[] = [];
  private readonly seatPrefMap = new Map<string, SeatPrefEntry>();
  private activityId = 0;

  /**
   * @param clock - Time source for `activity.prune`. Defaults to the system clock.
   */
  constructor(private readonly clock: Clock = { now: () => new Date(), sleep: async () => {} }) {}

  /** Watch persistence. */
  readonly watches = {
    list: (): Watch[] => [...this.watchMap.values()],
    get: (id: string): Watch | undefined => this.watchMap.get(id),
    create: (watch: Watch): Watch => {
      this.watchMap.set(watch.id, watch);
      return watch;
    },
    update: (watch: Watch): Watch => {
      this.watchMap.set(watch.id, watch);
      return watch;
    },
    remove: (id: string): void => {
      this.watchMap.delete(id);
    },
  };

  /** Session persistence. */
  readonly sessions = {
    get: (provider: ProviderName): Session | undefined => this.sessionMap.get(provider),
    put: (session: Session): void => {
      this.sessionMap.set(session.provider, session);
    },
  };

  /** Dedupe persistence. */
  readonly seen = {
    get: (key: string): SeenEntry | undefined => this.seenMap.get(key),
    upsert: (entry: SeenEntry): void => {
      this.seenMap.set(entry.key, entry);
    },
    sweep: (now: string): void => {
      const nowDate = now.slice(0, 10);
      const nowMs = new Date(now).getTime();
      for (const [key, entry] of this.seenMap) {
        const pastReservation = dedupeKeyDate(key) < nowDate;
        const stale = nowMs - new Date(entry.lastSeenAt).getTime() > SEEN_RETENTION_DAYS * DAY_MS;
        if (pastReservation || stale) this.seenMap.delete(key);
      }
    },
    markAbsent: (seenBefore: string, disappearedAt: string): void => {
      for (const [key, entry] of this.seenMap) {
        if (entry.disappearedAt == null && entry.lastSeenAt < seenBefore) {
          this.seenMap.set(key, { ...entry, disappearedAt });
        }
      }
    },
  };

  /** Activity-log persistence. */
  readonly activity = {
    record: (event: ActivityEvent): void => {
      this.activityLog.push({ ...event, id: (this.activityId += 1) });
    },
    recent: (query?: ActivityQuery): ActivityEvent[] => {
      let rows = [...this.activityLog].reverse();
      if (query?.type) rows = rows.filter((e) => e.type === query.type);
      return query?.limit ? rows.slice(0, query.limit) : rows;
    },
    prune: (olderThanDays: number): void => {
      const cutoff = this.clock.now().getTime() - olderThanDays * DAY_MS;
      this.activityLog = this.activityLog.filter((e) => new Date(e.at).getTime() >= cutoff);
    },
  };

  /** Per-theater acceptable-seat preference persistence. */
  readonly seatPrefs = {
    get: (provider: ProviderName, venueId: string, layoutKey: string): SeatPrefEntry | undefined =>
      this.seatPrefMap.get(`${provider}:${venueId}:${layoutKey}`),
    put: (entry: SeatPrefEntry): void => {
      this.seatPrefMap.set(`${entry.provider}:${entry.venueId}:${entry.layoutKey}`, entry);
    },
  };

  /** Drop-log persistence. */
  readonly droplog = {
    record: (event: DropEvent): void => {
      this.dropLog.push(event);
    },
    stats: (venueId: string): DropStats => {
      const byHoursUntilBucket: Record<string, number> = Object.fromEntries(BUCKETS.map((b) => [b, 0]));
      let sampleCount = 0;
      for (const e of this.dropLog) {
        if (e.venueId !== venueId) continue;
        sampleCount += 1;
        const b = hoursBucket(e.hoursUntilReservation);
        byHoursUntilBucket[b] = (byHoursUntilBucket[b] ?? 0) + 1;
      }
      return { venueId, sampleCount, byHoursUntilBucket };
    },
  };
}
