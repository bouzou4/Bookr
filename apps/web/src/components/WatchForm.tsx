import { useState } from "react";
import type { FormEvent } from "react";
import {
  type ProviderName,
  type ResourceType,
  type Watch,
  type WatchInput,
  watchInputSchema,
} from "@bookr/shared";

const PROVIDERS: ProviderName[] = ["resy", "sohohouse", "opentable"];
const RESOURCE_TYPES: ResourceType[] = ["table", "bedroom", "screening", "event"];

/** Editable form fields, kept as strings/booleans so every input can stay controlled. */
interface FormState {
  provider: ProviderName;
  label: string;
  venueId: string;
  venueSlug: string;
  resourceType: ResourceType;
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
    resourceType: watch?.resourceType ?? "table",
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

function toCandidate(state: FormState): unknown {
  return {
    provider: state.provider,
    label: state.label,
    venue: { id: state.venueId, slug: state.venueSlug || undefined },
    resourceType: state.resourceType,
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

  function set<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setState((s) => ({ ...s, [key]: value }));
  }

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    const result = watchInputSchema.safeParse(toCandidate(state));
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
      await onSubmit(result.data);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="watch-form" onSubmit={handleSubmit} aria-label={initial ? "Edit watch" : "Create watch"}>
      <label htmlFor="provider">Provider</label>
      <select
        id="provider"
        value={state.provider}
        onChange={(e) => set("provider", e.target.value as ProviderName)}
      >
        {PROVIDERS.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>

      <label htmlFor="label">Label</label>
      <input id="label" value={state.label} onChange={(e) => set("label", e.target.value)} />
      {errors.label && <span className="field-error">{errors.label}</span>}

      <label htmlFor="venueId">Venue id</label>
      <input id="venueId" value={state.venueId} onChange={(e) => set("venueId", e.target.value)} />
      {errors["venue.id"] && <span className="field-error">{errors["venue.id"]}</span>}

      <label htmlFor="venueSlug">Venue slug (optional)</label>
      <input id="venueSlug" value={state.venueSlug} onChange={(e) => set("venueSlug", e.target.value)} />

      <label htmlFor="resourceType">Resource type</label>
      <select
        id="resourceType"
        value={state.resourceType}
        onChange={(e) => set("resourceType", e.target.value as ResourceType)}
      >
        {RESOURCE_TYPES.map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>

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
