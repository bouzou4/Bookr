/**
 * The `/api` router: the frozen REST surface mapped one-to-one onto {@link BookrApp}. Request
 * bodies are validated with the shared zod schemas before any application call. Unauthenticated
 * routes (login, health) and the bearer-guarded ingest route are mounted ahead of the
 * cookie-session guard; everything after the guard requires a logged-in session.
 *
 * @packageDocumentation
 */

import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import type { BookrApp } from "@bookr/core";
import {
  availabilityCheckSchema,
  bookRequestSchema,
  ingestSchema,
  loginSchema,
  providerNameSchema,
  screeningsRequestSchema,
  seatMapRequestSchema,
  seatPrefGetSchema,
  seatPrefPutSchema,
  venueResolveSchema,
  watchInputSchema,
  watchUpdateSchema,
  type ActivityType,
} from "@bookr/shared";
import { z } from "zod";
import type { ServerConfig } from "./config.ts";
import { requireBearer, requireSession, safeEqual } from "./security.ts";

/** Login attempts allowed per IP within {@link LOGIN_WINDOW_MS}. */
const LOGIN_MAX = 5;
/** Login rate-limit window (15 minutes). */
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
/** Ingest requests allowed per IP within {@link INGEST_WINDOW_MS}. */
const INGEST_MAX = 30;
/** Ingest rate-limit window (1 minute). */
const INGEST_WINDOW_MS = 60 * 1000;

/**
 * Validate a request body against a schema, sending `400` with the issues when it fails.
 *
 * @param schema - The zod schema to parse against.
 * @param req - The incoming request.
 * @param res - The response used to report a validation failure.
 * @returns The parsed value, or `undefined` when a `400` has already been sent.
 */
function parseBody<S extends z.ZodTypeAny>(
  schema: S,
  req: Request,
  res: Response,
): z.infer<S> | undefined {
  const result = schema.safeParse(req.body);
  if (result.success) return result.data;
  res.status(400).json({ error: "invalid request body", issues: result.error.issues });
  return undefined;
}

/** Query schema for the activity feed (`?limit=&type=`). */
const activityQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(500).optional(),
  type: z
    .enum([
      "slot-found",
      "notified",
      "booked",
      "cancelled",
      "book-failed",
      "auth-challenged",
      "session-ingested",
      "notify-failed",
      "error",
      "pass-complete",
    ])
    .optional(),
});

/**
 * Build the `/api` router over an application instance.
 *
 * @param app - The application surface every route delegates to.
 * @param config - Server configuration providing the dashboard password and ingest token.
 * @returns The configured Express router.
 */
