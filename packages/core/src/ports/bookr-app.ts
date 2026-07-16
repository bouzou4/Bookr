import type {
  ActivityEvent,
  AvailabilityCheckInput,
  BookResult,
  CredentialStatus,
  HealthReport,
  ProviderName,
  ScanReport,
  Screening,
  SeatMapView,
  SeatPrefEntry,
  Slot,
  VenueMatch,
  Watch,
  WatchInput,
  WatchUpdate,
} from "@bookr/shared";
import type { ActivityQuery } from "./repository.ts";

/** Watch management operations. */
export interface WatchApi {
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
   * Create a watch from validated input.
   *
   * @param input - The new watch's fields.
   * @returns The created watch.
   */
  create(input: WatchInput): Watch;
  /**
   * Apply a partial update to a watch.
   *
   * @param id - Watch id.
   * @param patch - Fields to change.
   * @returns The updated watch.
   */
  update(id: string, patch: WatchUpdate): Watch;
  /**
   * Delete a watch.
   *
   * @param id - Watch id.
   */
  remove(id: string): void;
  /**
   * Enable or disable a watch.
   *
   * @param id - Watch id.
   * @param enabled - Whether the scheduler should include it.
   * @returns The updated watch.
   */
  setEnabled(id: string, enabled: boolean): Watch;
}

/**
 * The single application surface every entry point (CLI, MCP, REST) calls. It holds no
 * transport concerns; adapters translate their protocol to and from these methods.
 */
export interface BookrApp {
  /** Watch management. */
  watches: WatchApi;

  /** Ad-hoc availability lookups. */
  availability: {
    /**
     * Check availability once, without creating a watch.
     *
     * @param query - Provider, venue, date, party size, and optional window.
     * @returns Matching openings.
     */
    check(query: AvailabilityCheckInput): Promise<Slot[]>;
  };

  /** Venue lookup. */
  venues: {
    /**
     * Resolve free text (name, slug, or URL) to candidate venues.
     *
     * @param query - The search string.
     * @param provider - The provider to search.
     * @returns Candidate matches.
     */
    resolve(query: string, provider: ProviderName): Promise<VenueMatch[]>;
  };

  /** Scanning. */
  scan: {
    /**
     * Run a single scan pass.
     *
     * @param watchId - If given, scan only that watch; otherwise all enabled watches.
     * @returns A summary of the pass.
     */
    runOnce(watchId?: string): Promise<ScanReport>;
  };

  /** Booking. */
  booking: {
    /**
     * Attempt to book a previously-seen slot within a watch.
     *
     * @param watchId - The watch the slot belongs to.
     * @param dedupeKey - The slot's dedupe key.
     * @returns The booking outcome.
     */
    book(watchId: string, dedupeKey: string): Promise<BookResult>;
  };

  /** Seat maps and per-theater acceptable-seat preferences (assigned-seating providers). */
  seating: {
    /**
     * List what a venue is showing on a date (movies + showtimes, no seat maps) for the picker.
     *
     * @param provider - The provider (must expose a browsable schedule).
     * @param venueId - Provider venue id.
     * @param date - Venue-local `YYYY-MM-DD`.
     * @returns The screenings that day.
     */
    screenings(provider: ProviderName, venueId: string, date: string): Promise<Screening[]>;
    /**
     * Fetch a seat map for the picker UI.
     *
     * @param provider - The provider (must expose seat maps).
     * @param ref - The provider's item reference (e.g. an AMC showtime id).
     * @returns The layout, its geometry signature, and an occupancy digest.
     */
    map(provider: ProviderName, ref: string): Promise<SeatMapView>;
    /**
     * Fetch the cached acceptable-seat set for an auditorium.
     *
     * @param provider - The provider.
     * @param venueId - Provider venue id.
     * @param layoutKey - Layout-geometry signature.
     * @returns The entry, or undefined.
     */
    getPrefs(provider: ProviderName, venueId: string, layoutKey: string): SeatPrefEntry | undefined;
    /**
     * Store an acceptable-seat set for an auditorium.
     *
     * @param provider - The provider.
     * @param venueId - Provider venue id.
     * @param layoutKey - Layout-geometry signature.
     * @param seats - Acceptable seat names.
     * @returns The stored entry.
     */
    putPrefs(provider: ProviderName, venueId: string, layoutKey: string, seats: string[]): SeatPrefEntry;
  };

  /** Credential and session management. */
  credentials: {
    /**
     * Report per-provider session status.
     *
     * @returns One status per configured provider.
     */
    status(): Promise<CredentialStatus[]>;
    /**
     * Accept a session handed over out-of-band (e.g. after an interactive login).
     *
     * @param provider - The provider the session is for.
     * @param blob - The opaque session payload.
     */
    ingestSession(provider: ProviderName, blob: unknown): Promise<void>;
  };

  /** Activity log. */
  activity: {
    /**
     * Fetch recent activity, newest first.
     *
     * @param query - Optional filters.
     * @returns Matching events.
     */
    recent(query?: ActivityQuery): ActivityEvent[];
  };

  /** Health. */
  health: {
    /**
     * Report overall service health.
     *
     * @returns The current health snapshot.
     */
    status(): HealthReport;
  };

  /** Scheduler lifecycle for whichever host runs the poller. */
  scheduler: {
    /** Start the polling loop. */
    start(): void;
    /** Stop the polling loop. */
    stop(): void;
    /** Whether the loop is currently running. */
    running(): boolean;
  };
}
