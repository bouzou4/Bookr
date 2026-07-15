/**
 * Error types shared across the core and its adapters.
 *
 * @packageDocumentation
 */

import type { ErrorClass } from "@bookr/shared";

/** Thrown when a provider is asked to do something it does not support, such as booking. */
export class NotSupportedError extends Error {
  /**
   * @param message - What was unsupported.
   */
  constructor(message: string) {
    super(message);
    this.name = "NotSupportedError";
  }
}

/** Options for constructing a {@link ProviderError}. */
export interface ProviderErrorOptions {
  /** Whether retrying the operation could succeed. Defaults by error class. */
  retryable?: boolean;
  /** Extra human-readable context (never secrets). */
  detail?: string;
  /** The underlying error, preserved as the cause. */
  cause?: unknown;
}

/** A provider failure carrying a normalised {@link ErrorClass} so callers branch without string-matching. */
export class ProviderError extends Error {
  /** Normalised failure category. */
  readonly errorClass: ErrorClass;
  /** Whether retrying could succeed. */
  readonly retryable: boolean;
  /** Optional extra context. */
  readonly detail?: string;

  /**
   * @param errorClass - The normalised failure category.
   * @param message - Human-readable summary.
   * @param options - Retryability, detail, and the underlying cause.
   */
  constructor(errorClass: ErrorClass, message: string, options: ProviderErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "ProviderError";
    this.errorClass = errorClass;
    this.retryable = options.retryable ?? (errorClass === "rate-limited");
    this.detail = options.detail;
  }
}
