import { api } from "../api/client.ts";
import { useAsync } from "../hooks/useAsync.ts";

/**
 * Health screen: a shallow, unauthenticated-endpoint-backed view of overall service health —
 * last scan pass time, whether the scheduler loop is running, and per-provider session state.
 */
export function HealthPage(): React.JSX.Element {
  const { data: health, error, loading, reload } = useAsync(() => api.health.status(), []);

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
              {health.providers.map((p) => (
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
