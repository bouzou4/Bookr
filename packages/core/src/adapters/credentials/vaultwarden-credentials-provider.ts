/**
 * Vaultwarden-backed {@link CredentialsProvider}, driven entirely through the `bw` (Bitwarden)
 * CLI so no vault decryption logic is reimplemented here.
 *
 * @packageDocumentation
 */

import type { ProviderCredentials, ProviderName } from "@bookr/shared";
import type { CredentialsProvider, SecretName } from "../../ports/credentials-provider.ts";
import type { CommandResult, CommandRunner } from "./command-runner.ts";

/** Shape of a custom field on a Bitwarden CLI item, as returned by `bw list items`. */
interface BwField {
  /** The field's label, e.g. `"apiKey"`. */
  name?: string | null;
  /** The field's stored value. */
  value?: string | null;
}

/** Shape of the `login` block on a Bitwarden CLI item, as returned by `bw list items`. */
interface BwLogin {
  /** The stored username, if any. */
  username?: string | null;
  /** The stored password, if any. */
  password?: string | null;
}

/** A single vault item as returned by `bw list items --folderid <id>`. */
interface BwItem {
  /** The item's display name — matched exactly against the expected credential/secret name. */
  name: string;
  /** Login block, present on login-type items. */
  login?: BwLogin;
  /** Custom fields attached to the item. */
  fields?: BwField[];
  /** Free-text notes, used as a last-resort source for secret values. */
  notes?: string | null;
}

/** A folder as returned by `bw list folders`. */
interface BwFolder {
  /** The folder's Bitwarden id, required by `bw list items --folderid`. */
  id: string;
  /** The folder's display name, matched against the configured folder. */
  name: string;
}

/** Configuration and dependencies for a {@link VaultwardenCredentialsProvider}. */
export interface VaultwardenCredentialsProviderOptions {
  /** Vaultwarden server URL (`VW_SERVER`), passed to `bw config server`. */
  server: string;
  /** Name of the vault folder holding Bookr's items (`VW_FOLDER`). */
  folder: string;
  /**
   * Optional prefix applied to every item name this provider looks up, e.g. with prefix
   * `"bookr-"` the Resy credential item must be named `"bookr-resy"` (`VW_ITEM_PREFIX`).
   */
  itemPrefix?: string;
  /** Bitwarden API-key client id (`BW_CLIENTID`), used for `bw login --apikey`. */
  clientId: string;
  /** Bitwarden API-key client secret (`BW_CLIENTSECRET`), used for `bw login --apikey`. */
  clientSecret: string;
  /** Vault master password (`BW_PASSWORD`), used to unlock the vault. */
  password: string;
  /**
   * Executes the `bw` CLI. Injected so tests can supply canned output instead of spawning a
   * real process.
   */
  runner: CommandRunner;
}

/**
 * Normalises a field/item label for loose matching: lowercase, alphanumerics only. This lets
 * `"apiKey"`, `"api_key"`, and `"API Key"` all resolve to the same custom field.
 *
 * @param name - The raw label to normalise.
 * @returns The normalised label.
 */
