import { useState } from "react";
import type { FormEvent } from "react";
import { Loader2 } from "lucide-react";
import type { ProviderName } from "@bookr/shared";
import { ApiError, api } from "../api/client.ts";
import { Button } from "./ui/button.tsx";
import { Input } from "./ui/input.tsx";
import { Label } from "./ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select.tsx";
import { Textarea } from "./ui/textarea.tsx";

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
 *
 * Security-sensitive: this form only ever holds the token/blob in local component state to build
 * the outgoing request. It must never log, report, or persist those values anywhere.
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
    <form onSubmit={handleSubmit} aria-label="Hand over session" className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="ingest-provider">Provider</Label>
        <Select value={selectedProvider} onValueChange={(v) => setSelectedProvider(v as ProviderName)}>
          <SelectTrigger id="ingest-provider" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PROVIDERS.map((p) => (
              <SelectItem key={p} value={p}>
                {p}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="ingest-token">Ingest token</Label>
        <Input
          id="ingest-token"
          type="password"
          autoComplete="off"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="ingest-blob">Session blob (JSON)</Label>
        <Textarea
          id="ingest-blob"
          value={blob}
          rows={6}
          onChange={(e) => setBlob(e.target.value)}
          placeholder='{"token": "...", "refreshCookie": "..."}'
          className="font-mono text-sm"
        />
      </div>

      <Button type="submit" disabled={submitting || token.length === 0 || blob.length === 0} className="gap-2">
        {submitting && <Loader2 className="size-4 animate-spin" />}
        {submitting ? "Sending…" : "Hand over token"}
      </Button>

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </form>
  );
}
