import { describe, expect, it } from "vitest";
import { NotSupportedError, ProviderError } from "./errors.ts";

describe("NotSupportedError", () => {
  it("carries its name and message", () => {
    const err = new NotSupportedError("booking not supported");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("NotSupportedError");
    expect(err.message).toBe("booking not supported");
  });
});

describe("ProviderError", () => {
  it("defaults retryable to true only for rate-limited", () => {
    expect(new ProviderError("rate-limited", "slow down").retryable).toBe(true);
    expect(new ProviderError("challenged", "captcha").retryable).toBe(false);
  });

  it("honours an explicit retryable override and detail", () => {
    const err = new ProviderError("other", "boom", { retryable: true, detail: "context" });
    expect(err.retryable).toBe(true);
    expect(err.detail).toBe("context");
    expect(err.errorClass).toBe("other");
  });

  it("preserves the underlying cause", () => {
    const cause = new Error("root");
    const err = new ProviderError("auth-expired", "token dead", { cause });
    expect(err.cause).toBe(cause);
  });
});