function normalizeLabel(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Finds a custom field on a vault item by normalised name.
 *
 * @param item - The vault item to search.
 * @param label - The field label to look for (normalised before comparing).
 * @returns The field's value, or undefined if no matching field exists.
 */
function findField(item: BwItem, label: string): string | undefined {
  const target = normalizeLabel(label);
  const field = item.fields?.find((f) => typeof f.name === "string" && normalizeLabel(f.name) === target);
  return field?.value ?? undefined;
}

/**
 * Parses Bitwarden CLI JSON list output into an array, without ever including the raw
 * (potentially secret-bearing) payload in a thrown error.
 *
 * @param raw - The raw stdout from a `bw list …` command.
 * @param kind - What the list contains, used only for the error message (e.g. `"item"`).
 * @returns The parsed array.
 * @throws An `Error` (with no vault content in its message) if `raw` is not a JSON array.
 */
function parseJsonArray<T>(raw: string, kind: string): T[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Vaultwarden returned unparsable ${kind} list output.`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`Vaultwarden ${kind} list output was not a JSON array.`);
  }
  return parsed as T[];
}

/**
 * Supplies credentials and secrets from a self-hosted Vaultwarden instance via the Bitwarden
 * CLI (`bw`): `bw config server` → `bw login --apikey` → `bw unlock --passwordenv` → `bw sync`
 * → `bw list items --folderid`. The API key alone does not decrypt vault contents, so the
 * unlock step is mandatory; the resulting session token is kept for the lifetime of this
 * instance and vault contents are fetched once and cached.
 *
 * Vault items are located by exact name match within the configured folder:
 * - Provider credentials: an item named `<itemPrefix><providerName>` (e.g. `"resy"`). Its
 *   `login.username` and `login.password` map to the credential's username/password; a custom
 *   field named `apiKey` (case/separator-insensitive) maps to the credential's API key.
 * - Named secrets: an item named `<itemPrefix><secretName>` (e.g. `"apprise_key"`). Its value
 *   is read from a custom field named `value`, falling back to `login.password`, then to the
 *   item's notes.
 *
 * This adapter never logs vault contents, and redacts the configured client secret, master
 * password, and session token from any error message it raises.
 */
export class VaultwardenCredentialsProvider implements CredentialsProvider {
  private readonly options: VaultwardenCredentialsProviderOptions;
  private readonly secretsToRedact: string[] = [];
  private items: Map<string, BwItem> | undefined;
  private loadPromise: Promise<void> | undefined;

  /**
   * @param options - Server/folder configuration, vault credentials, and the injected `bw`
   *   command runner.
   */
  constructor(options: VaultwardenCredentialsProviderOptions) {
    this.options = options;
    this.trackSecret(options.clientSecret);
    this.trackSecret(options.password);
  }

  /**
   * Runs the `bw` login/unlock/sync/list sequence once and caches the resulting vault items.
   * Safe to call more than once — later calls resolve the same cached load.
   */
  async init(): Promise<void> {
    if (this.loadPromise === undefined) {
      this.loadPromise = this.load();
    }
    return this.loadPromise;
  }

  /**
   * @param provider - The provider whose credentials are requested.
   * @returns The credentials found in the matching vault item, or an empty object if no such
   *   item exists in the configured folder.
   */
  async getProviderCredentials(provider: ProviderName): Promise<ProviderCredentials> {
    const items = await this.ensureLoaded();
    const item = items.get(this.itemName(provider));
    if (item === undefined) return {};

    const creds: ProviderCredentials = {};
    const username = item.login?.username ?? undefined;
    const password = item.login?.password ?? undefined;
    const apiKey = findField(item, "apiKey");
    if (username !== undefined) creds.username = username;
    if (password !== undefined) creds.password = password;
    if (apiKey !== undefined) creds.apiKey = apiKey;
    return creds;
  }

  /**
   * @param name - The secret name.
   * @returns The secret's value, or undefined if no matching vault item (or value) exists.
   */
  async getSecret(name: SecretName): Promise<string | undefined> {
    const items = await this.ensureLoaded();
    const item = items.get(this.itemName(name));
    if (item === undefined) return undefined;
    const notes = item.notes?.trim();
    return findField(item, "value") ?? item.login?.password ?? (notes !== undefined && notes.length > 0 ? notes : undefined);
  }

  /**
   * Ensures the vault has been loaded (running {@link init} on first use) and returns the
   * cached item map.
   */
  private async ensureLoaded(): Promise<Map<string, BwItem>> {
    await this.init();
    if (this.items === undefined) {
      throw new Error("Vaultwarden credentials provider has no loaded items after init.");
    }
    return this.items;
  }

  /** Runs the full CLI sequence and populates {@link items}. */
  private async load(): Promise<void> {
    const { runner, server, folder, clientId, clientSecret, password } = this.options;

    await this.run(runner, ["config", "server", server]);
    await this.run(runner, ["login", "--apikey"], {
      BW_CLIENTID: clientId,
      BW_CLIENTSECRET: clientSecret,
    });

    const unlockResult = await this.run(runner, ["unlock", "--passwordenv", "BW_PASSWORD", "--raw"], {
      BW_PASSWORD: password,
    });
    const session = unlockResult.stdout.trim();
    this.trackSecret(session);
    const sessionEnv = { BW_SESSION: session };

    await this.run(runner, ["sync"], sessionEnv);

    const foldersResult = await this.run(runner, ["list", "folders"], sessionEnv);
    const folders = parseJsonArray<BwFolder>(foldersResult.stdout, "folder");
    const match = folders.find((f) => f.name === folder);
    if (match === undefined) {
      throw new Error(`Vaultwarden folder "${folder}" was not found.`);
    }

    const itemsResult = await this.run(runner, ["list", "items", "--folderid", match.id], sessionEnv);
    const parsedItems = parseJsonArray<BwItem>(itemsResult.stdout, "item");

    const byName = new Map<string, BwItem>();
    for (const item of parsedItems) {
      byName.set(item.name, item);
    }
    this.items = byName;
  }

  /**
   * Runs a `bw` subcommand through the injected runner and throws a redacted error if it
   * exits non-zero.
   */
  private async run(
    runner: CommandRunner,
    args: string[],
    env?: Record<string, string | undefined>,
  ): Promise<CommandResult> {
    const result = await runner(args, env);
    if (result.code !== 0) {
      const detail = result.stderr.trim() || "no stderr output";
      throw new Error(`bw ${args[0]} failed with exit code ${result.code}: ${this.redact(detail)}`);
    }
    return result;
  }

  /** Records a value that must never appear verbatim in a thrown error message. */
  private trackSecret(value: string): void {
    if (value.length > 0) this.secretsToRedact.push(value);
  }

  /** Replaces any tracked secret value found in `text` with a redaction marker. */
  private redact(text: string): string {
    return this.secretsToRedact.reduce((acc, secret) => acc.split(secret).join("[redacted]"), text);
  }

  /** Builds the expected vault item name for a credential/secret key. */
  private itemName(key: string): string {
    return `${this.options.itemPrefix ?? ""}${key}`;
  }
}
