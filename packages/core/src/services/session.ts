/**
 * Session lifecycle: obtaining and maintaining an authenticated provider session before a scan or
 * booking. Encodes the credential state machine — authenticate when missing, refresh when near
 * expiry, re-authenticate when a refresh reports the token is truly dead, and surface a challenge
 * (captcha / step-up) as a paused provider that needs an operator to hand over a fresh session.
 *
 * @packageDocumentation
 */

import type { ErrorClass, ProviderName, Session } from "@bookr/shared";
import type { BookingProvider } from "../ports/booking-provider.ts";
import { ProviderError } from "../errors.ts";
import type { ServiceContext } from "./context.ts";

/** Refresh a session this many milliseconds before its credential is due to expire. */
export const SESSION_REFRESH_LEAD_MS = 5 * 60 * 1000;

/**
 * Look up the provider implementation for a name.
 *
 * @param ctx - The service context.
 * @param name - The provider to look up.
 * @returns The registered provider.
 * @throws {@link ProviderError} If no provider is registered under that name.
 */
export function getProvider(ctx: ServiceContext, name: ProviderName): BookingProvider {
  const provider = ctx.providers.get(name);
  if (!provider) {
    throw new ProviderError("other", `no provider registered for "${name}"`, { retryable: false });
  }
  return provider;
}

/**
 * Normalise any thrown value into an {@link ErrorClass} using the provider's own classifier,
 * preferring the class already attached to a {@link ProviderError}.
 *
 * @param provider - The provider whose classifier to consult.
 * @param err - The thrown value.
 * @returns The normalised error class.
 */
export function classify(provider: BookingProvider, err: unknown): ErrorClass {
  if (err instanceof ProviderError) return err.errorClass;
  return provider.classifyError(err);
}

function isNearExpiry(session: Session, now: Date): boolean {
  if (!session.expiresAt) return false;
  return new Date(session.expiresAt).getTime() - now.getTime() <= SESSION_REFRESH_LEAD_MS;
}

async function raiseChallenge(ctx: ServiceContext, provider: BookingProvider, session: Session): Promise<never> {
  const challenged: Session = { ...session, state: "challenged", updatedAt: ctx.clock.now().toISOString() };
  ctx.repository.sessions.put(challenged);
  ctx.repository.activity.record({
    at: ctx.clock.now().toISOString(),
    type: "auth-challenged",
    provider: provider.name,
    detail: `${provider.name} session challenged; hand over a fresh session`,
  });
  await ctx.notifier.notify("warning", {
    title: `${provider.name} needs attention`,
    body: `${provider.name} hit a login challenge. Sign in and hand over a fresh session to resume scanning.`,
  });
  throw new ProviderError("challenged", `${provider.name} session is challenged`, { retryable: false });
}

/**
 * Ensure a live, authenticated session for a provider, applying the credential state machine and
 * persisting the result. A challenged provider is paused: this records the event, warns, and
 * throws so the caller skips the provider until a session is handed over.
 *
 * @param ctx - The service context.
 * @param provider - The provider to obtain a session for.
 * @returns An active session.
 * @throws {@link ProviderError} With class `challenged` when the provider needs manual re-auth, or
 *   the underlying provider error when authentication fails.
 */
export async function ensureLiveSession(ctx: ServiceContext, provider: BookingProvider): Promise<Session> {
  const creds = await ctx.credentialsProvider.getProviderCredentials(provider.name);
  const now = ctx.clock.now();
  let session = ctx.repository.sessions.get(provider.name);

  if (!session || session.state === "missing") {
    session = await provider.authenticate(creds);
  } else if (session.state === "challenged") {
    // Still awaiting a handed-over session; do not hammer the provider.
    throw new ProviderError("challenged", `${provider.name} session is challenged`, { retryable: false });
  } else if (session.state === "expired" || isNearExpiry(session, now)) {
    try {
      session = await provider.refresh(session, creds);
    } catch (err) {
      if (classify(provider, err) === "auth-expired") {
        session = await provider.authenticate(creds);
      } else {
        throw err;
      }
    }
  }

  if (session.state === "challenged") {
    return raiseChallenge(ctx, provider, session);
  }

  const active: Session = { ...session, updatedAt: ctx.clock.now().toISOString() };
  ctx.repository.sessions.put(active);
  return active;
}
