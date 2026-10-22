import { readFile, stat } from 'node:fs/promises';
import { posix, win32 } from 'node:path';
import { CliError } from './errors.js';
import type { Runtime } from './runtime.js';

/** Searched for from the working directory upward, stopping at the repository root. */
export const PROJECT_CONFIG_FILE = '.sdlc-tools.json';

export type ConfigEnvironment = Pick<Runtime, 'env' | 'cwd' | 'homedir' | 'platform'>;

export interface ConfigFile {
  readonly path: string;
  readonly data: Readonly<Record<string, unknown>>;
}

export interface ConfigFiles {
  readonly project: ConfigFile | undefined;
  readonly user: ConfigFile | undefined;
}

function pathApi(platform: NodeJS.Platform): typeof posix {
  return platform === 'win32' ? win32 : posix;
}

/** `$XDG_CONFIG_HOME/sdlc-tools/config.json`, `%APPDATA%\sdlc-tools\config.json` on Windows. */
export function userConfigPath(runtime: ConfigEnvironment): string {
  const path = pathApi(runtime.platform);
  const base =
    runtime.platform === 'win32'
      ? (nonEmpty(runtime.env.APPDATA) ?? path.join(runtime.homedir, 'AppData', 'Roaming'))
      : (nonEmpty(runtime.env.XDG_CONFIG_HOME) ?? path.join(runtime.homedir, '.config'));
  return path.join(base, 'sdlc-tools', 'config.json');
}

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value === '' ? undefined : value;
}

const SECRET_KEY = /(token|secret|password|passwd|apikey|credentials?)$/i;

function findSecretKey(value: unknown, trail: readonly string[]): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) return [...trail, key].join('.');
    const nested = findSecretKey(child, [...trail, key]);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

async function readConfigFile(path: string): Promise<ConfigFile | undefined> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new CliError('config', `Cannot read the configuration file ${path}.`, {
      code: 'config_unreadable',
      next: ['Check the file permissions and that the path is a regular file.'],
      cause: error,
    });
  }

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new CliError('config', `The configuration file ${path} is not valid JSON.`, {
      code: 'config_invalid_json',
      next: [`Fix the JSON syntax in ${path}.`],
      cause: error,
    });
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new CliError('config', `The configuration file ${path} must contain a JSON object.`, {
      code: 'config_invalid_shape',
    });
  }

  const secret = findSecretKey(data, []);
  if (secret !== undefined) {
    throw new CliError(
      'config',
      `The configuration file ${path} contains "${secret}", but configuration files must not hold credentials.`,
      {
        code: 'secret_in_config',
        next: [
          `Remove "${secret}" from the file. If the file was shared or committed, treat the credential as exposed and replace it.`,
          "Store credentials with the tool's sign-in command or pass them through an environment variable.",
        ],
      },
    );
  }
  return { path, data: data as Record<string, unknown> };
}

