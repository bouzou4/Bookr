import type {
  ActivityEvent,
  ActivityType,
  DropEvent,
  DropStats,
  ProviderName,
  SeenEntry,
  Session,
  Watch,
} from "@bookr/shared";

/** Persistence for watches. */
export interface WatchRepository {
  /** All watches. */
  list(): Watch[];
  /**
   * Fetch one watch.
   *
   * @param id - Watch id.
   * @returns The watch, or undefined.
   */
  get(id: string): Watch | undefined;
  /**
   * Insert a watch.
   *
   * @param watch - The fully-formed watch to store.
   * @returns The stored watch.
   */
  create(watch: Watch): Watch;
  /**
   * Replace a watch.
   *
   * @param watch - The updated watch.
   * @returns The stored watch.
   */
  update(watch: Watch): Watch;
  /**
   * Delete a watch.
   *
   * @param id - Watch id.
   */
  remove(id: string): void;
}

/** Persistence for provider sessions. */
export interface SessionRepository {
  /**
   * Fetch the current session for a provider.
   *
   * @param provider - The provider.
   * @returns The session, or undefined.
   */
  get(provider: ProviderName): Session | undefined;
  /**
   * Store (upsert) a provider session.
   *
   * @param session - The session to persist.
   */
  put(session: Session): void;
}

/** Persistence for dedupe bookkeeping. */
export interface SeenRepository {
  /**
   * Fetch a seen entry by dedupe key.
   *
   * @param key - The slot dedupe key.
   * @returns The entry, or undefined.
   */
  get(key: string): SeenEntry | undefined;
  /**
   * Insert or update a seen entry.
   *
   * @param entry - The entry to store.
   */
  upsert(entry: SeenEntry): void;
  /**
   * Drop entries past their reservation date or older than the retention window.
   *
   * @param now - Current ISO timestamp used as the sweep reference.
   */
  sweep(now: string): void;
  /**
   * Mark every still-present entry not observed since a cutoff as disappeared, so a later
   * reappearance re-alerts. An entry counts as observed when its `lastSeenAt` is at or after the
   * cutoff; this is durable across restarts because it reads persisted timestamps rather than an
   * in-memory record of the previous pass.
   *
   * @param seenBefore - ISO cutoff (a pass's start time); entries last seen strictly before it,
   *   and not already disappeared, are marked.
   * @param disappearedAt - ISO time to stamp on the newly-absent entries.
   */
  markAbsent(seenBefore: string, disappearedAt: string): void;
}

/** Query options for the activity log. */
export interface ActivityQuery {
  /** Maximum rows to return (newest first). */
  limit?: number;
  /** Restrict to a single event type. */
  type?: ActivityType;
}

/** Persistence for the activity/audit log. */
export interface ActivityRepository {
  /**
   * Append an activity event.
   *
   * @param event - The event to record.
   */
  record(event: ActivityEvent): void;
  /**
   * Fetch recent activity, newest first.
   *
   * @param query - Optional filters.
   * @returns Matching events.
   */
  recent(query?: ActivityQuery): ActivityEvent[];
  /**
   * Delete activity older than a cutoff.
   *
   * @param olderThanDays - Age threshold in days.
   */
  prune(olderThanDays: number): void;
}

/** Persistence for the drop-timing logger. */
export interface DropRepository {
  /**
   * Record an observed slot-appearance event.
   *
   * @param event - The drop event.
   */
  record(event: DropEvent): void;
  /**
   * Aggregate drop statistics for a venue.
   *
   * @param venueId - Provider venue id.
   * @returns The aggregated stats.
   */
  stats(venueId: string): DropStats;
}

/** The full persistence surface the core depends on. Adapters expose only these methods. */
export interface Repository {
  /** Watch persistence. */
  watches: WatchRepository;
  /** Session persistence. */
  sessions: SessionRepository;
  /** Dedupe persistence. */
  seen: SeenRepository;
  /** Activity-log persistence. */
  activity: ActivityRepository;
  /** Drop-log persistence. */
  droplog: DropRepository;
}
