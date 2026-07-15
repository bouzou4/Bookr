/**
 * Credential and session status for the operator: reporting each provider's session state and
 * accepting a session handed over out-of-band (after an interactive login), which clears a
 * challenge and lets scanning resume.
 *
 * @packageDocumentation
 */

import type { CredentialStatus, ProviderName, Session, SessionState } from "@bookr/shared";
import type { ServiceContext } from "./context.ts";

function needsAttention(state: SessionState): boolean {
  return state === "challenged" || state === "expired" || state === "missing";
}

/**
 * Build the credential-management surface of the application.
 *
 * @param ctx - The service context.
 * @returns An object exposing `status()` and `ingestSession(provider, blob)`.
 */
export function createCredentialService(ctx: ServiceContext): {
  status(): Promise<CredentialStatus[]>;
  ingestSession(provider: ProviderName, blob: unknown): Promise<void>;
} {
  return {
    status: async (): Promise<CredentialStatus[]> =>
      [...ctx.providers.keys()].map((provider) => {
        const session = ctx.repository.sessions.get(provider);
        const state: SessionState = session?.state ?? "missing";
        return { provider, sessionState: state, expiresAt: session?.expiresAt, needsAttention: needsAttention(state) };
      }),

    ingestSession: async (provider: ProviderName, blob: unknown): Promise<void> => {
      const at = ctx.clock.now().toISOString();
      const session: Session = { provider, state: "active", data: blob, updatedAt: at };
      ctx.repository.sessions.put(session);
      ctx.repository.activity.record({
        at,
        type: "session-ingested",
        provider,
        detail: `session handed over for ${provider}; scanning resumed`,
      });
    },
  };
}
