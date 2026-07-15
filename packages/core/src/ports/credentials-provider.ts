import type { ProviderCredentials, ProviderName } from "@bookr/shared";

/** Named application secrets a {@link CredentialsProvider} can supply. */
export type SecretName = "apprise_key" | "ingest_token" | "ui_password" | "session_secret";

/**
 * Supplies credentials and secrets to the core from a configurable backend (environment
 * variables, a secrets vault, …), so no secret material is hard-coded.
 */
export interface CredentialsProvider {
  /** Perform any one-time setup (e.g. unlock a vault). */
  init(): Promise<void>;

  /**
   * Fetch the credentials for a booking provider.
   *
   * @param provider - The provider whose credentials are needed.
   * @returns The provider's credentials.
   */
  getProviderCredentials(provider: ProviderName): Promise<ProviderCredentials>;

  /**
   * Fetch a named application secret.
   *
   * @param name - Which secret to fetch.
   * @returns The secret value, or undefined if unset.
   */
  getSecret(name: SecretName): Promise<string | undefined>;
}
