import type {
  BookResult,
  ErrorClass,
  ProviderCapabilities,
  ProviderCredentials,
  ProviderName,
  Screening,
  SeatMap,
  Session,
  Slot,
  VenueMatch,
  Watch,
} from "@bookr/shared";

/**
 * A booking provider (Resy, SoHo House, OpenTable, …). Implementations translate a single
 * provider's API into the shared domain vocabulary. `capabilities` lets callers gate behaviour
 * without special-casing individual providers.
 */
export interface BookingProvider {
  /** The provider this implementation serves. */
  readonly name: ProviderName;
  /** What this provider supports. */
  readonly capabilities: ProviderCapabilities;

  /**
   * Establish an authenticated session. For some providers this resumes from a stored refresh
   * token rather than performing a fresh login.
   *
   * @param creds - Provider credentials.
   * @returns A new session.
   */
  authenticate(creds: ProviderCredentials): Promise<Session>;

  /**
   * Renew a session before or after its access credential expires.
   *
   * @param session - The current session.
   * @param creds - Provider credentials, in case a full re-auth is required.
   * @returns A refreshed session.
   */
  refresh(session: Session, creds: ProviderCredentials): Promise<Session>;

  /**
   * Find current availability for a watch.
   *
   * @param watch - The watch describing venue, date range, party size, and window.
   * @param session - An active session.
   * @returns Matching openings.
   */
  find(watch: Watch, session: Session): Promise<Slot[]>;

  /**
   * Attempt to book a slot.
   *
   * @param slot - The slot to book (carries the provider's booking handle).
   * @param session - An active session.
   * @returns The booking outcome.
   * @throws {@link NotSupportedError} If the provider cannot book programmatically.
   */
  book(slot: Slot, session: Session): Promise<BookResult>;

  /**
   * Cancel a previously made booking.
   *
   * @param cancelRef - The provider's cancellation handle for the booking (see {@link BookResult}).
   * @param session - An active session.
   * @throws {@link NotSupportedError} If the provider cannot cancel programmatically.
   */
  cancel(cancelRef: string, session: Session): Promise<void>;

  /**
   * Build a user-facing deep link to complete or view a booking.
   *
   * @param watch - The watch context.
   * @param slot - An optional specific slot to link to.
   * @returns An absolute URL.
   */
  bookingUrl(watch: Watch, slot?: Slot): string;

  /**
   * Search for venues matching free text (name, slug, or URL).
   *
   * @param query - The search string.
   * @returns Candidate venue matches.
   */
  resolveVenue(query: string): Promise<VenueMatch[]>;

  /**
   * Map a raw provider error onto a normalised category.
   *
   * @param err - The thrown value.
   * @returns The normalised error class.
   */
  classifyError(err: unknown): ErrorClass;

  /**
   * Fetch the full seating layout for one bookable item, for providers with assigned seating.
   * Optional — callers presence-check it; providers without seat maps simply omit it.
   *
   * @param ref - The provider's reference for the item (e.g. an AMC showtime id).
   * @param session - An active session.
   * @returns The seat map.
   */
  seatMap?(ref: string, session: Session): Promise<SeatMap>;

  /**
   * List what a venue is showing on a date, without seat maps — the cheap catalog read that backs
   * a movie/showtime picker. Optional; only providers with a browsable schedule implement it.
   *
   * @param venueId - Provider venue id.
   * @param date - Venue-local `YYYY-MM-DD`.
   * @param session - An active session.
   * @returns The screenings playing that day.
   */
  listScreenings?(venueId: string, date: string, session: Session): Promise<Screening[]>;
}
