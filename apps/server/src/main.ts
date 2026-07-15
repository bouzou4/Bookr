/**
 * Production entry point. It obtains the wired application from {@link bootstrap}, builds the
 * Express app with {@link createServer}, starts listening, and starts the polling scheduler — the
 * poller and the dashboard share this one process. It also installs signal and last-resort
 * error handlers so a redeploy drains cleanly and a stray fault cannot leave a half-dead process
 * serving traffic. All composition lives behind `bootstrap`, keeping this file a thin shell.
 *
 * @packageDocumentation
 */

import { bootstrap } from "./bootstrap.ts";
import { createServer } from "./server.ts";

/** Default listen port when the bootstrapped configuration omits one. */
const DEFAULT_PORT = 8080;

/** How long to wait for in-flight connections to drain before forcing exit on shutdown. */
const SHUTDOWN_GRACE_MS = 10_000;

/**
 * Start the HTTP server and the scheduler, and wire graceful shutdown.
 *
 * @returns Resolves once the listener is bound and the scheduler has started.
 */
export async function main(): Promise<void> {
  const { app, config } = await bootstrap();
  const server = createServer(app, config);
  const port = Number(process.env.PORT ?? DEFAULT_PORT);

  const listener = server.listen(port, () => {
    console.log(`bookr server listening on :${port}`);
    // Begin polling only once we are accepting traffic, so the scanner and dashboard come up together.
    app.scheduler.start();
  });

  let shuttingDown = false;
  const shutdown = (reason: string, code: number): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[server] ${reason}: stopping scheduler and draining connections`);
    app.scheduler.stop();
    listener.close(() => process.exit(code));
    // Failsafe so a connection that refuses to drain never hangs a redeploy indefinitely.
    setTimeout(() => process.exit(code), SHUTDOWN_GRACE_MS).unref();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM", 0));
  process.on("SIGINT", () => shutdown("SIGINT", 0));
  // A rejection with no handler is logged, not fatal: the scheduler guards its own passes, and
  // crashing here would sever an in-flight booking request for an unrelated stray promise.
  process.on("unhandledRejection", (reason) => {
    console.error("[server] unhandled promise rejection", reason);
  });
  // An uncaught exception leaves the process in an undefined state; drain and exit non-zero so the
  // container supervisor restarts it cleanly rather than serving from a corrupted event loop.
  process.on("uncaughtException", (err) => {
    console.error("[server] uncaught exception", err);
    shutdown("uncaught exception", 1);
  });
}

main().catch((err: unknown) => {
  console.error("[server] failed to start", err);
  process.exit(1);
});
