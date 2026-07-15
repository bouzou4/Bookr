import type { CredentialsProvider, SecretName } from "@bookr/core";
import type { ProviderCredentials, ProviderName } from "@bookr/shared";

/** Scripted data for a {@link FakeCredentialsProvider}. */
export interface FakeCredentialsOptions {
  /** Credentials keyed by provider name. */
  credentials?: Partial<Record<ProviderName, ProviderCredentials>>;
  /** Secrets keyed by name. */
  secrets?: Partial<Record<SecretName, string>>;
}

/** An in-memory {@link CredentialsProvider} returning scripted credentials and secrets. */
export class FakeCredentialsProvider implements CredentialsProvider {
  /** Number of times {@link FakeCredentialsProvider.init} was called. */
  initialised = 0;

  private readonly options: FakeCredentialsOptions;

  /**
   * @param options - Scripted credentials and secrets.
   */
  constructor(options: FakeCredentialsOptions = {}) {
    this.options = options;
  }

  /** Record initialisation. */
  async init(): Promise<void> {
    this.initialised += 1;
  }

  /**
   * @param provider - The provider whose credentials are requested.
   * @returns The scripted credentials, or an empty object.
   */
  async getProviderCredentials(provider: ProviderName): Promise<ProviderCredentials> {
    return this.options.credentials?.[provider] ?? {};
  }

  /**
   * @param name - The secret name.
   * @returns The scripted secret, or undefined.
   */
  async getSecret(name: SecretName): Promise<string | undefined> {
    return this.options.secrets?.[name];
  }
}
