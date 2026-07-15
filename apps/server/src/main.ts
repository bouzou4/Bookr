/**
 * Production entry point. It obtains the wired application from {@link bootstrap}, builds the
 * Express app with {@link createServer}, and starts listening. All composition lives behind
 * `bootstrap`, keeping this file a thin transport shell.
 *
 * @packageDocumentation
 */

import { bootstrap } from "./bootstrap.ts";
import { createServer } from "./server.ts";

/** Default listen port when the bootstrapped configuration omits one. */
const DEFAULT_PORT = 8080;

/**
 * Start the HTTP server.
 *
 * @returns Resolves once the listener is bound.
 */
export function main(): void {
  const { app, config } = bootstrap();
  const server = createServer(app, config);
  const port = Number(process.env.PORT ?? DEFAULT_PORT);
  server.listen(port, () => {
    console.log(`bookr server listening on :${port}`);
  });
}

main();
