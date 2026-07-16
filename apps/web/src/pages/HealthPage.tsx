import { api } from "../api/client.ts";
import { useAsync } from "../hooks/useAsync.ts";

/**
 * Health screen: overall service health from the public health endpoint (last scan pass,
 * scheduler state), plus per-provider session state from the authenticated credentials endpoint
 * — the `/api/health` payload is intentionally minimal and carries no provider detail.
 */
export function HealthPage(): React.JSX.Element {
  const { data: health, error, loading, reload: reloadHealth } = useAsync(() => api.health.status(), []);
  const { data: providers, reload: reloadProviders } = useAsync(() => api.credentials.status(), []);

  function reload(): void {
    reloadHealth();
    reloadProviders();
  }

  return (
    <section>
      <div className="section-header">
        <h2>Health</h2>
        <button type="button" onClick={reload}>
          Refresh
        </button>
      </div>
      {loading && <p>Loading health…</p>}
      {error && (
        <p role="alert" className="error">
          Failed to load health: {error.message}
        </p>
      )}
      {health && (
        <>
          <p className={health.ok ? "status-ok" : "status-bad"}>{health.ok ? "Healthy" : "Needs attention"}</p>
          <dl>
            <dt>Scheduler</dt>
            <dd>{health.schedulerRunning ? "running" : "stopped"}</dd>
            <dt>Last pass</dt>
            <dd>{health.lastPassAt ?? "never"}</dd>
          </dl>
          <table>
            <thead>
              <tr>
                <th>Provider</th>
                <th>Session</th>
                <th>Expires</th>
              </tr>
            </thead>
            <tbody>
              {(providers ?? []).map((p) => (
                <tr key={p.provider}>
                  <td>{p.provider}</td>
                  <td className={p.needsAttention ? "needs-attention" : ""}>{p.sessionState}</td>
                  <td>{p.expiresAt ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
