/**
 * Selects and constructs the configured {@link CredentialsProvider} implementation.
 *
 * @packageDocumentation
 */

import type { Config } from "@bookr/shared";
import type { CredentialsProvider } from "../../ports/credentials-provider.ts";
import { createNodeCommandRunner, type CommandRunner } from "./command-runner.ts";
import { EnvCredentialsProvider } from "./env-credentials-provider.ts";
import { VaultwardenCredentialsProvider } from "./vaultwarden-credentials-provider.ts";

/**
 * Inputs to {@link createCredentialsProvider}.
 *
 * The Bitwarden API-key credentials (`BW_CLIENTID`, `BW_CLIENTSECRET`, `BW_PASSWORD`) are read
 * from `env` rather than `config` because the shared `Config` schema does not carry them —
 * they are vault-unlock secrets, not deployment config, and stay out of the parsed object.
 */
export interface CreateCredentialsProviderOptions {
  /** The validated application configuration (selects the provider and, for Vaultwarden,
   * carries server/folder/item-prefix). */
  config: Config;
  /** The raw environment record, used for `env`-provider credentials and the Bitwarden
   * API-key/master-password triple. */
  env: Record<string, string | undefined>;
  /**
   * Overrides the `bw` command runner (Vaultwarden only). Defaults to a real subprocess
   * runner; tests should always supply a fake here.
   */
  runner?: CommandRunner;
}

/**
 * Builds the {@link CredentialsProvider} selected by `config.credentialsProvider`.
 *
 * @param options - Configuration, environment, and (for Vaultwarden) an optional command
 *   runner override.
 * @returns An `env` or `vaultwarden`-backed credentials provider, matching `config.credentialsProvider`.
 * @throws An `Error` if `vaultwarden` is selected but its server config or Bitwarden API-key
 *   triple (`BW_CLIENTID`/`BW_CLIENTSECRET`/`BW_PASSWORD`) is missing from `env`.
 */
export function createCredentialsProvider(options: CreateCredentialsProviderOptions): CredentialsProvider {
  const { config, env } = options;

  if (config.credentialsProvider === "env") {
    return new EnvCredentialsProvider(env);
  }

  if (config.vaultwarden === undefined) {
    throw new Error("CREDENTIALS_PROVIDER=vaultwarden requires VW_SERVER (and VW_FOLDER) to be configured.");
  }

  const clientId = env.BW_CLIENTID;
  const clientSecret = env.BW_CLIENTSECRET;
  const password = env.BW_PASSWORD;
  if (clientId === undefined || clientSecret === undefined || password === undefined) {
    throw new Error(
      "CREDENTIALS_PROVIDER=vaultwarden requires BW_CLIENTID, BW_CLIENTSECRET, and BW_PASSWORD in the environment.",
    );
  }

  return new VaultwardenCredentialsProvider({
    server: config.vaultwarden.server,
    folder: config.vaultwarden.folder,
    itemPrefix: config.vaultwarden.itemPrefix,
    clientId,
    clientSecret,
    password,
    runner: options.runner ?? createNodeCommandRunner(),
  });
}
