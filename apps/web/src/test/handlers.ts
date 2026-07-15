import { HttpResponse, http } from "msw";
import {
  sampleActivityEvent,
  sampleCredentialStatus,
  sampleHealth,
  sampleScanReport,
  sampleWatch,
} from "./fixtures.ts";

/** Default (happy-path) msw request handlers for every route the dashboard calls. */
export const handlers = [
  http.get("/api/watches", () => HttpResponse.json([sampleWatch])),

  http.post("/api/watches", async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json(
      { ...sampleWatch, ...body, id: "w2", createdAt: sampleWatch.createdAt, updatedAt: sampleWatch.updatedAt },
      { status: 201 },
    );
  }),

  http.get("/api/watches/:id", ({ params }) => HttpResponse.json({ ...sampleWatch, id: params.id as string })),

  http.put("/api/watches/:id", async ({ request, params }) => {
    const body = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json({ ...sampleWatch, ...body, id: params.id as string });
  }),

  http.delete("/api/watches/:id", () => new HttpResponse(null, { status: 204 })),

  http.post("/api/watches/:id/scan", () => HttpResponse.json(sampleScanReport)),
  http.post("/api/scan", () => HttpResponse.json(sampleScanReport)),

  http.post("/api/availability/check", () => HttpResponse.json([])),
  http.post("/api/venues/resolve", () => HttpResponse.json([])),

  http.get("/api/activity", () => HttpResponse.json([sampleActivityEvent])),

  http.get("/api/credentials", () => HttpResponse.json([sampleCredentialStatus])),
  http.post("/api/ingest/:provider", () => new HttpResponse(null, { status: 200 })),

  http.post("/api/book", () =>
    HttpResponse.json({ status: "booked", confirmationId: "conf-1", deepLink: "https://example.com/r" }),
  ),

  http.get("/api/health", () => HttpResponse.json(sampleHealth)),

  http.post("/api/auth/login", async ({ request }) => {
    const body = (await request.json()) as { password?: string };
    if (body.password === "correct-password") return new HttpResponse(null, { status: 200 });
    return HttpResponse.json({ error: "invalid password" }, { status: 401 });
  }),
  http.post("/api/auth/logout", () => new HttpResponse(null, { status: 200 })),
];
