import { useState } from "react";
import type { Watch, WatchInput } from "@bookr/shared";
import { ApiError, api } from "../api/client.ts";
import { useAsync } from "../hooks/useAsync.ts";
import { WatchForm } from "../components/WatchForm.tsx";

function describeDateRange(watch: Watch): string {
  return "rollingDays" in watch.dateRange
    ? `next ${watch.dateRange.rollingDays}d`
    : `${watch.dateRange.start} → ${watch.dateRange.end}`;
}

/**
 * Watches screen: lists every configured watch and lets the operator create, edit, delete, and
 * enable/disable them. Validation happens in {@link WatchForm}; this page only wires form
 * submission to the REST client and refreshes the list afterward.
 */
export function WatchesPage(): React.JSX.Element {
  const { data: watches, error, loading, reload } = useAsync(() => api.watches.list(), []);
  const [editing, setEditing] = useState<Watch | "new" | null>(null);
  const [actionError, setActionError] = useState<string>();

  async function handleSubmit(input: WatchInput): Promise<void> {
    setActionError(undefined);
    try {
      if (editing && editing !== "new") {
        await api.watches.update(editing.id, input);
      } else {
        await api.watches.create(input);
      }
      setEditing(null);
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "save failed");
    }
  }

  async function handleToggle(watch: Watch): Promise<void> {
    setActionError(undefined);
    try {
      await api.watches.update(watch.id, { enabled: !watch.enabled });
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "update failed");
    }
  }

  async function handleDelete(watch: Watch): Promise<void> {
    if (!window.confirm(`Delete watch "${watch.label}"?`)) return;
    setActionError(undefined);
    try {
      await api.watches.remove(watch.id);
      reload();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "delete failed");
    }
  }

  if (editing) {
    return (
      <section>
        <h2>{editing === "new" ? "New watch" : `Edit ${editing.label}`}</h2>
        <WatchForm initial={editing === "new" ? undefined : editing} onSubmit={handleSubmit} onCancel={() => setEditing(null)} />
      </section>
    );
  }

  return (
    <section>
      <div className="section-header">
        <h2>Watches</h2>
        <button type="button" onClick={() => setEditing("new")}>
          New watch
        </button>
      </div>
      {actionError && (
        <p role="alert" className="error">
          {actionError}
        </p>
      )}
      {loading && <p>Loading watches…</p>}
      {error && (
        <p role="alert" className="error">
          Failed to load watches: {error.message}
        </p>
      )}
      {watches && watches.length === 0 && <p>No watches yet.</p>}
      {watches && watches.length > 0 && (
        <table>
          <thead>
            <tr>
              <th>Label</th>
              <th>Provider</th>
              <th>Venue</th>
              <th>Party</th>
              <th>Dates</th>
              <th>Window</th>
              <th>Autobook</th>
              <th>Enabled</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {watches.map((watch) => (
              <tr key={watch.id}>
                <td>{watch.label}</td>
                <td>{watch.provider}</td>
                <td>{watch.venue.slug ?? watch.venue.id}</td>
                <td>{watch.partySize}</td>
                <td>{describeDateRange(watch)}</td>
                <td>
                  {watch.timeWindow.start}–{watch.timeWindow.end}
                </td>
                <td>{watch.autobook ? "yes" : "no"}</td>
                <td>
                  <button type="button" onClick={() => handleToggle(watch)}>
                    {watch.enabled ? "Disable" : "Enable"}
                  </button>
                </td>
                <td>
                  <button type="button" onClick={() => setEditing(watch)}>
                    Edit
                  </button>
                  <button type="button" onClick={() => handleDelete(watch)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
