/**
 * Shared domain vocabulary for Bookr: the types every other package uses to describe watches,
 * availability slots, authentication sessions, and booking results.
 *
 * @packageDocumentation
 */

/** Supported booking providers. */
export type ProviderName = "resy" | "sohohouse" | "opentable" | "amc";

/** Category of bookable inventory a watch targets. Defaults to `"table"`. */
export type ResourceType = "table" | "bedroom" | "screening" | "event";

/**
 * Normalised failure categories every provider maps its raw errors onto, so callers never
 * string-match provider-specific messages. `schema-drift` covers a provider's API contract
 * changing underneath the client (e.g. rotating query identifiers) — an operational problem
 * to re-capture, distinct from an auth or rate-limit failure.
 */
export type ErrorClass =
  | "auth-expired"
  | "challenged"
  | "rate-limited"
  | "not-found"
  | "schema-drift"
  | "other";

/** Alert severity. The Notifier adapter maps each level to concrete channels. */
export type Severity = "urgent" | "warning" | "info";

/** Declares what a provider supports, so the core can gate behaviour without provider `if`s. */
export interface ProviderCapabilities {
  /** True if the server can authenticate headlessly (no interactive browser/reCAPTCHA). */
  headlessAuth: boolean;
  /** True if the provider can complete a booking programmatically. */
  autobook: boolean;
  /**
   * Advisory: true if booking is a lock-then-confirm two-phase flow (a `locked-unconfirmed`
   * result is possible). Informational — it shapes how callers present a partial booking rather
   * than gating a code path.
   */
  twoPhaseBook: boolean;
}

/** A fixed ISO date range, or a window that rolls forward from venue-local today. */
export type DateRange = { start: string; end: string } | { rollingDays: number };

/** Horizontal section of a seated venue, thirds by column span. */
export type SeatZone = "left" | "center" | "right";

/** Distance-from-screen/stage section of a seated venue, thirds by row index. */
export type SeatDepth = "front" | "middle" | "back";

/**
 * Per-watch seat preferences for providers with assigned seating. A slot only alerts when a
 * contiguous block of at least the watch's party size falls within every listed preference;
 * an omitted field means "anywhere". Providers without seat maps ignore this entirely.
 */
export interface SeatingPreference {
  /**
   * Explicit acceptable seat names drawn in the seat-map picker (e.g. `["F5","F6","F7"]`).
   * When present this wins over zones/depths. Per-theater sets are also cached against the
   * auditorium's layout signature so future watches at the same theater inherit them.
   */
  seats?: string[];
  /** Acceptable horizontal zones (e.g. `["center"]` to skip far-side blocks). */
  zones?: SeatZone[];
  /** Acceptable depths (e.g. `["middle", "back"]` to skip the front rows). */
  depths?: SeatDepth[];
}

/** A single reservation watch: what to look for and how to act on a match. */
export interface Watch {
  /** Stable unique id. */
  id: string;
  /** Which provider this watch targets. */
  provider: ProviderName;
  /** Human-friendly label for dashboards/alerts. */
  label: string;
  /** Provider venue identity. `id` is required; `slug` aids resolution/deep links. */
  venue: { id: string; slug?: string };
  /** Inventory category. */
  resourceType: ResourceType;
  /**
   * The specific item within the venue to watch, for venues that host many distinct bookables
   * (e.g. a cinema screening many films). `query` is a case-insensitive title match; `id` pins a
   * provider item id when known. Omitted → the whole venue.
   */
  item?: { id?: string; query?: string };
  /**
   * Acceptable inventory tiers, matched case-insensitively against {@link Slot.kind}. The tier
   * concept is provider-agnostic: Resy seating types ("Bar Counter", "Outdoor") and AMC formats
   * ("IMAX", "Dolby Cinema", "70mm") are the same axis. Omitted → any tier.
   */
  tiers?: string[];
  /** Seat-location preferences for assigned-seating providers. Omitted → any seats. */
  seating?: SeatingPreference;
  /** Number of guests. */
  partySize: number;
  /** Target date range (fixed or rolling). */
  dateRange: DateRange;
  /** Acceptable seating window in venue-local `"HH:MM"`. */
  timeWindow: { start: string; end: string };
  /** IANA timezone of the venue; REQUIRED so time comparisons never guess UTC. */
  timezone: string;
  /** When true, attempt to auto-book a match (capability-gated). */
  autobook: boolean;
  /** When false, the scheduler skips this watch. */
  enabled: boolean;
  /** ISO creation timestamp. */
  createdAt: string;
  /** ISO last-update timestamp. */
  updatedAt: string;
}

/** Occupancy state of a single assigned seat. */
export type SeatStatus = "available" | "taken" | "unavailable";

/** One assigned seat in a {@link SeatMap}. */
export interface Seat {
  /** Provider seat id (the handle a booking flow would submit). */
  id: string;
  /** Row label as the venue prints it (e.g. `"G"`). */
  row: string;
  /** Zero-based column index within the row, gaps included. */
  column: number;
  /** Occupancy state. `unavailable` covers non-sellable positions (companion, broken, blocked). */
  status: SeatStatus;
  /** Provider seat type (e.g. AMC `"LoveSeatLeft"`, `"WheelchairAccessible"`), when known. */
  type?: string;
}

