import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CliError,
  PROJECT_CONFIG_FILE,
  loadConfigFiles,
  normalizeServerUrl,
  resolveSettings,
  userConfigPath,
  type ConfigEnvironment,
} from '../src/index.js';

let root: string;
let home: string;
let repo: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'sdlc-core-config-'));
  home = join(root, 'home');
  repo = join(root, 'repo');
  await mkdir(join(home, '.config', 'sdlc-tools'), { recursive: true });
  await mkdir(join(repo, '.git'), { recursive: true });
  await mkdir(join(repo, 'packages', 'app'), { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function environment(overrides: Partial<ConfigEnvironment> = {}): ConfigEnvironment {
  return { env: {}, cwd: repo, homedir: home, platform: 'linux', ...overrides };
}

async function writeProject(data: unknown, directory = repo): Promise<void> {
  await writeFile(join(directory, PROJECT_CONFIG_FILE), JSON.stringify(data));
}

async function writeUser(data: unknown): Promise<void> {
  await writeFile(join(home, '.config', 'sdlc-tools', 'config.json'), JSON.stringify(data));
}

async function rejection(promise: Promise<unknown>): Promise<CliError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(CliError);
    return error as CliError;
  }
  throw new Error('expected a rejection');
}

describe('userConfigPath', () => {
  it('honours XDG_CONFIG_HOME and falls back to ~/.config', () => {
    expect(userConfigPath(environment({ env: { XDG_CONFIG_HOME: '/xdg' }, homedir: '/h' }))).toBe(
      '/xdg/sdlc-tools/config.json',
    );
    expect(userConfigPath(environment({ homedir: '/h' }))).toBe(
      '/h/.config/sdlc-tools/config.json',
    );
  });

  it('uses APPDATA on Windows', () => {
    expect(
      userConfigPath(
        environment({ platform: 'win32', env: { APPDATA: 'C:\\Users\\a\\AppData\\Roaming' } }),
      ),
    ).toBe('C:\\Users\\a\\AppData\\Roaming\\sdlc-tools\\config.json');
  });
});

describe('loadConfigFiles', () => {
  it('returns nothing when no file exists', async () => {
    expect(await loadConfigFiles(environment())).toEqual({ project: undefined, user: undefined });
  });

  it('finds the project file in a parent directory', async () => {
    await writeProject({ tool: { project: 'ABC' } });
    const files = await loadConfigFiles(environment({ cwd: join(repo, 'packages', 'app') }));
    expect(files.project?.path).toBe(join(repo, PROJECT_CONFIG_FILE));
    expect(files.project?.data).toEqual({ tool: { project: 'ABC' } });
  });

  it('prefers the nearest project file', async () => {
    await writeProject({ tool: { project: 'ROOT' } });
    await writeProject({ tool: { project: 'NEAR' } }, join(repo, 'packages', 'app'));
    const files = await loadConfigFiles(environment({ cwd: join(repo, 'packages', 'app') }));
    expect(files.project?.data).toEqual({ tool: { project: 'NEAR' } });
  });

  it('does not search above the repository root', async () => {
    await writeProject({ tool: { project: 'OUTSIDE' } }, root);
    expect((await loadConfigFiles(environment())).project).toBeUndefined();
  });

  it('reads the user file', async () => {
    await writeUser({ tool: { host: 'https://git.example.test' } });
    const files = await loadConfigFiles(environment());
    expect(files.user?.data).toEqual({ tool: { host: 'https://git.example.test' } });
  });

  it('reports invalid JSON with the file path', async () => {
    await writeFile(join(repo, PROJECT_CONFIG_FILE), '{ nope');
    const error = await rejection(loadConfigFiles(environment()));
    expect(error.kind).toBe('config');
    expect(error.exitCode).toBe(2);
    expect(error.code).toBe('config_invalid_json');
    expect(error.message).toContain(join(repo, PROJECT_CONFIG_FILE));
  });

  it('requires a JSON object at the top level', async () => {
    await writeProject(['a']);
    expect((await rejection(loadConfigFiles(environment()))).code).toBe('config_invalid_shape');
  });

  it.each([
    [{ forgejo: { accessToken: 'abc' } }, 'forgejo.accessToken'],
    [{ jira: { apiToken: 'abc' } }, 'jira.apiToken'],
    [{ tool: { clientSecret: 'abc' } }, 'tool.clientSecret'],
    [{ password: 'abc' }, 'password'],
  ])('refuses files that hold credentials: %j', async (data, keyPath) => {
    await writeProject(data);
    const error = await rejection(loadConfigFiles(environment()));
    expect(error.code).toBe('secret_in_config');
    expect(error.message).toContain(`"${keyPath}"`);
    expect(JSON.stringify(error.toJSON())).not.toContain('abc');
  });

  it('allows keys that merely mention tokens, such as endpoint addresses', async () => {
    await writeProject({ tool: { tokenUrl: 'x', tokenType: 'bearer', secretsPolicy: 'y' } });
    expect((await loadConfigFiles(environment())).project).toBeDefined();
  });
});

