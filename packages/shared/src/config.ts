/**
 * Deployment configuration. Personal and environment-specific values live only here, never in
 * committed source; `loadConfig` parses a plain env record (typically `process.env`) into a
 * validated `Config`.
 *
 * @packageDocumentation
 */

import { z } from "zod";

const envSchema = z
  .object({
    PORT: z.coerce.number().int().positive().default(8080),
    PUBLIC_BASE_URL: z.string().url().default("http://localhost:8080"),
    POLL_INTERVAL_SECONDS: z.coerce.number().int().positive().default(60),
    POLL_JITTER_PCT: z.coerce.number().min(0).max(1).default(0.25),
    TRUST_PROXY: z.coerce.number().int().min(0).default(1),
    CREDENTIALS_PROVIDER: z.enum(["env", "vaultwarden"]).default("env"),
    APPRISE_URL: z.string().url().default("http://localhost:8000"),
    APPRISE_KEY: z.string().default("bookr"),
    INGEST_TOKEN: z.string().default(""),
    UI_PASSWORD: z.string().default(""),
    SESSION_SECRET: z.string().default(""),
    DATA_DIR: z.string().default("./data"),
    VW_SERVER: z.string().url().optional(),
    VW_FOLDER: z.string().optional(),
    VW_ITEM_PREFIX: z.string().optional(),
  })
  .superRefine((e, ctx) => {
    if (e.CREDENTIALS_PROVIDER === "vaultwarden" && !e.VW_SERVER) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["VW_SERVER"],
        message: "VW_SERVER is required when CREDENTIALS_PROVIDER=vaultwarden",
      });
    }
  })
  .transform((e) => ({
    port: e.PORT,
    publicBaseUrl: e.PUBLIC_BASE_URL,
    pollIntervalSeconds: e.POLL_INTERVAL_SECONDS,
    pollJitterPct: e.POLL_JITTER_PCT,
    trustProxy: e.TRUST_PROXY,
    credentialsProvider: e.CREDENTIALS_PROVIDER,
    apprise: { url: e.APPRISE_URL, key: e.APPRISE_KEY },
    ingestToken: e.INGEST_TOKEN,
    uiPassword: e.UI_PASSWORD,
    sessionSecret: e.SESSION_SECRET,
    dataDir: e.DATA_DIR,
    vaultwarden: e.VW_SERVER
      ? { server: e.VW_SERVER, folder: e.VW_FOLDER ?? "Bookr", itemPrefix: e.VW_ITEM_PREFIX }
      : undefined,
  }));

/** Validated, structured deployment configuration. */
export type Config = z.infer<typeof envSchema>;

/**
 * Parse and validate configuration from an environment record.
 *
 * @param env - A record of environment variables (typically `process.env`).
 * @returns The validated {@link Config}.
 * @throws A ZodError when required values are missing or malformed.
 */
export function loadConfig(env: Record<string, string | undefined>): Config {
  return envSchema.parse(env);
}
