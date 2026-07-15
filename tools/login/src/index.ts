/**
 * Public exports of the login-capture tool's testable logic: session extraction and the
 * ingest push. The browser-driving entrypoint (`run.ts`) is intentionally not re-exported here —
 * it depends on Playwright and a real display, and is invoked directly as the package's `start`
 * script rather than imported.
 *
 * @packageDocumentation
 */

export * from "./resy.ts";
export * from "./push.ts";
