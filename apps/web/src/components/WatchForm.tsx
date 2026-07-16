import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import {
  type ProviderName,
  type ResourceType,
  type Screening,
  type SeatMapView,
  type VenueMatch,
  type Watch,
  type WatchInput,
  watchInputSchema,
} from "@bookr/shared";
import { api } from "../api/client.ts";
import { SeatMapPicker } from "./SeatMapPicker.tsx";

const PROVIDERS: ProviderName[] = ["resy", "sohohouse", "opentable", "amc"];

/**
 * Inventory categories each provider actually offers, so the resource-type choices stay honest
 * (AMC only screens films; Resy/OpenTable only seat tables). The first entry is the default when
 * switching to that provider.
 */
const PROVIDER_RESOURCE_TYPES: Record<ProviderName, ResourceType[]> = {
  resy: ["table"],
  opentable: ["table"],
  sohohouse: ["table", "bedroom"],
  amc: ["screening"],
};

/** Editable form fields, kept as strings/booleans so every input can stay controlled. */
interface FormState {
  provider: ProviderName;
  label: string;
  venueId: string;
  venueSlug: string;
  /** Human-friendly name of the chosen venue, shown once one is picked (ids aren't guessable). */
  venueLabel: string;
  resourceType: ResourceType;
  /** Provider film id of the picked movie (stored as the watch's `item.id`). */
  filmId: string;
  /** Display title of the picked movie, for the summary line. */
  filmTitle: string;
  /** Date used to browse showtimes (default today); the watch's own date range is separate. */
  browseDate: string;
  selectedSeats: string[];
  partySize: string;
  dateMode: "fixed" | "rolling";
  rangeStart: string;
  rangeEnd: string;
  rollingDays: string;
  windowStart: string;
  windowEnd: string;
  timezone: string;
  autobook: boolean;
  enabled: boolean;
}

function fromWatch(watch: Watch | undefined): FormState {
  const isRolling = watch ? "rollingDays" in watch.dateRange : true;
  return {
    provider: watch?.provider ?? "resy",
    label: watch?.label ?? "",
    venueId: watch?.venue.id ?? "",
    venueSlug: watch?.venue.slug ?? "",
    venueLabel: watch?.venue.id ?? "",
    resourceType: watch?.resourceType ?? "table",
    filmId: watch?.item?.id ?? "",
    filmTitle: "",
    browseDate: new Date().toISOString().slice(0, 10),
    selectedSeats: watch?.seating?.seats ?? [],
    partySize: watch ? String(watch.partySize) : "2",
    dateMode: isRolling ? "rolling" : "fixed",
    rangeStart: watch && "start" in watch.dateRange ? watch.dateRange.start : "",
    rangeEnd: watch && "end" in watch.dateRange ? watch.dateRange.end : "",
    rollingDays: watch && "rollingDays" in watch.dateRange ? String(watch.dateRange.rollingDays) : "14",
    windowStart: watch?.timeWindow.start ?? "18:00",
    windowEnd: watch?.timeWindow.end ?? "21:00",
    timezone: watch?.timezone ?? "America/New_York",
    autobook: watch?.autobook ?? false,
    enabled: watch?.enabled ?? true,
  };
}

function toCandidate(state: FormState, initial?: Watch): unknown {
  return {
    provider: state.provider,
    label: state.label,
    venue: { id: state.venueId, slug: state.venueSlug || undefined },
    resourceType: state.resourceType,
    item: state.filmId ? { id: state.filmId } : initial?.item,
    tiers: initial?.tiers,
    // Picker seats win; otherwise keep whatever zone/depth preference the watch already had.
    seating: state.selectedSeats.length > 0 ? { seats: state.selectedSeats } : initial?.seating,
    partySize: Number(state.partySize),
    dateRange:
      state.dateMode === "rolling"
        ? { rollingDays: Number(state.rollingDays) }
        : { start: state.rangeStart, end: state.rangeEnd },
    timeWindow: { start: state.windowStart, end: state.windowEnd },
    timezone: state.timezone,
    autobook: state.autobook,
    enabled: state.enabled,
  };
}

/** Props for {@link WatchForm}. */
export interface WatchFormProps {
  /** When set, the form edits this watch; otherwise it creates a new one. */
  initial?: Watch;
  /** Called with validated input once the form passes zod validation and is submitted. */
  onSubmit: (input: WatchInput) => Promise<void>;
  /** Called when the user cancels out of the form. */
  onCancel: () => void;
}

