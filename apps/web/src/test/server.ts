import { setupServer } from "msw/node";
import { handlers } from "./handlers.ts";

/** The shared msw server instance used by every test; started/stopped in `setup.ts`. */
export const server = setupServer(...handlers);
