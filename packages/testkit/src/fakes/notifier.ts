import type { NotificationMessage, Notifier } from "@bookr/core";
import type { Severity } from "@bookr/shared";

/** A single captured notification. */
export interface SentNotification {
  /** The severity it was sent at. */
  severity: Severity;
  /** The message content. */
  message: NotificationMessage;
}

/** A {@link Notifier} that records every notification instead of delivering it. */
export class FakeNotifier implements Notifier {
  /** Every notification sent, in order. */
  readonly sent: SentNotification[] = [];

  /**
   * Record a notification.
   *
   * @param severity - The severity.
   * @param message - The message content.
   */
  async notify(severity: Severity, message: NotificationMessage): Promise<void> {
    this.sent.push({ severity, message });
  }

  /**
   * Filter recorded notifications by severity.
   *
   * @param severity - The severity to match.
   * @returns The matching messages, in order.
   */
  bySeverity(severity: Severity): NotificationMessage[] {
    return this.sent.filter((n) => n.severity === severity).map((n) => n.message);
  }
}
