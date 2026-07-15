/**
 * Environment-variable-backed {@link CredentialsProvider}.
 *
 * @packageDocumentation
 */

import type { ProviderCredentials, ProviderName } from "@bookr/shared";
import type { CredentialsProvider, SecretName } from "../../ports/credentials-provider.ts";

/**
 * Maps a {@link SecretName} to the environment variable that carries it.
 * Exported so other adapters and tests can stay in sync with the naming convention without
 * duplicating the table.
 */
export const SECRET_ENV_VARS: Record<SecretName, string> = {
  apprise_key: "APPRISE_KEY",
  ingest_token: "INGEST_TOKEN",
  ui_password: "UI_PASSWORD",
  session_secret: "SESSION_SECRET",
};

/**
 * Builds the environment variable name holding a provider credential field, e.g.
 * `CRED_RESY_USERNAME`.
 *
 * @param provider - The booking provider.
 * @param field - Which credential field (`USERNAME`, `PASSWORD`, or `API_KEY`).
 * @returns The env var name to look up.
 */
function credentialEnvVar(provider: ProviderName, field: "USERNAME" | "PASSWORD" | "API_KEY"): string {
  return `CRED_${provider.toUpperCase()}_${field}`;
}

/**
 * Supplies credentials and secrets read directly from a plain environment record
 * (`CRED_<PROVIDER>_USERNAME|PASSWORD|API_KEY` for booking-provider credentials; a fixed
 * env var per named application secret). Zero external dependencies — this is the default
 * credentials backend and the one always available in a fresh deployment.
 */
export class EnvCredentialsProvider implements CredentialsProvider {
  private readonly env: Record<string, string | undefined>;

  /**
   * @param env - The environment record to read from (typically `process.env`, injected so
   *   tests never depend on the real process environment).
   */
  constructor(env: Record<string, string | undefined>) {
    this.env = env;
  }

  /** No one-time setup is needed for this backend; resolves immediately. */
  async init(): Promise<void> {
    // Nothing to initialise: values are read on demand directly from the env record.
  }

  /**
   * Reads `CRED_<PROVIDER>_USERNAME`, `CRED_<PROVIDER>_PASSWORD`, and `CRED_<PROVIDER>_API_KEY`
   * for the given provider. Fields absent from the environment are omitted from the result.
   *
   * @param provider - The provider whose credentials are needed.
   * @returns The provider's credentials (an empty object if none are configured).
   */
  async getProviderCredentials(provider: ProviderName): Promise<ProviderCredentials> {
    const creds: ProviderCredentials = {};
    const username = this.env[credentialEnvVar(provider, "USERNAME")];
    const password = this.env[credentialEnvVar(provider, "PASSWORD")];
    const apiKey = this.env[credentialEnvVar(provider, "API_KEY")];
    if (username !== undefined) creds.username = username;
    if (password !== undefined) creds.password = password;
    if (apiKey !== undefined) creds.apiKey = apiKey;
    return creds;
  }

  /**
   * Reads the environment variable mapped to the named secret (see {@link SECRET_ENV_VARS}).
   *
   * @param name - Which secret to fetch.
   * @returns The secret value, or undefined if the env var is unset.
   */
  async getSecret(name: SecretName): Promise<string | undefined> {
    return this.env[SECRET_ENV_VARS[name]];
  }
}
