/**
 * Watch management: turning validated input into stored {@link Watch} records with generated ids
 * and timestamps, and applying partial updates. All persistence goes through the injected
 * {@link Repository}.
 *
 * @packageDocumentation
 */

import type { Watch, WatchInput, WatchUpdate } from "@bookr/shared";
import type { WatchApi } from "../ports/bookr-app.ts";
import type { ServiceContext } from "./context.ts";

/** The runtime's Web Crypto implementation, if present (Node 19+, modern browsers). */
const webCrypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;

function generateId(): string {
  if (webCrypto?.randomUUID) return webCrypto.randomUUID();
  return `w_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function requireWatch(ctx: ServiceContext, id: string): Watch {
  const watch = ctx.repository.watches.get(id);
  if (!watch) throw new Error(`watch not found: ${id}`);
  return watch;
}

/**
 * Build the watch-management surface of the application.
 *
 * @param ctx - The service context.
 * @returns The {@link WatchApi} implementation.
 */
export function createWatchService(ctx: ServiceContext): WatchApi {
  return {
    list: () => ctx.repository.watches.list(),
    get: (id) => ctx.repository.watches.get(id),
    create: (input: WatchInput): Watch => {
      const at = ctx.clock.now().toISOString();
      const watch: Watch = { id: generateId(), ...input, createdAt: at, updatedAt: at };
      return ctx.repository.watches.create(watch);
    },
    update: (id: string, patch: WatchUpdate): Watch => {
      const existing = requireWatch(ctx, id);
      const updated: Watch = { ...existing, ...patch, id, updatedAt: ctx.clock.now().toISOString() };
      return ctx.repository.watches.update(updated);
    },
    remove: (id: string): void => {
      ctx.repository.watches.remove(id);
    },
    setEnabled: (id: string, enabled: boolean): Watch => {
      const existing = requireWatch(ctx, id);
      const updated: Watch = { ...existing, enabled, updatedAt: ctx.clock.now().toISOString() };
      return ctx.repository.watches.update(updated);
    },
  };
}
