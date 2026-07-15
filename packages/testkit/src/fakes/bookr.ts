import type { BookrApp } from "@bookr/core";
import type {
  ActivityEvent,
  BookResult,
  CredentialStatus,
  ScanReport,
  Slot,
  VenueMatch,
  Watch,
  WatchInput,
  WatchUpdate,
} from "@bookr/shared";

/** Seed data that scripts a {@link createFakeBookr} instance. */
export interface FakeBookrSeed {
  /** Watches to pre-load. */
  watches?: Watch[];
  /** Slots returned by availability checks and treated as scan matches. */
  slots?: Slot[];
  /** Venue matches returned by resolve. */
  venues?: VenueMatch[];
  /** Result returned by booking. Defaults to a `failed` result. */
  bookResult?: BookResult;
  /** Per-provider credential status. */
  credentialStatus?: CredentialStatus[];
}

/**
 * Build an in-memory {@link BookrApp} for tests and for developing entry points (CLI, MCP,
 * REST) before the real core exists. Watch CRUD mutates local state; the read/scan/book
 * operations return the seeded data.
 *
 * @param seed - Optional scripted data.
 * @returns A fully-implemented, in-memory application surface.
 */
export function createFakeBookr(seed: FakeBookrSeed = {}): BookrApp {
  const watches = new Map<string, Watch>();
  for (const w of seed.watches ?? []) watches.set(w.id, w);
  const activity: ActivityEvent[] = [];
  let idCounter = 0;
  let schedulerRunning = false;
  let lastPassAt: string | undefined;

  const nextId = (): string => `fake-${(idCounter += 1)}`;
  const now = (): string => new Date().toISOString();

  const requireWatch = (id: string): Watch => {
    const w = watches.get(id);
    if (!w) throw new Error(`watch not found: ${id}`);
    return w;
  };

  return {
    watches: {
      list: () => [...watches.values()],
      get: (id) => watches.get(id),
      create: (input: WatchInput) => {
        const ts = now();
        const watch: Watch = { id: nextId(), ...input, createdAt: ts, updatedAt: ts };
        watches.set(watch.id, watch);
        return watch;
      },
      update: (id: string, patch: WatchUpdate) => {
        const watch: Watch = { ...requireWatch(id), ...patch, id, updatedAt: now() };
        watches.set(id, watch);
        return watch;
      },
      remove: (id: string) => {
        watches.delete(id);
      },
      setEnabled: (id: string, enabled: boolean) => {
        const watch: Watch = { ...requireWatch(id), enabled, updatedAt: now() };
        watches.set(id, watch);
        return watch;
      },
    },
    availability: {
      check: async (): Promise<Slot[]> => seed.slots ?? [],
    },
    venues: {
      resolve: async (): Promise<VenueMatch[]> => seed.venues ?? [],
    },
    scan: {
      runOnce: async (watchId?: string): Promise<ScanReport> => {
        const scanned = watchId ? (watches.has(watchId) ? 1 : 0) : watches.size;
        const found = (seed.slots ?? []).length;
        lastPassAt = now();
        activity.push({ at: lastPassAt, type: "pass-complete", detail: `${scanned} watches` });
        return {
          startedAt: lastPassAt,
          finishedAt: lastPassAt,
          watchesScanned: scanned,
          newSlots: found,
          notified: found,
          booked: 0,
          errors: [],
        };
      },
    },
    booking: {
      book: async (): Promise<BookResult> =>
        seed.bookResult ?? { status: "failed", deepLink: "https://example.test", detail: "fake" },
    },
    credentials: {
      status: async (): Promise<CredentialStatus[]> => seed.credentialStatus ?? [],
      ingestSession: async (provider) => {
        activity.push({ at: now(), type: "auth-challenged", provider, detail: "session ingested" });
      },
    },
    activity: {
      recent: (query) => {
        const items = [...activity].reverse();
        const filtered = query?.type ? items.filter((e) => e.type === query.type) : items;
        return query?.limit ? filtered.slice(0, query.limit) : filtered;
      },
    },
    health: {
      status: () => ({
        ok: true,
        lastPassAt,
        schedulerRunning,
        providers: seed.credentialStatus ?? [],
      }),
    },
    scheduler: {
      start: () => {
        schedulerRunning = true;
      },
      stop: () => {
        schedulerRunning = false;
      },
      running: () => schedulerRunning,
    },
  };
}
