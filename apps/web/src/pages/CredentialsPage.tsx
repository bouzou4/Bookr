import { useState } from "react";
import type { ProviderName } from "@bookr/shared";
import { api } from "../api/client.ts";
import { useAsync } from "../hooks/useAsync.ts";
import { IngestForm } from "../components/IngestForm.tsx";

/**
 * Credentials screen: shows per-provider session status and lets the operator hand over a
 * freshly captured session (e.g. after a provider challenge) via the ingest endpoint.
 */
export function CredentialsPage(): React.JSX.Element {
  const { data: statuses, error, loading, reload } = useAsync(() => api.credentials.status(), []);
  const [handoverProvider, setHandoverProvider] = useState<ProviderName | null>(null);

  return (
    <section>
      <h2>Credentials</h2>
      {loading && <p>Loading credential status…</p>}
      {error && (
        <p role="alert" className="error">
          Failed to load credentials: {error.message}
        </p>
      )}
      {statuses && (
        <table>
          <thead>
            <tr>
              <th>Provider</th>
              <th>Session</th>
              <th>Expires</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {statuses.map((status) => (
              <tr key={status.provider}>
                <td>{status.provider}</td>
                <td className={status.needsAttention ? "needs-attention" : ""}>{status.sessionState}</td>
                <td>{status.expiresAt ?? "—"}</td>
                <td>
                  <button type="button" onClick={() => setHandoverProvider(status.provider)}>
                    Hand over token
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {handoverProvider && (
        <div className="handover-panel">
          <h3>Hand over session — {handoverProvider}</h3>
          <IngestForm
            provider={handoverProvider}
            onIngested={() => {
              setHandoverProvider(null);
              reload();
            }}
          />
          <button type="button" onClick={() => setHandoverProvider(null)}>
            Cancel
          </button>
        </div>
      )}
    </section>
  );
}
