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

function challengedError(provider: BookingProvider): ProviderError {
  return new ProviderError("challenged", `${provider.name} session is challenged`, { retryable: false });
}

/**
 * Persist a provider as challenged, announce it once, and throw. Persisting the `challenged`
 * state is what pauses the provider: subsequent {@link ensureLiveSession} calls short-circuit on
 * it without touching the provider again, so a captcha/step-up can never turn into a login storm.
 * The provider stays paused until a fresh session is handed over via the credential service.
 */
async function raiseChallenge(
  ctx: ServiceContext,
  provider: BookingProvider,
  session: Session | undefined,
  now: Date,
): Promise<never> {
  const base: Session = session ?? { provider: provider.name, state: "challenged", data: null, updatedAt: now.toISOString() };
  const challenged: Session = { ...base, provider: provider.name, state: "challenged", updatedAt: now.toISOString() };
  ctx.repository.sessions.put(challenged);
  ctx.repository.activity.record({
    at: now.toISOString(),
    type: "auth-challenged",
    provider: provider.name,
    detail: `${provider.name} session challenged; hand over a fresh session`,
  });
  await ctx.notifier.notify("warning", {
    title: `${provider.name} needs attention`,
    body: `${provider.name} hit a login challenge. Sign in and hand over a fresh session to resume scanning.`,
    link: ctx.config.publicBaseUrl,
  });
  throw challengedError(provider);
}

/**
 * Ensure a live, authenticated session for a provider, applying the credential state machine and
 * persisting the result. A challenge from any authentication step — or a provider that cannot
 * authenticate headlessly — pauses the provider: the challenged state is persisted, announced
 * once, and thrown, so the next pass skips the provider (without re-notifying) until a session is
 * handed over.
 *
 * @param ctx - The service context.
 * @param provider - The provider to obtain a session for.
 * @returns An active session.
 * @throws {@link ProviderError} With class `challenged` when the provider needs manual re-auth, or
 *   the underlying provider error when authentication fails for another reason.
 */
export async function ensureLiveSession(ctx: ServiceContext, provider: BookingProvider): Promise<Session> {
  const creds = await ctx.credentialsProvider.getProviderCredentials(provider.name);
  const now = ctx.clock.now();
  const existing = ctx.repository.sessions.get(provider.name);

  // Already paused on a prior challenge: short-circuit without touching the provider or
  // re-notifying — it was announced when first raised and stays paused until a handover.
  if (existing && existing.state === "challenged") {
    throw challengedError(provider);
  }

  const missing = !existing || existing.state === "missing";

  // A provider that cannot authenticate headlessly (interactive captcha/step-up only) can never
  // mint its own session; a missing session is therefore a standing challenge for the operator.
  if (missing && !provider.capabilities.headlessAuth) {
    return raiseChallenge(ctx, provider, existing, now);
  }

  let session: Session;
  try {
    if (!existing || existing.state === "missing") {
      session = await provider.authenticate(creds);
    } else if (existing.state === "expired" || isNearExpiry(existing, now)) {
      try {
        session = await provider.refresh(existing, creds);
      } catch (err) {
        if (classify(provider, err) === "auth-expired") {
          session = await provider.authenticate(creds);
        } else {
          throw err;
        }
      }
    } else {
      session = existing;
    }
  } catch (err) {
    // A login challenge from any auth step pauses the provider (see raiseChallenge).
    if (classify(provider, err) === "challenged") {
      return raiseChallenge(ctx, provider, existing, now);
    }
    throw err;
  }

  if (session.state === "challenged") {
    return raiseChallenge(ctx, provider, session, now);
  }

  const active: Session = { ...session, updatedAt: ctx.clock.now().toISOString() };
  ctx.repository.sessions.put(active);
  return active;
}
