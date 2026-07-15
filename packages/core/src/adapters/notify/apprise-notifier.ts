/**
 * Notifier adapter backed by a self-hosted apprise-api instance.
 *
 * apprise-api fans a single notification request out to whatever concrete channel URLs
 * (Twilio voice, Twilio SMS, SMTP, …) are registered under a config key. This adapter never
 * talks to Twilio/SMTP/etc. directly — it only knows the apprise HTTP contract and the
 * severity → channel-tag policy described in the module's design notes.
 *
 * @packageDocumentation
 */

import type { Severity } from "@bookr/shared";
import type { NotificationMessage, Notifier } from "../../ports/notifier.ts";

/** Location and identity of the apprise-api instance to notify through. */
export interface AppriseConfig {
  /** Base URL of the apprise-api server, e.g. `http://172.25.0.17:8000`. No trailing slash required. */
  url: string;
  /** The apprise config key under which the notification target URLs are registered. */
  key: string;
}

/**
 * Optional collaborators for {@link AppriseNotifier}, primarily so tests can inject a mock
 * `fetch` and capture log output instead of writing to the console.
 */
export interface AppriseNotifierOptions {
  /** HTTP client used for the POST requests. Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Sink for loud failure logging. Defaults to `console.error`. */
  logger?: (message: string, detail?: unknown) => void;
}

/** Apprise's `type` field, which controls the icon/color apprise-compatible targets render. */
type AppriseNotifyType = "info" | "success" | "warning" | "failure";

/** Body shape POSTed to `{APPRISE_URL}/notify/{key}`. */
interface ApprisePayload {
  /** Notification headline. */
  title: string;
  /** Notification body, already formatted for the target channel(s). */
  body: string;
  /** Apprise severity/type used for rendering. */
  type: AppriseNotifyType;
  /** Comma/space-separated apprise tag expression selecting which registered URLs fire. */
  tag: string;
  /** Body format apprise should treat the payload as. */
  format: "text";
}

/** TwiML `<Say>` bodies are rejected by Twilio above this length. */
const MAX_TWIML_LENGTH = 4000;
/** Carrier-level SMS segment limit; apprise does not split long bodies for us. */
const MAX_SMS_LENGTH = 160;

/**
 * Notifier that delivers Bookr alerts through apprise-api, routing severities to channel tags:
 *
 * - `urgent` (a slot was found): two POSTs — a `tag: "call"` request whose body is a TwiML
 *   `<Response><Say>…</Say></Response>` wrapper, and a `tag: "sms, email"` request with a
 *   plain-text body that includes the deep link.
 * - `warning` (auth/operational problem): one `tag: "email"` POST.
 * - `info`: suppressed entirely — no request is sent.
 *
 * A non-2xx or network-failing response is logged loudly and swallowed: a notification
 * delivery failure must never interrupt or fail the scan pass that triggered it.
 */
export class AppriseNotifier implements Notifier {
  private readonly baseUrl: string;
  private readonly key: string;
  private readonly fetchImpl: typeof fetch;
  private readonly logger: (message: string, detail?: unknown) => void;

  /**
   * @param config - Apprise base URL and config key (typically `config.apprise` from
   *   `@bookr/shared`'s `loadConfig`).
   * @param options - Optional fetch/logger overrides, primarily for tests.
   */
  constructor(config: AppriseConfig, options: AppriseNotifierOptions = {}) {
    this.baseUrl = config.url.replace(/\/+$/, "");
    this.key = config.key;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.logger = options.logger ?? defaultLogger;
  }

  /**
   * Deliver (or suppress) an alert according to its severity.
   *
   * @param severity - How urgent the alert is.
   * @param message - The alert content.
   */
  async notify(severity: Severity, message: NotificationMessage): Promise<void> {
    switch (severity) {
      case "urgent":
        await this.post({
          title: message.title,
          body: buildTwiml(message),
          type: "failure",
          tag: "call",
          format: "text",
        });
        await this.post({
          title: message.title,
          body: buildPlainBody(message, MAX_SMS_LENGTH),
          type: "warning",
          tag: "sms, email",
          format: "text",
        });
        return;
      case "warning":
        await this.post({
          title: message.title,
          body: buildPlainBody(message),
          type: "warning",
          tag: "email",
          format: "text",
        });
        return;
      case "info":
        // Suppressed: informational alerts have no channel today (future digest candidate).
        return;
    }
  }

  /**
   * POST a single notification payload to apprise-api, logging loudly instead of throwing.
   *
   * @param payload - The apprise request body.
   */
  private async post(payload: ApprisePayload): Promise<void> {
    const url = `${this.baseUrl}/notify/${this.key}`;
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      this.logger(`apprise notify request failed (tag="${payload.tag}")`, err);
      return;
    }
    if (!response.ok) {
      const detail = await safeReadText(response);
      this.logger(`apprise notify returned ${response.status} (tag="${payload.tag}")`, detail);
    }
  }
}

/** Default logger: writes loudly to stderr via `console.error`. */
function defaultLogger(message: string, detail?: unknown): void {
  console.error(`[apprise-notifier] ${message}`, detail ?? "");
}

/**
 * Best-effort read of a response body for logging; never throws even if the body has already
 * been consumed or the connection dropped mid-read.
 *
 * @param response - The apprise HTTP response.
 * @returns The response body text, or a placeholder if it could not be read.
 */
async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "<unreadable response body>";
  }
}

/**
 * Escape the characters XML forbids in text content so slot titles/venue names can never break
 * the TwiML document structure.
 *
 * @param value - Raw text to embed inside an XML element.
 * @returns The value with `& < > " '` replaced by their XML entities.
 */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Build the spoken message for the `call` channel: a TwiML document wrapping the alert in a
 * `<Say>` verb, truncated to Twilio's length limit. The deep link is deliberately omitted —
 * it is not useful read aloud — and is left to the paired sms/email POST.
 *
 * @param message - The alert content.
 * @returns A `<Response><Say>…</Say></Response>` document, ≤4000 characters.
 */
function buildTwiml(message: NotificationMessage): string {
  const spoken = `${message.title}. ${message.body}`;
  const budget = MAX_TWIML_LENGTH - "<Response><Say></Say></Response>".length;
  const truncated = spoken.length > budget ? `${spoken.slice(0, Math.max(0, budget - 1))}…` : spoken;
  return `<Response><Say>${escapeXml(truncated)}</Say></Response>`;
}

/**
 * Build the plain-text message for sms/email (or email-only) channels: `"title: body"` with
 * the deep link appended when present.
 *
 * @param message - The alert content.
 * @param maxLength - Optional hard length cap (used for the SMS-bearing `sms, email` tag);
 *   omitted for the email-only `warning` path, which has no carrier segment limit.
 * @returns The plain-text body.
 */
function buildPlainBody(message: NotificationMessage, maxLength?: number): string {
  const withLink = message.link ? `${message.title}: ${message.body} — ${message.link}` : `${message.title}: ${message.body}`;
  if (maxLength === undefined || withLink.length <= maxLength) return withLink;
  return `${withLink.slice(0, Math.max(0, maxLength - 1))}…`;
}
