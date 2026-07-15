/**
 * Health reporting: a shallow snapshot combining the last completed scan pass, whether the
 * scheduler loop is running, and each provider's session state.
 *
 * @packageDocumentation
 */

import type { CredentialStatus, HealthReport } from "@bookr/shared";
import type { ServiceContext } from "./context.ts";

/**
 * Build the health surface of the application.
 *
 * @param ctx - The service context.
 * @param schedulerRunning - Reports whether the scheduler loop is active.
 * @returns An object exposing `status()`.
 */
export function createHealthService(
  ctx: ServiceContext,
  schedulerRunning: () => boolean,
): { status(): HealthReport } {
  return {
    status: (): HealthReport => {
      const providers = [...ctx.providers.keys()].map((provider): CredentialStatus => {
        const session = ctx.repository.sessions.get(provider);
        const state = session?.state ?? "missing";
        return {
          provider,
          sessionState: state,
          expiresAt: session?.expiresAt,
          needsAttention: state !== "active",
        };
      });
      return {
        ok: providers.every((p) => !p.needsAttention),
        lastPassAt: ctx.runtime.lastPassAt,
        schedulerRunning: schedulerRunning(),
        providers,
      };
    },
  };
}