async function findProjectConfig(runtime: ConfigEnvironment): Promise<ConfigFile | undefined> {
  const path = pathApi(runtime.platform);
  let directory = runtime.cwd;
  for (;;) {
    const found = await readConfigFile(path.join(directory, PROJECT_CONFIG_FILE));
    if (found !== undefined) return found;
    if (await exists(path.join(directory, '.git'))) return undefined;
    const parent = path.dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

/**
 * Loads the project file (nearest `.sdlc-tools.json` between the working
 * directory and the repository root) and the user file. Missing files are
 * skipped; malformed files, and files holding credentials, are errors.
 */
export async function loadConfigFiles(runtime: ConfigEnvironment): Promise<ConfigFiles> {
  const [project, user] = await Promise.all([
    findProjectConfig(runtime),
    readConfigFile(userConfigPath(runtime)),
  ]);
  return { project, user };
}

export type SettingSource = 'flag' | 'env' | 'project' | 'user' | 'default';

export interface SettingSpec {
  /** Human name used in messages, such as "Forgejo host". */
  readonly label: string;
  /** Key inside the tool's section of the configuration files. */
  readonly key: string;
  /** Environment variable that overrides the files. */
  readonly env?: string;
  /** Flag that overrides everything, for example `--host`; used in messages. */
  readonly flag?: string;
  readonly required?: boolean;
  readonly default?: string;
  /**
   * Set to `false` for settings that decide where credentials are sent, such as
   * a server address: a repository file you did not write must not choose them.
   */
  readonly fromProjectFile?: boolean;
  /** Returns the normalized value or throws a usage error. */
  readonly validate?: (value: string) => string;
}

export type SettingSpecs = Readonly<Record<string, SettingSpec>>;

export interface ResolvedSettings<S extends SettingSpecs> {
  readonly values: {
    readonly [K in keyof S]: S[K] extends { readonly required: true } ? string : string | undefined;
  };
  readonly sources: { readonly [K in keyof S]: SettingSource | undefined };
}

interface Candidate {
  readonly value: string;
  readonly source: SettingSource;
  readonly origin: string;
}

function fromSection(file: ConfigFile, section: string, spec: SettingSpec): string | undefined {
  const sectionData = file.data[section];
  if (typeof sectionData !== 'object' || sectionData === null) return undefined;
  const value = (sectionData as Record<string, unknown>)[spec.key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new CliError(
      'config',
      `"${section}.${spec.key}" in ${file.path} must be a string, not ${typeof value}.`,
      { code: 'config_invalid_value', next: ['Put the value in quotes.'] },
    );
  }
  return value === '' ? undefined : value;
}

/**
 * Resolves each setting with the precedence flag, environment variable,
 * project file, user file, default. Files are read only when a setting is not
 * already supplied by a flag or the environment. A missing required setting
 * fails with the exact flag, variable and file key that would supply it.
 *
 * File layout: `{ "<section>": { "<key>": "value" } }`, one section per tool.
 */
export async function resolveSettings<const S extends SettingSpecs>(
  runtime: ConfigEnvironment,
  section: string,
  specs: S,
  flags: { readonly [K in keyof S]?: string | undefined },
): Promise<ResolvedSettings<S>> {
  const found = new Map<string, Candidate>();

  for (const [name, spec] of Object.entries(specs)) {
    const flagValue = flags[name];
    if (flagValue !== undefined) {
      found.set(name, { value: flagValue, source: 'flag', origin: spec.flag ?? name });
      continue;
    }
    const envValue = spec.env === undefined ? undefined : nonEmpty(runtime.env[spec.env]);
    if (envValue !== undefined && spec.env !== undefined) {
      found.set(name, { value: envValue, source: 'env', origin: spec.env });
    }
  }

  let files: ConfigFiles | undefined;
  if (found.size < Object.keys(specs).length) files = await loadConfigFiles(runtime);

  for (const [name, spec] of Object.entries(specs)) {
    if (found.has(name)) continue;
    const layers: readonly (readonly [SettingSource, ConfigFile | undefined])[] = [
      ['project', spec.fromProjectFile === false ? undefined : files?.project],
      ['user', files?.user],
    ];
    for (const [source, file] of layers) {
      const value = file === undefined ? undefined : fromSection(file, section, spec);
      if (value !== undefined && file !== undefined) {
        found.set(name, { value, source, origin: file.path });
        break;
      }
    }
    if (!found.has(name) && spec.default !== undefined) {
      found.set(name, { value: spec.default, source: 'default', origin: 'default' });
    }
  }

  const values: Record<string, string | undefined> = {};
  const sources: Record<string, SettingSource | undefined> = {};
  for (const [name, spec] of Object.entries(specs)) {
    const candidate = found.get(name);
    if (candidate === undefined) {
      if (spec.required === true) throw missingSetting(section, spec, runtime);
      values[name] = undefined;
      sources[name] = undefined;
      continue;
    }
    try {
      values[name] = spec.validate === undefined ? candidate.value : spec.validate(candidate.value);
    } catch (error) {
      if (error instanceof CliError) {
        throw error.with({
          next: [...error.next, `The value came from ${describeOrigin(candidate)}.`],
        });
      }
      throw error;
    }
    sources[name] = candidate.source;
  }
  return { values, sources } as ResolvedSettings<S>;
}

function describeOrigin(candidate: Candidate): string {
  switch (candidate.source) {
    case 'flag':
      return `the ${candidate.origin} flag`;
    case 'env':
      return `the ${candidate.origin} environment variable`;
    case 'default':
      return 'the built-in default';
    default:
      return candidate.origin;
  }
}

function missingSetting(section: string, spec: SettingSpec, runtime: ConfigEnvironment): CliError {
  const next: string[] = [];
  if (spec.flag !== undefined) next.push(`Pass ${spec.flag}.`);
  if (spec.env !== undefined) next.push(`Set the ${spec.env} environment variable.`);
  const files =
    spec.fromProjectFile === false
      ? userConfigPath(runtime)
      : `${PROJECT_CONFIG_FILE} (searched upward from the current directory) or ${userConfigPath(runtime)}`;
  next.push(`Add "${spec.key}" under "${section}" in ${files}.`);
  return new CliError('config', `Missing ${spec.label}.`, { code: 'missing_setting', next });
}