/** A full seating layout for one screening/performance, as fetched from the provider. */
export interface SeatMap {
  /** Row labels in front-to-back order; index = distance from the screen/stage. */
  rows: string[];
  /** Column count of the widest row, gaps included. */
  columns: number;
  /** Every physical seat. Positions absent from this list are aisles/voids. */
  seats: Seat[];
}

/** A contiguous run of available seats within one row. */
export interface SeatBlock {
  /** Row label. */
  row: string;
  /** Seat ids in the block, left to right. */
  seatIds: string[];
  /** Number of seats in the block. */
  size: number;
  /** Horizontal zone of the block's midpoint. */
  position: SeatZone;
  /** Depth of the block's row. */
  depth: SeatDepth;
}

/**
 * A compact, alert-ready digest of a {@link SeatMap}: overall occupancy plus the open blocks,
 * best-first (center beats sides, back/middle beats front, larger beats smaller). Providers attach
 * it to a {@link Slot} so notifications can say *where* the open seats are, not just that some exist.
 */
export interface SeatingSummary {
  /** Total sellable seats. */
  totalSeats: number;
  /** Currently available seats. */
  availableSeats: number;
  /** Percentage of sellable seats taken, 0–100 rounded. */
  percentTaken: number;
  /** Contiguous available blocks, best-first. */
  blocks: SeatBlock[];
}

/** A concrete availability opening returned by a provider's `find`. */
export interface Slot {
  /** Provider that produced this slot. */
  provider: ProviderName;
  /** Provider venue id. */
  venueId: string;
  /** Reservation date, ISO `YYYY-MM-DD`, venue-local. */
  date: string;
  /** Reservation start, `"HH:MM:SS"`, venue-local. */
  start: string;
  /** Inventory category of this slot. */
  resourceType: ResourceType;
  /** Provider-specific seating type, e.g. Resy `config.type` (`"Bar Counter"`). */
  kind?: string;
  /** True for exclusive/premium inventory (e.g. Resy Global Dining Access). */
  exclusive?: boolean;
  /** Seat-map digest for assigned-seating providers; drives seat-location context in alerts. */
  seating?: SeatingSummary;
  /**
   * Full seating layout, emitted by assigned-seating providers alongside the digest. The scan
   * engine — not the adapter — applies the acceptable-seat gate, because resolving cached
   * per-theater preferences requires repository access adapters don't have. Never persisted.
   */
  seatMap?: SeatMap;
  /** Stable key identifying this opening across passes; used to suppress duplicate alerts. */
  dedupeKey: string;
  /** Opaque handle the same provider uses to book this slot. */
  bookRef?: unknown;
  /** Full raw provider payload, retained so provider fields not surfaced above stay accessible. */
  raw?: unknown;
}

/**
 * A seat map prepared for the picker UI: the layout itself, its geometry signature (the
 * per-theater preference cache key), and the occupancy digest.
 */
export interface SeatMapView {
  /** The full layout. */
  map: SeatMap;
  /** Layout-geometry signature identifying the auditorium. */
  signature: string;
  /** Occupancy digest (unmasked). */
  summary: SeatingSummary;
}

/** Lifecycle state of a provider authentication session. */
export type SessionState = "active" | "challenged" | "expired" | "missing";

/** An opaque, provider-defined authenticated session, persisted between passes. */
export interface Session {
  /** Owning provider. */
  provider: ProviderName;
  /** Current lifecycle state. */
  state: SessionState;
  /** Opaque provider blob (e.g. Resy token + refresh cookie; SoHo House OAuth token set). */
  data: unknown;
  /** ISO expiry of the primary credential, when known. */
  expiresAt?: string;
  /** ISO last-update timestamp. */
  updatedAt: string;
}

/** Credentials handed to a provider to authenticate. Provider-defined shape. */
export interface ProviderCredentials {
  /** Account username/email, when applicable. */
  username?: string;
  /** Account password, when applicable. */
  password?: string;
  /** Public/app API key, when applicable (e.g. Resy web api_key — not a user secret). */
  apiKey?: string;
  /** Additional provider-specific fields. */
  [key: string]: unknown;
}

/** Outcome of a booking attempt. `locked-unconfirmed` models a two-phase partial success. */
export type BookResult =
  | {
      status: "booked";
      confirmationId: string;
      deepLink: string;
      /** Opaque handle for cancelling this booking, when the provider issues one distinct from `confirmationId`. */
      cancelRef?: string;
    }
  | { status: "locked-unconfirmed"; deepLink: string; detail: string }
  | { status: "challenged"; deepLink: string; detail: string }
  | { status: "failed"; deepLink: string; detail: string };

/**
 * A cached acceptable-seat set for one auditorium, keyed by provider + venue + layout-geometry
 * signature. Drawn once in the seat-map picker, then auto-applied to any watch at the same
 * theater whose showtime resolves to the same layout.
 */
