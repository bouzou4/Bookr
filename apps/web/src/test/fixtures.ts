import type {
  ActivityEvent,
  CredentialStatus,
  HealthReport,
  ScanReport,
  Watch,
} from "@bookr/shared";

/** Sample watch reused across tests and default msw handlers. */
export const sampleWatch: Watch = {
  id: "w1",
  provider: "resy",
  label: "Carbone Friday",
  venue: { id: "1234", slug: "carbone-ny" },
  resourceType: "table",
  partySize: 2,
  dateRange: { rollingDays: 14 },
  timeWindow: { start: "18:00", end: "21:00" },
  timezone: "America/New_York",
  autobook: false,
  enabled: true,
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
};

/** Sample activity event reused across tests and default msw handlers. */
export const sampleActivityEvent: ActivityEvent = {
  id: 1,
  at: "2026-07-13T10:00:00.000Z",
  type: "slot-found",
  provider: "resy",
  watchId: "w1",
  detail: "Table for 2 at 19:00",
};

/** Sample per-provider credential status reused across tests and default msw handlers. */
export const sampleCredentialStatus: CredentialStatus = {
  provider: "resy",
  sessionState: "active",
  expiresAt: "2026-08-01T00:00:00.000Z",
  needsAttention: false,
};

/** Sample health report reused across tests and default msw handlers. */
export const sampleHealth: HealthReport = {
  ok: true,
  lastPassAt: "2026-07-13T09:59:00.000Z",
  schedulerRunning: true,
  providers: [sampleCredentialStatus],
};

/** Sample scan report reused across tests and default msw handlers. */
export const sampleScanReport: ScanReport = {
  startedAt: "2026-07-13T10:00:00.000Z",
  finishedAt: "2026-07-13T10:00:05.000Z",
  watchesScanned: 1,
  newSlots: 0,
  notified: 0,
  booked: 0,
  errors: [],
};
