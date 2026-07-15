import { useState } from "react";
import type { ActivityType } from "@bookr/shared";
import { api } from "../api/client.ts";
import { useAsync } from "../hooks/useAsync.ts";

const TYPES: ActivityType[] = [
  "slot-found",
  "notified",
  "booked",
  "book-failed",
  "auth-challenged",
  "error",
  "pass-complete",
];

/**
 * Activity screen: a recent-events feed, optionally filtered by event type, with a manual
 * refresh so the operator can pull the latest without waiting for the next scheduled reload.
 */
export function ActivityPage(): React.JSX.Element {
  const [type, setType] = useState<string>("");
  const { data: events, error, loading, reload } = useAsync(
    () => api.activity.recent({ limit: 100, type: type || undefined }),
    [type],
  );

  return (
    <section>
      <div className="section-header">
        <h2>Activity</h2>
        <label htmlFor="type-filter">Type</label>
        <select id="type-filter" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">All</option>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <button type="button" onClick={reload}>
          Refresh
        </button>
      </div>
      {loading && <p>Loading activity…</p>}
      {error && (
        <p role="alert" className="error">
          Failed to load activity: {error.message}
        </p>
      )}
      {events && events.length === 0 && <p>No activity yet.</p>}
      {events && events.length > 0 && (
        <ul className="activity-feed">
          {events.map((event) => (
            <li key={event.id ?? `${event.at}-${event.type}`}>
              <span className="activity-time">{event.at}</span>
              <span className={`activity-type activity-type-${event.type}`}>{event.type}</span>
              {event.provider && <span className="activity-provider">{event.provider}</span>}
              {event.detail && <span className="activity-detail">{event.detail}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
