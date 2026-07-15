import { useState } from "react";
import type { FormEvent } from "react";
import type { ProviderName } from "@bookr/shared";
import { ApiError, api } from "../api/client.ts";

const PROVIDERS: ProviderName[] = ["resy", "sohohouse", "opentable"];

/** Props for {@link IngestForm}. */
export interface IngestFormProps {
  /** Provider to pre-select, e.g. the row the operator clicked "hand over token" on. */
  provider: ProviderName;
  /** Called after a successful hand-over, so the parent can refresh credential status. */
  onIngested: () => void;
}

/**
 * Hand a captured session over to the server for a provider. The ingest endpoint is bearer-token
 * authenticated (`INGEST_TOKEN`), independent of the dashboard's own login session, so this form
 * collects both the token and the raw session blob produced by the off-box login capture tool.
 */
export function IngestForm({ provider, onIngested }: IngestFormProps): React.JSX.Element {
  const [selectedProvider, setSelectedProvider] = useState<ProviderName>(provider);
  const [token, setToken] = useState("");
  const [blob, setBlob] = useState("");
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent): Promise<void> {
    e.preventDefault();
    setError(undefined);
    let session: unknown;
    try {
      session = JSON.parse(blob);
    } catch {
      setError("session blob must be valid JSON");
      return;
    }
    setSubmitting(true);
    try {
      await api.credentials.ingest(selectedProvider, token, session);
      setBlob("");
      onIngested();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "ingest failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="ingest-form" onSubmit={handleSubmit} aria-label="Hand over session">
      <label htmlFor="ingest-provider">Provider</label>
      <select
        id="ingest-provider"
        value={selectedProvider}
        onChange={(e) => setSelectedProvider(e.target.value as ProviderName)}
      >
        {PROVIDERS.map((p) => (
          <option key={p} value={p}>
            {p}
          </option>
        ))}
      </select>

      <label htmlFor="ingest-token">Ingest token</label>
      <input id="ingest-token" type="password" value={token} onChange={(e) => setToken(e.target.value)} />

      <label htmlFor="ingest-blob">Session blob (JSON)</label>
      <textarea
        id="ingest-blob"
        value={blob}
        rows={6}
        onChange={(e) => setBlob(e.target.value)}
        placeholder='{"token": "...", "refreshCookie": "..."}'
      />

      <button type="submit" disabled={submitting || token.length === 0 || blob.length === 0}>
        {submitting ? "Sending…" : "Hand over token"}
      </button>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </form>
  );
}
