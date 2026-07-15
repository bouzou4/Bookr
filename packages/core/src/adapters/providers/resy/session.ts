/**
 * The provider-specific blob Resy stores inside a shared {@link Session}. It carries the current
 * access token, the long-lived refresh token, the resolved web api_key, and the account flags and
 * payment method captured from the profile endpoint so later passes and bookings can reuse them.
 *
 * @packageDocumentation
 */

import type { Session } from "@bookr/shared";

/** A single stored Resy payment method, as returned by the profile endpoint. */
export interface ResyPaymentMethod {
  /** Numeric payment-method id used when a venue requires a card at booking. */
  id: number;
  /** Card family, e.g. `"amex"` — used to prefer the American Express card for perks. */
  type?: string;
  /** Human-friendly display fragment (typically the last digits). */
  display?: string;
}

/** The Resy-specific contents of {@link Session.data}. */
export interface ResySessionData {
  /** Short-lived JWT sent as both `X-Resy-Auth-Token` and `X-Resy-Universal-Auth`. */
  token: string;
  /** Long-lived `production_refresh_token` captured from a `Set-Cookie`, used to renew `token`. */
  refreshToken?: string;
  /** The web api_key in force; may be self-healed from resy.com if the baked-in key is rejected. */
  apiKey: string;
  /** Account guest id from the profile endpoint. */
  guestId?: number;
  /** Preferred payment-method id (the American Express card when present). */
  paymentMethodId?: number;
  /** All payment methods on the account. */
  paymentMethods?: ResyPaymentMethod[];
  /** Whether the account holds Global Dining Access (Amex Platinum). */
  globalDiningAccess?: boolean;
  /** Whether the account is eligible for Platinum Night inventory. */
  platinumNightEligible?: boolean;
  /** Whether the account is flagged `is_rga`. */
  rga?: boolean;
  /** Raw feature-flag map from the profile endpoint, retained for diagnostics. */
  featureFlags?: unknown;
}

/**
 * Read and validate the Resy blob out of a shared session.
 *
 * @param session - The session whose `data` holds a {@link ResySessionData}.
 * @returns The typed Resy session data.
 * @throws An Error if the session carries no usable Resy access token.
 */
export function readResySessionData(session: Session): ResySessionData {
  const data = session.data as Partial<ResySessionData> | undefined;
  if (!data || typeof data.token !== "string" || data.token.length === 0) {
    throw new Error("Resy session is missing an access token");
  }
  return {
    token: data.token,
    refreshToken: data.refreshToken,
    apiKey: typeof data.apiKey === "string" ? data.apiKey : "",
    guestId: data.guestId,
    paymentMethodId: data.paymentMethodId,
    paymentMethods: data.paymentMethods,
    globalDiningAccess: data.globalDiningAccess,
    platinumNightEligible: data.platinumNightEligible,
    rga: data.rga,
    featureFlags: data.featureFlags,
  };
}
