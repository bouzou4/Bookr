import type { NotificationMessage, Notifier, NotifyResult } from "@bookr/core";
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
  /** When set, `notify` reports this delivery failure instead of success (to exercise failure paths). */
  failWith: string | undefined;

  /**
   * Record a notification.
   *
   * @param severity - The severity.
   * @param message - The message content.
   * @returns A successful delivery result, or a failure when {@link FakeNotifier.failWith} is set.
   */
  async notify(severity: Severity, message: NotificationMessage): Promise<NotifyResult> {
    this.sent.push({ severity, message });
    return this.failWith ? { delivered: false, detail: this.failWith } : { delivered: true };
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
