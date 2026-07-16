import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Bookmark, BookmarkCheck, Loader2, MapPin, Search, Zap } from "lucide-react";
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
import { cn } from "../lib/utils.ts";
import { Button } from "./ui/button.tsx";
import { Input } from "./ui/input.tsx";
import { Label } from "./ui/label.tsx";
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

/** Shared visual treatment for native `<input>`/`<select>` controls, matching the `Input` primitive. */
const controlClass =
  "border-input bg-transparent flex h-9 w-full min-w-0 rounded-md border px-3 py-1 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:ring-destructive/20 aria-invalid:border-destructive";

/** A small uppercase section label used to introduce a group of related fields. */
function SectionLabel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <span className="text-primary text-xs font-medium tracking-[0.2em] uppercase">{children}</span>;
}

/** Destructive-toned message rendered under an invalid field, matched by tests via `.field-error`. */
function FieldError({ children }: { children?: string }): React.JSX.Element | null {
  if (!children) return null;
  return <p className="field-error text-destructive mt-1 text-xs">{children}</p>;
}

/** Muted status line (loading/empty states) for async lookups. */
function FieldHint({ children }: { children?: string | null }): React.JSX.Element | null {
  if (!children) return null;
  return <p className="text-muted-foreground mt-1 text-xs">{children}</p>;
}

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
  // Per-showtime auditorium metadata: its layout signature and whether this theatre already has a
  // saved acceptable-seat set for that auditorium. Populated lazily so the showtime list can flag
  // which auditoriums still need seats drawn.
  const [seatMeta, setSeatMeta] = useState<Record<string, { signature: string; hasPrefs: boolean }>>({});

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

  // When a film is chosen, probe its showtimes' auditoriums so each can flag whether this theatre
  // already has saved seats there (seats are cached per auditorium, not per showtime).
  useEffect(() => {
    if (!state.filmId || !screenings) return;
    void prefetchSeatMeta(screenings.filter((s) => s.filmId === state.filmId).map((s) => s.ref));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.filmId, screenings]);

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
      const cached = await api.seating.getPrefs(state.provider, state.venueId, view.signature);
      setSeatMeta((m) => ({ ...m, [ref]: { signature: view.signature, hasPrefs: cached != null } }));
      if (cached && state.selectedSeats.length === 0) set("selectedSeats", cached.seats);
    } catch (err) {
      setSeatMapStatus(err instanceof Error ? err.message : "seat map fetch failed");
    }
  }

  /** Probe each showtime's auditorium (layout signature) and whether it already has saved seats. */
  async function prefetchSeatMeta(refs: string[]): Promise<void> {
    const prefsBySignature = new Map<string, boolean>();
    for (const ref of refs) {
      if (seatMeta[ref]) continue;
      try {
        const view = await api.seating.map(state.provider, ref);
        let hasPrefs = prefsBySignature.get(view.signature);
        if (hasPrefs === undefined) {
          hasPrefs = (await api.seating.getPrefs(state.provider, state.venueId, view.signature)) != null;
          prefsBySignature.set(view.signature, hasPrefs);
        }
        const resolved = hasPrefs;
        setSeatMeta((m) => ({ ...m, [ref]: { signature: view.signature, hasPrefs: resolved } }));
      } catch {
        // Best-effort: a failed probe just leaves that showtime unbadged.
      }
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
    <form className="space-y-6" onSubmit={handleSubmit} aria-label={initial ? "Edit watch" : "Create watch"}>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="provider">Provider</Label>
          <select
            id="provider"
            className={cn(controlClass, "mt-1.5 cursor-pointer")}
            value={state.provider}
            onChange={(e) => changeProvider(e.target.value as ProviderName)}
          >
            {PROVIDERS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="resourceType">Resource type</Label>
          <select
            id="resourceType"
            className={cn(controlClass, "mt-1.5 cursor-pointer")}
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
        </div>
      </div>

      <div>
        <Label htmlFor="label">Label</Label>
        <Input
          id="label"
          className="mt-1.5"
          placeholder="e.g. Carbone Friday"
          value={state.label}
          onChange={(e) => set("label", e.target.value)}
        />
        <FieldError>{errors.label}</FieldError>
      </div>

      <div>
        <Label htmlFor="venueQuery">Venue</Label>
        <div className="mt-1.5 flex gap-2">
          <Input
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
          <Button type="button" variant="secondary" onClick={() => void searchVenues()} disabled={!venueQuery.trim()}>
            <Search />
            Search
          </Button>
        </div>
        <FieldHint>{venueStatus}</FieldHint>
        {venueMatches && venueMatches.length > 0 && (
          <ul className="border-input bg-popover mt-2 max-h-48 space-y-1 overflow-y-auto rounded-md border p-1.5">
            {venueMatches.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => pickVenue(m)}
                  className="hover:bg-accent hover:text-accent-foreground flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors"
                >
                  <MapPin className="text-muted-foreground size-3.5 shrink-0" />
                  <span className="truncate">
                    {m.name}
                    {m.city ? ` — ${m.city}` : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {state.venueId && (
          <p className="text-muted-foreground mt-2 text-sm">
            Selected: <strong className="text-foreground">{state.venueLabel || state.venueId}</strong>{" "}
            <code className="tnum bg-muted rounded px-1 py-0.5 text-xs">{state.venueId}</code>
          </p>
        )}
        <FieldError>{errors["venue.id"]}</FieldError>
      </div>

      {state.resourceType === "screening" && (
        <fieldset disabled={!state.venueId} className="border-border/70 rounded-lg border p-4 disabled:opacity-60">
          <legend className="px-1">
            <SectionLabel>Screening</SectionLabel>
          </legend>
          {!state.venueId && (
            <p className="text-muted-foreground text-sm">Pick a theatre above to see what&apos;s playing.</p>
          )}

          <div className="max-w-xs">
            <Label htmlFor="browseDate">Showtimes for</Label>
            <Input
              id="browseDate"
              type="date"
              className="tnum mt-1.5"
              value={state.browseDate}
              onChange={(e) => changeBrowseDate(e.target.value)}
            />
          </div>
          <FieldHint>{screeningsStatus}</FieldHint>

          {screenings && screenings.length > 0 && (
            <>
              <div className="mt-4">
                <Label htmlFor="film">Movie</Label>
                <select
                  id="film"
                  className={cn(controlClass, "mt-1.5 cursor-pointer")}
                  value={state.filmId}
                  onChange={(e) => pickFilm(e.target.value)}
                >
                  <option value="">Select a movie…</option>
                  {[...new Map(screenings.map((s) => [s.filmId, s.title])).entries()].map(([id, title]) => (
                    <option key={id} value={id}>
                      {title}
                    </option>
                  ))}
                </select>
              </div>

              {state.filmId && (
                <div className="mt-4">
                  <p className="text-muted-foreground mb-2 text-sm">
                    Pick a showtime to view its live seat map. Your seat picks are saved for this theatre&apos;s
                    auditorium and reused across every showtime and movie here.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {screenings
                      .filter((s) => s.filmId === state.filmId)
                      .map((s) => {
                        const meta = seatMeta[s.ref];
                        return (
                          <Button
                            key={s.ref}
                            type="button"
                            size="sm"
                            variant={activeShowtime === s.ref ? "default" : "outline"}
                            onClick={() => void loadShowtimeSeatMap(s.ref)}
                          >
                            <span className="tnum">
                              {localTime(s.startUtc)}
                              {s.format ? ` · ${s.format}` : ""}
                              {s.status !== "Sellable" ? ` · ${s.status}` : ""}
                            </span>
                            {meta &&
                              (meta.hasPrefs ? (
                                <BookmarkCheck className="text-signal size-3.5" aria-label="saved seats for this auditorium" />
                              ) : (
                                <Bookmark
                                  className="size-3.5 opacity-50"
                                  aria-label="no saved seats for this auditorium yet"
                                />
                              ))}
                          </Button>
                        );
                      })}
                  </div>
                  <p className="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.7rem]">
                    <span className="flex items-center gap-1">
                      <BookmarkCheck className="text-signal size-3" /> saved seats for this auditorium
                    </span>
                    <span className="flex items-center gap-1">
                      <Bookmark className="size-3 opacity-50" /> none yet — pick it to draw some
                    </span>
                  </p>
                </div>
              )}
            </>
          )}

          <FieldHint>{seatMapStatus}</FieldHint>
          {seatView && (
            <div className="mt-4">
              <SeatMapPicker
                view={seatView}
                selected={state.selectedSeats}
                onChange={(seats) => set("selectedSeats", seats)}
              />
            </div>
          )}
          {state.selectedSeats.length > 0 && (
            <p className="seatmap-hint tnum text-muted-foreground mt-3 text-xs">
              {state.selectedSeats.length} acceptable seats: {state.selectedSeats.join(", ")}
            </p>
          )}
        </fieldset>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor="partySize">Party size</Label>
          <Input
            id="partySize"
            type="number"
            min={1}
            max={20}
            className="tnum mt-1.5"
            value={state.partySize}
            onChange={(e) => set("partySize", e.target.value)}
          />
          <FieldError>{errors.partySize}</FieldError>
        </div>
        <div>
          <Label htmlFor="windowStart">Time window start</Label>
          <Input
            id="windowStart"
            type="time"
            className="tnum mt-1.5"
            value={state.windowStart}
            onChange={(e) => set("windowStart", e.target.value)}
          />
          <FieldError>{errors["timeWindow.start"]}</FieldError>
        </div>
        <div>
          <Label htmlFor="windowEnd">Time window end</Label>
          <Input
            id="windowEnd"
            type="time"
            className="tnum mt-1.5"
            value={state.windowEnd}
            onChange={(e) => set("windowEnd", e.target.value)}
          />
          <FieldError>{errors["timeWindow.end"]}</FieldError>
        </div>
      </div>

      <div>
        <Label htmlFor="timezone">Timezone (IANA)</Label>
        <Input
          id="timezone"
          className="tnum mt-1.5 max-w-xs"
          value={state.timezone}
          onChange={(e) => set("timezone", e.target.value)}
        />
        <FieldError>{errors.timezone}</FieldError>
      </div>

      <fieldset className="border-border/70 rounded-lg border p-4">
        <legend className="px-1">
          <SectionLabel>Date range</SectionLabel>
        </legend>
        <div className="flex gap-2">
          <label
            className={cn(
              "has-[:checked]:border-primary has-[:checked]:bg-primary/10 has-[:checked]:text-foreground",
              "border-input text-muted-foreground flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors",
            )}
          >
            <input
              type="radio"
              name="dateMode"
              className="accent-primary"
              checked={state.dateMode === "fixed"}
              onChange={() => set("dateMode", "fixed")}
            />
            Fixed
          </label>
          <label
            className={cn(
              "has-[:checked]:border-primary has-[:checked]:bg-primary/10 has-[:checked]:text-foreground",
              "border-input text-muted-foreground flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors",
            )}
          >
            <input
              type="radio"
              name="dateMode"
              className="accent-primary"
              checked={state.dateMode === "rolling"}
              onChange={() => set("dateMode", "rolling")}
            />
            Rolling
          </label>
        </div>
        {state.dateMode === "fixed" ? (
          <div className="mt-4 grid grid-cols-2 gap-4 sm:max-w-sm">
            <div>
              <Label htmlFor="rangeStart">Start date</Label>
              <Input
                id="rangeStart"
                type="date"
                className="tnum mt-1.5"
                value={state.rangeStart}
                onChange={(e) => set("rangeStart", e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="rangeEnd">End date</Label>
              <Input
                id="rangeEnd"
                type="date"
                className="tnum mt-1.5"
                value={state.rangeEnd}
                onChange={(e) => set("rangeEnd", e.target.value)}
              />
            </div>
          </div>
        ) : (
          <div className="mt-4 max-w-[10rem]">
            <Label htmlFor="rollingDays">Rolling days ahead</Label>
            <Input
              id="rollingDays"
              type="number"
              min={1}
              className="tnum mt-1.5"
              value={state.rollingDays}
              onChange={(e) => set("rollingDays", e.target.value)}
            />
          </div>
        )}
        <FieldError>{errors.dateRange}</FieldError>
      </fieldset>

      <div className="flex flex-col gap-3 sm:flex-row">
        <label className="has-[:checked]:border-primary has-[:checked]:bg-primary/5 border-input flex flex-1 cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5 transition-colors">
          <input
            type="checkbox"
            className="accent-primary size-4 cursor-pointer"
            checked={state.autobook}
            onChange={(e) => set("autobook", e.target.checked)}
          />
          <span className="flex items-center gap-1.5 text-sm font-medium">
            <Zap className="text-primary size-3.5" />
            Autobook
          </span>
        </label>
        <label className="has-[:checked]:border-primary has-[:checked]:bg-primary/5 border-input flex flex-1 cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5 transition-colors">
          <input
            type="checkbox"
            className="accent-primary size-4 cursor-pointer"
            checked={state.enabled}
            onChange={(e) => set("enabled", e.target.checked)}
          />
          <span className="text-sm font-medium">Enabled</span>
        </label>
      </div>

      <div className="border-border/70 flex items-center justify-end gap-2 border-t pt-5">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitting} className="gap-2">
          {submitting && <Loader2 className="size-4 animate-spin" />}
          {submitting ? "Saving…" : "Save"}
        </Button>
      </div>
    </form>
  );
}