export function createApiRouter(app: BookrApp, config: ServerConfig): Router {
  const router = Router();

  const loginLimiter = rateLimit({
    windowMs: LOGIN_WINDOW_MS,
    limit: LOGIN_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "too many login attempts, try again later" },
  });

  const ingestLimiter = rateLimit({
    windowMs: INGEST_WINDOW_MS,
    limit: INGEST_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "too many ingest attempts, try again later" },
  });

  // ── Unauthenticated ──────────────────────────────────────────────────────
  // Liveness only. Per-provider session state/expiry is sensitive and stays behind the session
  // guard (see GET /credentials); this endpoint exposes just enough for a load balancer/healthcheck.
  router.get("/health", (_req, res) => {
    const { ok, lastPassAt, schedulerRunning } = app.health.status();
    res.json({ ok, lastPassAt, schedulerRunning });
  });

  router.post("/auth/login", loginLimiter, (req, res) => {
    const body = parseBody(loginSchema, req, res);
    if (!body) return;
    if (!safeEqual(config.uiPassword, body.password)) {
      res.status(401).json({ error: "invalid password" });
      return;
    }
    req.session.regenerate((err) => {
      if (err) {
        res.status(500).json({ error: "session error" });
        return;
      }
      req.session.authenticated = true;
      res.json({ ok: true });
    });
  });

  router.post("/auth/logout", (req, res) => {
    req.session.destroy(() => {
      res.json({ ok: true });
    });
  });

  // ── Bearer-guarded (NOT cookie-authenticated) ────────────────────────────
  router.post("/ingest/:provider", ingestLimiter, requireBearer(config.ingestToken), async (req, res) => {
    const provider = providerNameSchema.safeParse(req.params.provider);
    if (!provider.success) {
      res.status(404).json({ error: "unknown provider" });
      return;
    }
    const body = parseBody(ingestSchema, req, res);
    if (!body) return;
    await app.credentials.ingestSession(provider.data, body.session);
    res.json({ ok: true });
  });

  // ── Cookie-session guard: everything below requires a logged-in operator ──
  router.use(requireSession());

  // Watches.
  router.get("/watches", (_req, res) => {
    res.json(app.watches.list());
  });

  router.post("/watches", (req, res) => {
    const body = parseBody(watchInputSchema, req, res);
    if (!body) return;
    res.status(201).json(app.watches.create(body));
  });

  router.get("/watches/:id", (req, res) => {
    const watch = app.watches.get(req.params.id);
    if (!watch) {
      res.status(404).json({ error: "watch not found" });
      return;
    }
    res.json(watch);
  });

  router.put("/watches/:id", (req, res) => {
    if (!app.watches.get(req.params.id)) {
      res.status(404).json({ error: "watch not found" });
      return;
    }
    const body = parseBody(watchUpdateSchema, req, res);
    if (!body) return;
    res.json(app.watches.update(req.params.id, body));
  });

  router.delete("/watches/:id", (req, res) => {
    if (!app.watches.get(req.params.id)) {
      res.status(404).json({ error: "watch not found" });
      return;
    }
    app.watches.remove(req.params.id);
    res.status(204).end();
  });

  router.post("/watches/:id/scan", async (req, res) => {
    if (!app.watches.get(req.params.id)) {
      res.status(404).json({ error: "watch not found" });
      return;
    }
    res.json(await app.scan.runOnce(req.params.id));
  });

  router.post("/scan", async (_req, res) => {
    res.json(await app.scan.runOnce());
  });

  // Availability & venues.
  router.post("/availability/check", async (req, res) => {
    const body = parseBody(availabilityCheckSchema, req, res);
    if (!body) return;
    res.json(await app.availability.check(body));
  });

  router.post("/venues/resolve", async (req, res) => {
    const body = parseBody(venueResolveSchema, req, res);
    if (!body) return;
    res.json(await app.venues.resolve(body.query, body.provider));
  });

  // Screenings (what a venue is showing on a date) — backs the movie/showtime picker.
  router.get("/screenings", async (req, res) => {
    const query = screeningsRequestSchema.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: "invalid query", issues: query.error.issues });
      return;
    }
    res.json(await app.seating.screenings(query.data.provider, query.data.venueId, query.data.date));
  });

  // Seat maps & per-theater acceptable-seat preferences.
  router.post("/seatmap", async (req, res) => {
    const body = parseBody(seatMapRequestSchema, req, res);
    if (!body) return;
    res.json(await app.seating.map(body.provider, body.ref));
  });

  router.get("/seat-prefs", (req, res) => {
    const query = seatPrefGetSchema.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: "invalid query", issues: query.error.issues });
      return;
    }
    const entry = app.seating.getPrefs(query.data.provider, query.data.venueId, query.data.layoutKey);
    if (!entry) {
      res.status(404).json({ error: "no seat preferences for this layout" });
      return;
    }
    res.json(entry);
  });

  router.put("/seat-prefs", (req, res) => {
    const body = parseBody(seatPrefPutSchema, req, res);
    if (!body) return;
    res.json(app.seating.putPrefs(body.provider, body.venueId, body.layoutKey, body.seats));
  });

  // Activity & credentials.
  router.get("/activity", (req, res) => {
    const query = activityQuerySchema.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: "invalid query", issues: query.error.issues });
      return;
    }
    res.json(app.activity.recent(query.data as { limit?: number; type?: ActivityType }));
  });

  router.get("/credentials", async (_req, res) => {
    res.json(await app.credentials.status());
  });

  // Booking — gated on the watch's autobook flag.
  router.post("/book", async (req, res) => {
    const body = parseBody(bookRequestSchema, req, res);
    if (!body) return;
    const watch = app.watches.get(body.watchId);
    if (!watch) {
      res.status(404).json({ error: "watch not found" });
      return;
    }
    if (!watch.autobook) {
      res.status(403).json({ error: "auto-booking is disabled for this watch" });
      return;
    }
    res.json(await app.booking.book(body.watchId, body.dedupeKey));
  });

  // Unknown API route.
  router.use((_req, res) => {
    res.status(404).json({ error: "not found" });
  });

  return router;
}