export interface SeatPrefEntry {
  /** Owning provider. */
  provider: ProviderName;
  /** Provider venue id. */
  venueId: string;
  /** Layout-geometry signature identifying the auditorium (see the core seating engine). */
  layoutKey: string;
  /** Acceptable seat names. */
  seats: string[];
  /** ISO last-update timestamp. */
  updatedAt: string;
}

/** Dedupe bookkeeping for a previously-seen slot. */
export interface SeenEntry {
  /** The slot's dedupe key. */
  key: string;
  /** ISO time the key was first observed. */
  firstSeenAt: string;
  /** ISO time the key was last observed present. */
  lastSeenAt: string;
  /** ISO time an alert last fired for this key, if any. */
  notifiedAt?: string;
  /** ISO time the key went absent (set → re-alert on reappearance). */
  disappearedAt?: string;
}

/** Categories of events recorded to the activity/audit log. */
export type ActivityType =
  | "slot-found"
  | "notified"
  | "booked"
  | "cancelled"
  | "book-failed"
  | "auth-challenged"
  | "session-ingested"
  | "notify-failed"
  | "error"
  | "pass-complete";

/** A recorded activity/audit event. */
export interface ActivityEvent {
  /** Auto-assigned row id (absent before persistence). */
  id?: number;
  /** ISO event time. */
  at: string;
  /** Event category. */
  type: ActivityType;
  /** Related provider, when applicable. */
  provider?: ProviderName;
  /** Related watch, when applicable. */
  watchId?: string;
  /** Human-readable detail. */
  detail?: string;
  /** Structured payload (never secrets). */
  data?: unknown;
}

/** A single observed slot-appearance event for the drop-timing logger. */
export interface DropEvent {
  /** Provider venue id. */
  venueId: string;
  /** Owning provider. */
  provider: ProviderName;
  /** ISO time the slot was observed appearing. */
  observedAt: string;
  /** Reservation date the slot is for (ISO). */
  reservationDate: string;
  /** Reservation start time (`"HH:MM:SS"`). */
  reservationTime: string;
  /** Hours between observation and reservation. */
  hoursUntilReservation: number;
  /** Day-of-week (0–6) of the reservation date. */
  reservationDow: number;
  /** Day-of-week (0–6) of the observation. */
  observedDow: number;
  /** Party size of the watch. */
  partySize: number;
  /** True if within the venue's known initial-release window. */
  wasInitialRelease: boolean;
}

/** Aggregate drop statistics for a venue, keyed by hours-until-reservation bucket. */
export interface DropStats {
  /** Provider venue id. */
  venueId: string;
  /** Number of observations aggregated. */
  sampleCount: number;
  /** Observation counts per hours-until bucket label. */
  byHoursUntilBucket: Record<string, number>;
}

/**
 * A single screening/performance a venue is showing on a date, without the seat map — the cheap
 * catalog record that drives a movie/showtime picker before any seat layout is fetched.
 */
export interface Screening {
  /** Provider that produced the screening. */
  provider: ProviderName;
  /** Provider reference for the screening (seat-map + deep-link handle; e.g. an AMC showtime id). */
  ref: string;
  /** The film's provider slug/id (what a watch stores as `item.id`). */
  filmId: string;
  /** Display title. */
  title: string;
  /** Presentation format label (e.g. `"IMAX 70mm"`, `"Dolby Cinema"`), when known. */
  format?: string;
  /** Start instant, ISO UTC. */
  startUtc: string;
  /** Provider sellability status (e.g. `"Sellable"`, `"AlmostFull"`, `"Soldout"`). */
  status: string;
}

/** A candidate venue match from a provider search. */
export interface VenueMatch {
  /** Provider that produced the match. */
  provider: ProviderName;
  /** Provider venue id. */
  id: string;
  /** URL slug, when available. */
  slug?: string;
  /** Display name. */
  name: string;
  /** City/locality, when available. */
  city?: string;
}

/** Summary of a single scan pass. */
export interface ScanReport {
  /** ISO start. */
  startedAt: string;
  /** ISO finish. */
  finishedAt: string;
  /** How many watches were scanned. */
  watchesScanned: number;
  /** Count of newly-seen slots this pass. */
  newSlots: number;
  /** Count of alerts fired. */
  notified: number;
  /** Count of successful auto-books. */
  booked: number;
  /** Per-watch errors encountered. */
  errors: { watchId: string; class: ErrorClass; detail: string }[];
}

/** Per-provider credential/session status for the dashboard. */
export interface CredentialStatus {
  /** Provider. */
  provider: ProviderName;
  /** Current session state. */
  sessionState: SessionState;
  /** ISO expiry, when known. */
  expiresAt?: string;
  /** True if the operator must act (e.g. hand over a token). */
  needsAttention: boolean;
}

/** Overall service health. */
export interface HealthReport {
  /** True if the last pass succeeded and no provider needs attention. */
  ok: boolean;
  /** ISO time of the last completed pass. */
  lastPassAt?: string;
  /** Whether the scheduler loop is running. */
  schedulerRunning: boolean;
  /** Per-provider status. */
  providers: CredentialStatus[];
}
