/**
 * Typed REST client for the Bookr dashboard. Every method corresponds to exactly one route on
 * the Bookr server; request and response shapes come from `@bookr/shared` so the client can
 * never drift from the domain model the server validates against.
 *
 * @packageDocumentation
 */

import type {
  ActivityEvent,
  AvailabilityCheckInput,
  BookResult,
  CredentialStatus,
  HealthReport,
  ProviderName,
  ScanReport,
  Slot,
  VenueMatch,
  Watch,
  WatchInput,
  WatchUpdate,
} from "@bookr/shared";

/**
 * Thrown when the server responds with a non-2xx status. Carries the HTTP status code so
 * callers can distinguish, e.g., a validation failure (400) from an auth failure (401/403).
 */
export class ApiError extends Error {
  /** HTTP status code returned by the server. */
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** Shape of the JSON error body the server is expected to return alongside non-2xx statuses. */
interface ErrorBody {
  error?: string;
  message?: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });

  if (!res.ok) {
    let detail = res.statusText || `request failed with status ${res.status}`;
    try {
      const body = (await res.json()) as ErrorBody;
      detail = body.error ?? body.message ?? detail;
    } catch {
      // Body wasn't JSON (or was empty); fall back to the status text already captured.
    }
    throw new ApiError(res.status, detail);
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

function query(params: Record<string, string | number | undefined>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) qs.set(key, String(value));
  }
  const s = qs.toString();
  return s ? `?${s}` : "";
}

/**
 * The dashboard's REST client, grouped by resource. Every call resolves with the parsed JSON
 * response or rejects with an {@link ApiError} for non-2xx responses.
 */
export const api = {
  /** Session authentication (single-user cookie login). */
  auth: {
    /** Log in with the dashboard password, establishing a session cookie. */
    login: (password: string): Promise<void> =>
      request("/api/auth/login", { method: "POST", body: JSON.stringify({ password }) }),
    /** Clear the current session. */
    logout: (): Promise<void> => request("/api/auth/logout", { method: "POST" }),
  },

  /** Watch CRUD and per-watch scan triggers. */
  watches: {
    /** List all configured watches. */
    list: (): Promise<Watch[]> => request("/api/watches"),
    /** Fetch a single watch by id. */
    get: (id: string): Promise<Watch> => request(`/api/watches/${encodeURIComponent(id)}`),
    /** Create a new watch. */
    create: (input: WatchInput): Promise<Watch> =>
      request("/api/watches", { method: "POST", body: JSON.stringify(input) }),
    /** Apply a partial update to an existing watch (e.g. edit fields, or toggle `enabled`). */
    update: (id: string, input: WatchUpdate): Promise<Watch> =>
      request(`/api/watches/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(input) }),
    /** Delete a watch. */
    remove: (id: string): Promise<void> =>
      request(`/api/watches/${encodeURIComponent(id)}`, { method: "DELETE" }),
    /** Trigger an immediate scan pass for a single watch. */
    scan: (id: string): Promise<ScanReport> =>
      request(`/api/watches/${encodeURIComponent(id)}/scan`, { method: "POST" }),
  },

  /** Manual scan triggers across all watches. */
  scan: {
    /** Trigger an immediate scan pass across every enabled watch. */
    runAll: (): Promise<ScanReport> => request("/api/scan", { method: "POST" }),
  },

  /** Ad-hoc availability lookups outside of any saved watch. */
  availability: {
    /** Check live availability for a provider/venue/date/party combination. */
    check: (input: AvailabilityCheckInput): Promise<Slot[]> =>
      request("/api/availability/check", { method: "POST", body: JSON.stringify(input) }),
  },

  /** Venue lookup, used to turn a free-text query into a provider venue id. */
  venues: {
    /** Resolve a venue query (name, URL, or slug) to candidate matches on a provider. */
    resolve: (provider: ProviderName, queryText: string): Promise<VenueMatch[]> =>
      request("/api/venues/resolve", {
        method: "POST",
        body: JSON.stringify({ provider, query: queryText }),
      }),
  },

  /** Recent activity/audit feed. */
  activity: {
    /** Fetch recent activity events, optionally limited or filtered by event type. */
    recent: (opts?: { limit?: number; type?: string }): Promise<ActivityEvent[]> =>
      request(`/api/activity${query({ limit: opts?.limit, type: opts?.type })}`),
  },

  /** Per-provider credential/session status and manual session hand-over. */
  credentials: {
    /** Fetch current per-provider session status. */
    status: (): Promise<CredentialStatus[]> => request("/api/credentials"),
    /**
     * Hand a freshly captured session blob to the server for a provider. This is the browser
     * equivalent of the off-box login tool: it authenticates with the ingest bearer token
     * (never the dashboard session cookie) rather than the logged-in operator's cookie.
     */
    ingest: (provider: ProviderName, ingestToken: string, session: unknown): Promise<void> =>
      request(`/api/ingest/${encodeURIComponent(provider)}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${ingestToken}` },
        body: JSON.stringify({ session }),
      }),
  },

  /** Manual booking of a previously observed slot. */
  booking: {
    /** Attempt to book a slot by dedupe key. The server 403s unless the watch has autobook on. */
    book: (watchId: string, dedupeKey: string): Promise<BookResult> =>
      request("/api/book", { method: "POST", body: JSON.stringify({ watchId, dedupeKey }) }),
  },

  /** Service health, unauthenticated. */
  health: {
    /** Fetch the current health report. */
    status: (): Promise<HealthReport> => request("/api/health"),
  },
};
