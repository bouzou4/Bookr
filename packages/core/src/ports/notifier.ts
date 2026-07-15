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
 * Delivers alerts. The implementation decides how each {@link Severity} maps to concrete
 * channels (e.g. phone call + SMS + email for urgent, email only for warnings).
 */
export interface Notifier {
  /**
   * Send an alert at a given severity.
   *
   * @param severity - How urgent the alert is.
   * @param message - The alert content.
   */
  notify(severity: Severity, message: NotificationMessage): Promise<void>;
}
