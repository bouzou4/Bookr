import type { Severity } from "@bookr/shared";

/** A single alert to deliver. */
export interface NotificationMessage {
  /** Short headline. */
  title: string;
  /** Body text. */
  body: string;
  /** Optional deep link to include. */
  link?: string;
}

/**
 * Outcome of a delivery attempt. A notifier never throws — a delivery failure must not fail the
 * scan pass that triggered it — so it reports success through this result instead, letting the
 * caller record and count a missed alert rather than silently assuming it landed.
 */
export interface NotifyResult {
  /** True if the alert reached at least one channel. A severity with no channel (e.g. `info`) is `true`. */
  delivered: boolean;
  /** Human-readable detail when delivery failed or was partial; omitted on full success. */
  detail?: string;
}

/**
 * Delivers alerts. The implementation decides how each {@link Severity} maps to concrete
 * channels (e.g. phone call + SMS + email for urgent, email only for warnings).
 */
export interface Notifier {
  /**
   * Send an alert at a given severity. Resolves with a {@link NotifyResult} rather than throwing,
   * so a delivery failure never aborts the caller.
   *
   * @param severity - How urgent the alert is.
   * @param message - The alert content.
   * @returns Whether the alert was delivered.
   */
  notify(severity: Severity, message: NotificationMessage): Promise<NotifyResult>;
}
