/**
 * Activity log access: a thin read surface over the repository's audit trail, newest first.
 *
 * @packageDocumentation
 */

import type { ActivityEvent } from "@bookr/shared";
import type { ActivityQuery } from "../ports/repository.ts";
import type { ServiceContext } from "./context.ts";

/**
 * Build the activity surface of the application.
 *
 * @param ctx - The service context.
 * @returns An object exposing `recent(query?)`.
 */
export function createActivityService(ctx: ServiceContext): {
  recent(query?: ActivityQuery): ActivityEvent[];
} {
  return {
    recent: (query?: ActivityQuery): ActivityEvent[] => ctx.repository.activity.recent(query),
  };
}