describe('resolveSettings', () => {
  const specs = {
    host: {
      label: 'server address',
      key: 'host',
      env: 'SDLC_TOOL_HOST',
      flag: '--host',
      required: true,
      fromProjectFile: false,
    },
    project: { label: 'project key', key: 'project', env: 'SDLC_TOOL_PROJECT', flag: '--project' },
    profile: { label: 'profile', key: 'profile', default: 'default' },
  } as const;

  it('applies flag, then environment, then project file, then user file, then default', async () => {
    await writeUser({ tool: { host: 'https://user.example.test', project: 'USER', profile: 'u' } });
    await writeProject({ tool: { project: 'PROJECT', profile: 'p' } });

    const all = await resolveSettings(
      environment({
        env: { SDLC_TOOL_HOST: 'https://env.example.test', SDLC_TOOL_PROJECT: 'ENV' },
      }),
      'tool',
      specs,
      { host: 'https://flag.example.test', project: 'FLAG' },
    );
    expect(all.values).toEqual({
      host: 'https://flag.example.test',
      project: 'FLAG',
      profile: 'p',
    });
    expect(all.sources).toEqual({ host: 'flag', project: 'flag', profile: 'project' });

    const env = await resolveSettings(
      environment({
        env: { SDLC_TOOL_HOST: 'https://env.example.test', SDLC_TOOL_PROJECT: 'ENV' },
      }),
      'tool',
      specs,
      {},
    );
    expect(env.values.project).toBe('ENV');
    expect(env.sources.project).toBe('env');

    const files = await resolveSettings(environment(), 'tool', specs, {});
    expect(files.values).toEqual({
      host: 'https://user.example.test',
      project: 'PROJECT',
      profile: 'p',
    });
    expect(files.sources).toEqual({ host: 'user', project: 'project', profile: 'project' });

    await rm(join(repo, PROJECT_CONFIG_FILE));
    await writeUser({ tool: { host: 'https://user.example.test' } });
    const defaults = await resolveSettings(environment(), 'tool', specs, {});
    expect(defaults.values).toEqual({
      host: 'https://user.example.test',
      project: undefined,
      profile: 'default',
    });
    expect(defaults.sources.profile).toBe('default');
  });

  it('never reads a protected setting from the project file', async () => {
    await writeProject({ tool: { host: 'https://attacker.example.test' } });
    const error = await rejection(resolveSettings(environment(), 'tool', specs, {}));
    expect(error.code).toBe('missing_setting');
  });

  it('names the flag, variable and file key that would supply a missing setting', async () => {
    const error = await rejection(resolveSettings(environment(), 'tool', specs, {}));
    expect(error.kind).toBe('config');
    expect(error.exitCode).toBe(2);
    expect(error.message).toBe('Missing server address.');
    expect(error.next).toEqual([
      'Pass --host.',
      'Set the SDLC_TOOL_HOST environment variable.',
      `Add "host" under "tool" in ${userConfigPath(environment())}.`,
    ]);
  });

  it('treats empty strings as unset', async () => {
    await writeUser({ tool: { host: '' } });
    const error = await rejection(
      resolveSettings(environment({ env: { SDLC_TOOL_HOST: '' } }), 'tool', specs, {}),
    );
    expect(error.code).toBe('missing_setting');
  });

  it('does not read files when flags and the environment supply everything', async () => {
    await writeFile(join(repo, PROJECT_CONFIG_FILE), '{ broken');
    const resolved = await resolveSettings(
      environment({ env: { SDLC_TOOL_HOST: 'https://env.example.test' } }),
      'tool',
      { host: specs.host },
      {},
    );
    expect(resolved.values.host).toBe('https://env.example.test');
  });

  it('validates values and says where a bad value came from', async () => {
    await writeUser({ tool: { host: 'http://git.example.test' } });
    const error = await rejection(
      resolveSettings(
        environment(),
        'tool',
        { host: { ...specs.host, validate: (value: string) => normalizeServerUrl(value).baseUrl } },
        {},
      ),
    );
    expect(error.code).toBe('insecure_server_url');
    expect(error.next.at(-1)).toBe(`The value came from ${userConfigPath(environment())}.`);
  });

  it('returns the normalized value from the validator', async () => {
    const resolved = await resolveSettings(
      environment(),
      'tool',
      { host: { ...specs.host, validate: (value: string) => normalizeServerUrl(value).baseUrl } },
      { host: 'git.example.test/' },
    );
    expect(resolved.values.host).toBe('https://git.example.test');
  });

  it('rejects non-string values in files', async () => {
    await writeUser({ tool: { host: 'https://git.example.test', project: 12 } });
    const error = await rejection(resolveSettings(environment(), 'tool', specs, {}));
    expect(error.code).toBe('config_invalid_value');
    expect(error.message).toContain('"tool.project"');
  });
});