/**
 * Create/edit form for a {@link Watch}, validated against the `@bookr/shared` zod schema before
 * submission so the server only ever sees well-formed input. Field errors are rendered next to
 * their inputs from the schema's own issue list.
 */
export function WatchForm({ initial, onSubmit, onCancel }: WatchFormProps): React.JSX.Element {
  const [state, setState] = useState<FormState>(() => fromWatch(initial));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [seatView, setSeatView] = useState<SeatMapView | null>(null);
  const [seatMapStatus, setSeatMapStatus] = useState<string | null>(null);
  const [venueQuery, setVenueQuery] = useState("");
  const [venueMatches, setVenueMatches] = useState<VenueMatch[] | null>(null);
  const [venueStatus, setVenueStatus] = useState<string | null>(null);
  const [screenings, setScreenings] = useState<Screening[] | null>(null);
  const [screeningsStatus, setScreeningsStatus] = useState<string | null>(null);
  const [activeShowtime, setActiveShowtime] = useState<string | null>(null);

  function set<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setState((s) => ({ ...s, [key]: value }));
  }

  /**
   * Switch provider, snapping the resource type to one the provider offers and clearing the venue
   * (an id from one provider is meaningless to another) plus any loaded seat map.
   */
  function changeProvider(provider: ProviderName): void {
    const allowed = PROVIDER_RESOURCE_TYPES[provider];
    setState((s) => ({
      ...s,
      provider,
      resourceType: allowed.includes(s.resourceType) ? s.resourceType : (allowed[0] as ResourceType),
      venueId: "",
      venueSlug: "",
      venueLabel: "",
      selectedSeats: [],
    }));
    setVenueMatches(null);
    setVenueStatus(null);
    setSeatView(null);
    setScreenings(null);
    setScreeningsStatus(null);
  }

  // When editing an existing screening watch, load its theatre's schedule up front so the movie
  // dropdown is populated without the user re-picking the venue.
  useEffect(() => {
    if (initial?.resourceType === "screening" && initial.venue.id) {
      void loadScreenings(initial.venue.id, state.browseDate);
    }
    // Run once on mount for the edited watch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Resolve the free-text venue query against the selected provider and show the matches. */
  async function searchVenues(): Promise<void> {
    if (!venueQuery.trim()) return;
    setVenueStatus("searching…");
    setVenueMatches(null);
    try {
      const matches = await api.venues.resolve(state.provider, venueQuery.trim());
      setVenueMatches(matches);
      setVenueStatus(matches.length === 0 ? "no matching venues" : null);
    } catch (err) {
      setVenueStatus(err instanceof Error ? err.message : "venue search failed");
    }
  }

  /** Pick a resolved venue, filling the (non-guessable) id/slug, then load its schedule. */
  function pickVenue(match: VenueMatch): void {
    setState((s) => ({
      ...s,
      venueId: match.id,
      venueSlug: match.slug ?? "",
      venueLabel: match.city ? `${match.name} — ${match.city}` : match.name,
    }));
    setVenueMatches(null);
    setVenueStatus(null);
    if (state.resourceType === "screening") void loadScreenings(match.id, state.browseDate);
  }

  /** Load what the venue is showing on a date, so the movie/showtime picker has real options. */
  async function loadScreenings(venueId: string, date: string): Promise<void> {
    if (!venueId) return;
    setScreenings(null);
    setScreeningsStatus("loading showtimes…");
    setSeatView(null);
    setActiveShowtime(null);
    try {
      const list = await api.seating.screenings(state.provider, venueId, date);
      setScreenings(list);
      setScreeningsStatus(list.length === 0 ? "no showtimes on this date" : null);
    } catch (err) {
      setScreeningsStatus(err instanceof Error ? err.message : "failed to load showtimes");
    }
  }

  /** Change the browse date and reload the schedule. */
  function changeBrowseDate(date: string): void {
    set("browseDate", date);
    void loadScreenings(state.venueId, date);
  }

  /** Pick a film: record it on the watch and reset the seat map to the new selection. */
  function pickFilm(filmId: string): void {
    const title = screenings?.find((s) => s.filmId === filmId)?.title ?? "";
    setState((s) => ({ ...s, filmId, filmTitle: title, selectedSeats: [] }));
    setSeatView(null);
    setActiveShowtime(null);
  }

  /** Load one showtime's seat map into the picker and pre-fill from the per-theater cache. */
  async function loadShowtimeSeatMap(ref: string): Promise<void> {
    setActiveShowtime(ref);
    setSeatMapStatus("loading seat map…");
    setSeatView(null);
    try {
      const view = await api.seating.map(state.provider, ref);
      setSeatView(view);
      setSeatMapStatus(null);
      if (state.selectedSeats.length === 0) {
        const cached = await api.seating.getPrefs(state.provider, state.venueId, view.signature);
        if (cached) set("selectedSeats", cached.seats);
      }
    } catch (err) {
      setSeatMapStatus(err instanceof Error ? err.message : "seat map fetch failed");
    }
  }

  /** Format an ISO-UTC instant in the watch's timezone as a short local time. */
  function localTime(iso: string): string {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: state.timezone,
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));
  }

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    const result = watchInputSchema.safeParse(toCandidate(state, initial));
    if (!result.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of result.error.issues) {
        fieldErrors[issue.path.join(".")] = issue.message;
      }
      setErrors(fieldErrors);
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      if (seatView && state.selectedSeats.length > 0) {
        // Remember the drawn seats for this auditorium so future watches inherit them; a cache
        // failure must never block saving the watch itself.
        await api.seating
          .putPrefs(state.provider, state.venueId, seatView.signature, state.selectedSeats)
          .catch(() => undefined);
      }
      await onSubmit(result.data);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="watch-form" onSubmit={handleSubmit} aria-label={initial ? "Edit watch" : "Create watch"}>
      <label htmlFor="provider">Provider</label>
      <select id="provider" value={state.provider} onChange={(e) => changeProvider(e.target.value as ProviderName)}>
        {PROVIDERS.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>

      <label htmlFor="label">Label</label>
      <input id="label" value={state.label} onChange={(e) => set("label", e.target.value)} />
      {errors.label && <span className="field-error">{errors.label}</span>}

      <label htmlFor="venueQuery">Venue</label>
      <div className="venue-search">
        <input
          id="venueQuery"
          placeholder="search by name or city, e.g. 34th street"
          value={venueQuery}
          onChange={(e) => setVenueQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void searchVenues();
            }
          }}
        />
        <button type="button" onClick={() => void searchVenues()} disabled={!venueQuery.trim()}>
          Search
        </button>
      </div>
      {venueStatus && <span className="field-error">{venueStatus}</span>}
      {venueMatches && venueMatches.length > 0 && (
        <ul className="venue-results">
          {venueMatches.map((m) => (
            <li key={m.id}>
              <button type="button" onClick={() => pickVenue(m)}>
                {m.name}
                {m.city ? ` — ${m.city}` : ""}
              </button>
            </li>
          ))}
        </ul>
      )}
      {state.venueId && (
        <p className="venue-selected">
          Selected: <strong>{state.venueLabel || state.venueId}</strong> <code>{state.venueId}</code>
        </p>
      )}
      {errors["venue.id"] && <span className="field-error">{errors["venue.id"]}</span>}

      <label htmlFor="resourceType">Resource type</label>
      <select
        id="resourceType"
        value={state.resourceType}
        onChange={(e) => set("resourceType", e.target.value as ResourceType)}
        disabled={PROVIDER_RESOURCE_TYPES[state.provider].length === 1}
      >
        {PROVIDER_RESOURCE_TYPES[state.provider].map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>

      {state.resourceType === "screening" && (
        <fieldset disabled={!state.venueId}>
          <legend>Screening</legend>
          {!state.venueId && <p className="seatmap-hint">Pick a theatre above to see what&apos;s playing.</p>}

          <label htmlFor="browseDate">Showtimes for</label>
          <input
            id="browseDate"
            type="date"
            value={state.browseDate}
            onChange={(e) => changeBrowseDate(e.target.value)}
          />
          {screeningsStatus && <span className="field-error">{screeningsStatus}</span>}

          {screenings && screenings.length > 0 && (
            <>
              <label htmlFor="film">Movie</label>
              <select id="film" value={state.filmId} onChange={(e) => pickFilm(e.target.value)}>
                <option value="">Select a movie…</option>
                {[...new Map(screenings.map((s) => [s.filmId, s.title])).entries()].map(([id, title]) => (
                  <option key={id} value={id}>
                    {title}
                  </option>
                ))}
              </select>

              {state.filmId && (
                <>
                  <span className="field-label">Showtime (pick one to draw your seats)</span>
                  <div className="showtime-list">
                    {screenings
                      .filter((s) => s.filmId === state.filmId)
                      .map((s) => (
                        <button
                          key={s.ref}
                          type="button"
                          className={`showtime${activeShowtime === s.ref ? " showtime-active" : ""}`}
                          onClick={() => void loadShowtimeSeatMap(s.ref)}
                        >
                          {localTime(s.startUtc)}
                          {s.format ? ` · ${s.format}` : ""}
                          {s.status !== "Sellable" ? ` · ${s.status}` : ""}
                        </button>
                      ))}
                  </div>
                </>
              )}
            </>
          )}

          {seatMapStatus && <span className="field-error">{seatMapStatus}</span>}
          {seatView && (
            <SeatMapPicker
              view={seatView}
              selected={state.selectedSeats}
              onChange={(seats) => set("selectedSeats", seats)}
            />
          )}
          {state.selectedSeats.length > 0 && (
            <span className="seatmap-hint">
              {state.selectedSeats.length} acceptable seats: {state.selectedSeats.join(", ")}
            </span>
          )}
        </fieldset>
      )}

      <label htmlFor="partySize">Party size</label>
      <input
        id="partySize"
        type="number"
        min={1}
        max={20}
        value={state.partySize}
        onChange={(e) => set("partySize", e.target.value)}
      />
      {errors.partySize && <span className="field-error">{errors.partySize}</span>}

      <fieldset>
        <legend>Date range</legend>
        <label>
          <input
            type="radio"
            name="dateMode"
            checked={state.dateMode === "fixed"}
            onChange={() => set("dateMode", "fixed")}
          />
          Fixed
        </label>
        <label>
          <input
            type="radio"
            name="dateMode"
            checked={state.dateMode === "rolling"}
            onChange={() => set("dateMode", "rolling")}
          />
          Rolling
        </label>
        {state.dateMode === "fixed" ? (
          <>
            <label htmlFor="rangeStart">Start date</label>
            <input
              id="rangeStart"
              type="date"
              value={state.rangeStart}
              onChange={(e) => set("rangeStart", e.target.value)}
            />
            <label htmlFor="rangeEnd">End date</label>
            <input
              id="rangeEnd"
              type="date"
              value={state.rangeEnd}
              onChange={(e) => set("rangeEnd", e.target.value)}
            />
          </>
        ) : (
          <>
            <label htmlFor="rollingDays">Rolling days ahead</label>
            <input
              id="rollingDays"
              type="number"
              min={1}
              value={state.rollingDays}
              onChange={(e) => set("rollingDays", e.target.value)}
            />
          </>
        )}
        {errors.dateRange && <span className="field-error">{errors.dateRange}</span>}
      </fieldset>

      <label htmlFor="windowStart">Time window start</label>
      <input
        id="windowStart"
        type="time"
        value={state.windowStart}
        onChange={(e) => set("windowStart", e.target.value)}
      />
      <label htmlFor="windowEnd">Time window end</label>
      <input
        id="windowEnd"
        type="time"
        value={state.windowEnd}
        onChange={(e) => set("windowEnd", e.target.value)}
      />
      {errors["timeWindow.start"] && <span className="field-error">{errors["timeWindow.start"]}</span>}
      {errors["timeWindow.end"] && <span className="field-error">{errors["timeWindow.end"]}</span>}

      <label htmlFor="timezone">Timezone (IANA)</label>
      <input id="timezone" value={state.timezone} onChange={(e) => set("timezone", e.target.value)} />
      {errors.timezone && <span className="field-error">{errors.timezone}</span>}

      <label>
        <input type="checkbox" checked={state.autobook} onChange={(e) => set("autobook", e.target.checked)} />
        Autobook
      </label>

      <label>
        <input type="checkbox" checked={state.enabled} onChange={(e) => set("enabled", e.target.checked)} />
        Enabled
      </label>

      <div className="form-actions">
        <button type="submit" disabled={submitting}>
          {submitting ? "Saving…" : "Save"}
        </button>
        <button type="button" onClick={onCancel} disabled={submitting}>
          Cancel
        </button>
      </div>
    </form>
  );
}
