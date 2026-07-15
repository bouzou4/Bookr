import { NotSupportedError } from "@bookr/core";
import type { BookingProvider } from "@bookr/core";
import type {
  BookResult,
  ProviderCapabilities,
  ProviderCredentials,
  ProviderName,
  Session,
  Slot,
  VenueMatch,
  Watch,
} from "@bookr/shared";

/** Scriptable behaviour for a {@link FakeProvider}. */
export interface FakeProviderOptions {
  /** Provider identity. Defaults to `"resy"`. */
  name?: ProviderName;
  /** Capability flags. Defaults to fully capable. */
  capabilities?: Partial<ProviderCapabilities>;
  /** Slots returned by every {@link FakeProvider.find} call. */
  slots?: Slot[];
  /** Result returned by {@link FakeProvider.book}. Defaults to a `failed` result. */
  bookResult?: BookResult;
  /** Matches returned by {@link FakeProvider.resolveVenue}. */
  venues?: VenueMatch[];
  /** Error thrown by {@link FakeProvider.cancel}, if configured. Ignored when autobook is disabled. */
  cancelError?: Error;
}

/**
 * An in-memory {@link BookingProvider} for tests. It returns scripted data and counts calls,
 * so services and facades can be exercised without touching a real provider API.
 */
export class FakeProvider implements BookingProvider {
  /** Provider identity. */
  readonly name: ProviderName;
  /** Declared capabilities. */
  readonly capabilities: ProviderCapabilities;
  /** Per-method invocation counts. */
  readonly calls = { authenticate: 0, refresh: 0, find: 0, book: 0, cancel: 0, resolveVenue: 0 };
  /** The `cancelRef` passed to the most recent {@link FakeProvider.cancel} call. */
  lastCancelRef: string | undefined;

  private readonly options: FakeProviderOptions;

  /**
   * @param options - Scripted behaviour.
   */
  constructor(options: FakeProviderOptions = {}) {
    this.options = options;
    this.name = options.name ?? "resy";
    this.capabilities = {
      headlessAuth: options.capabilities?.headlessAuth ?? true,
      autobook: options.capabilities?.autobook ?? true,
      twoPhaseBook: options.capabilities?.twoPhaseBook ?? false,
    };
  }

  private session(): Session {
    return {
      provider: this.name,
      state: "active",
      data: { token: "fake-token" },
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * @param _creds - Ignored.
   * @returns An active fake session.
   */
  async authenticate(_creds: ProviderCredentials): Promise<Session> {
    this.calls.authenticate += 1;
    return this.session();
  }

  /**
   * @param _session - Ignored.
   * @param _creds - Ignored.
   * @returns A refreshed active session.
   */
  async refresh(_session: Session, _creds: ProviderCredentials): Promise<Session> {
    this.calls.refresh += 1;
    return this.session();
  }

  /**
   * @param _watch - Ignored.
   * @param _session - Ignored.
   * @returns The scripted slots.
   */
  async find(_watch: Watch, _session: Session): Promise<Slot[]> {
    this.calls.find += 1;
    return this.options.slots ?? [];
  }

  /**
   * @param slot - The slot to book.
   * @param _session - Ignored.
   * @returns The scripted booking result.
   * @throws {@link NotSupportedError} If the fake is configured without autobook.
   */
  async book(slot: Slot, _session: Session): Promise<BookResult> {
    this.calls.book += 1;
    if (!this.capabilities.autobook) {
      throw new NotSupportedError(`${this.name} cannot auto-book`);
    }
    return (
      this.options.bookResult ?? {
        status: "failed",
        deepLink: this.bookingUrlForSlot(slot),
        detail: "fake: no bookResult configured",
      }
    );
  }

  /**
   * @param cancelRef - The cancellation handle to record.
   * @param _session - Ignored.
   * @throws {@link NotSupportedError} If the fake is configured without autobook.
   * @throws The configured `cancelError`, if one was set.
   */
  async cancel(cancelRef: string, _session: Session): Promise<void> {
    this.calls.cancel += 1;
    if (!this.capabilities.autobook) {
      throw new NotSupportedError(`${this.name} cannot cancel bookings`);
    }
    this.lastCancelRef = cancelRef;
    if (this.options.cancelError) throw this.options.cancelError;
  }

  private bookingUrlForSlot(slot: Slot): string {
    return `https://example.test/${this.name}/${slot.venueId}?date=${slot.date}`;
  }

  /**
   * @param watch - The watch context.
   * @param slot - An optional slot.
   * @returns A deterministic fake deep link.
   */
  bookingUrl(watch: Watch, slot?: Slot): string {
    return `https://example.test/${this.name}/${watch.venue.id}${slot ? `?t=${slot.start}` : ""}`;
  }

  /**
   * @param _query - Ignored.
   * @returns The scripted venue matches.
   */
  async resolveVenue(_query: string): Promise<VenueMatch[]> {
    this.calls.resolveVenue += 1;
    return this.options.venues ?? [];
  }

  /**
   * @param _err - Ignored.
   * @returns Always `"other"`.
   */
  classifyError(_err: unknown): "other" {
    return "other";
  }
}
