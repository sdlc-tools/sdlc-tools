import { describe, expect, expectTypeOf, it, vi } from 'vitest';
import { CliError, defineCli, defineCommand, defineGroup } from '../src/index.js';
import { execute } from '../src/testing/index.js';

const showRun = vi.fn();

const show = defineCommand({
  name: 'show',
  summary: 'Show an item',
  description: 'Prints one item.',
  positionals: [{ name: 'id', description: 'Item id', required: true }],
  options: {
    state: {
      type: 'string',
      short: 's',
      choices: ['open', 'closed'],
      default: 'open',
      description: 'Item state',
    },
    label: { type: 'string', multiple: true, valueName: 'name', description: 'Label filter' },
    dryRun: { type: 'boolean', description: 'Do not change anything' },
    project: { type: 'string', required: true, valueName: 'key', description: 'Project key' },
  },
  examples: ['sample item show 12 --project ABC'],
  run: ({ options, args }) => {
    expectTypeOf(options.state).toEqualTypeOf<'open' | 'closed'>();
    expectTypeOf(options.label).toEqualTypeOf<string[]>();
    expectTypeOf(options.dryRun).toEqualTypeOf<boolean>();
    expectTypeOf(options.project).toEqualTypeOf<string>();
    expectTypeOf(args.id).toEqualTypeOf<string>();
    showRun(options, args);
    return {
      data: { id: args.id, state: options.state, labels: options.label, project: options.project },
      text: `${args.id} ${options.state}`,
    };
  },
});

const fail = defineCommand({
  name: 'fail',
  summary: 'Always fails',
  options: { kind: { type: 'string', description: 'Failure kind' } },
  run: ({ options }) => {
    if (options.kind === 'unexpected') throw new Error('kaboom');
    if (options.kind === 'auth') {
      throw new CliError('auth', 'Not signed in.', { next: ['Run the login command.'] });
    }
    throw new CliError('not-found', 'No such thing.', { causes: ['typo'] });
  },
});

const silent = defineCommand({
  name: 'silent',
  summary: 'Prints nothing in short mode',
  run: () => ({ data: { done: true }, text: '' }),
});

const cli = defineCli({
  name: 'sample',
  version: '1.2.3',
  summary: 'A sample tool',
  commands: [
    defineGroup({ name: 'item', summary: 'Work with items', commands: [show] }),
    fail,
    silent,
  ],
});

const SHOW = ['item', 'show', '12', '--project', 'ABC'];

describe('help and version', () => {
  it('prints the version to stdout', async () => {
    const run = await execute(cli, ['--version']);
    expect(run).toMatchObject({ code: 0, stdout: 'sample 1.2.3\n', stderr: '' });
  });

  it.each([['--help'], ['-h'], ['help']])(
    'prints root help for %s on stdout with exit 0',
    async (flag) => {
      const run = await execute(cli, [flag]);
      expect(run.code).toBe(0);
      expect(run.stderr).toBe('');
      expect(run.stdout).toContain('sample - A sample tool');
      expect(run.stdout).toContain('item');
      expect(run.stdout).toContain('Work with items');
      expect(run.stdout).toContain('--version');
    },
  );

  it.each([
    [['item', 'show', '--help']],
    [['help', 'item', 'show']],
    [['item', 'show', '12', '-h']],
  ])('prints command help for %j', async (argv) => {
    const run = await execute(cli, argv);
    expect(run.code).toBe(0);
    expect(run.stderr).toBe('');
    expect(run.stdout).toContain('sample item show - Show an item');
    expect(run.stdout).toContain('sample item show <id> [options]');
    expect(run.stdout).toContain('-s, --state <open|closed>');
    expect(run.stdout).toContain('Item state (default: open)');
    expect(run.stdout).toContain('--label <name>');
    expect(run.stdout).toContain('(repeatable)');
    expect(run.stdout).toContain('--dry-run');
    expect(run.stdout).toContain('--project <key>');
    expect(run.stdout).toContain('(required)');
    expect(run.stdout).toContain('--json');
    expect(run.stdout).toContain('$ sample item show 12 --project ABC');
  });

  it('does not run the command when help is requested', async () => {
    showRun.mockClear();
    await execute(cli, ['item', 'show', '--bogus', '--help']);
    expect(showRun).not.toHaveBeenCalled();
  });
});

describe('wrong usage prints the command usage and exits 2', () => {
  async function usageFailure(argv: string[]) {
    showRun.mockClear();
    const run = await execute(cli, argv);
    expect(run.code).toBe(2);
    expect(run.stdout).toBe('');
    expect(run.fetchCalls).toHaveLength(0);
    expect(showRun).not.toHaveBeenCalled();
    return run;
  }

  it('reports a bare invocation with the root help', async () => {
    const run = await usageFailure([]);
    expect(run.stderr).toContain("error: Missing command for 'sample'.");
    expect(run.stderr).toContain('Commands:');
  });

  it('reports a group without a subcommand with the group help', async () => {
    const run = await usageFailure(['item']);
    expect(run.stderr).toContain("Missing command for 'sample item'.");
    expect(run.stderr).toContain('show');
  });

  it('suggests the closest command for a typo', async () => {
    const run = await usageFailure(['itme', 'show']);
    expect(run.stderr).toContain("Unknown command 'itme'. Did you mean 'item'?");
    expect(run.stderr).toContain('Usage:');
  });

  it('rejects an unknown subcommand with the group help', async () => {
    const run = await usageFailure(['item', 'sho']);
    expect(run.stderr).toContain("Unknown command 'sho'. Did you mean 'show'?");
    expect(run.stderr).toContain('sample item <command>');
  });

  it('rejects options placed before the command', async () => {
    const run = await usageFailure(['--json', 'item', 'show']);
    expect(run.stderr).toContain("Unexpected option '--json' before a command");
  });

  it('rejects an unknown option and shows that command usage', async () => {
    const run = await usageFailure([...SHOW, '--bogus']);
    expect(run.stderr).toContain("Unknown option '--bogus'.");
    expect(run.stderr).toContain('sample item show <id> [options]');
  });

  it('suggests the closest option for a typo', async () => {
    const run = await usageFailure([...SHOW, '--stat', 'open']);
    expect(run.stderr).toContain("Unknown option '--stat'. Did you mean '--state'?");
  });

  it('rejects an unknown short option', async () => {
    const run = await usageFailure([...SHOW, '-x']);
    expect(run.stderr).toContain("Unknown option '-x'.");
  });

  it('scopes options to their own command', async () => {
    const run = await usageFailure(['fail', '--project', 'ABC']);
    expect(run.stderr).toContain("Unknown option '--project'.");
  });

  it('rejects a missing option value', async () => {
    const run = await usageFailure([...SHOW, '--state']);
    expect(run.stderr).toContain("Option '--state' requires a value.");
  });

  it('does not take the next flag as an option value', async () => {
    const run = await usageFailure(['item', 'show', '12', '--project', '--json']);
    expect(run.stderr).toContain(
      "Option '--project' requires a value, but the next argument is '--json'.",
    );
  });

  it('rejects a value given to a boolean option', async () => {
    const run = await usageFailure([...SHOW, '--dry-run=yes']);
    expect(run.stderr).toContain("Option '--dry-run' does not take a value.");
  });

  it('rejects a value outside the allowed choices', async () => {
    const run = await usageFailure([...SHOW, '--state', 'merged']);
    expect(run.stderr).toContain(
      "Invalid value 'merged' for '--state'; expected one of: open, closed.",
    );
  });

  it('rejects a missing required argument', async () => {
    const run = await usageFailure(['item', 'show', '--project', 'ABC']);
    expect(run.stderr).toContain('Missing required argument <id>.');
  });

  it('rejects a missing required option', async () => {
    const run = await usageFailure(['item', 'show', '12']);
    expect(run.stderr).toContain("Missing required option '--project'.");
  });

  it('rejects surplus arguments', async () => {
    const run = await usageFailure([...SHOW, 'extra']);
    expect(run.stderr).toContain("Unexpected argument 'extra'.");
  });

  it('reports usage errors as JSON on stderr when --json is present', async () => {
    const run = await usageFailure([...SHOW, '--bogus', '--json']);
    const { error } = run.errorJson();
    expect(error).toMatchObject({ kind: 'usage', code: 'unknown_option', exitCode: 2 });
    expect(error.usage).toContain('sample item show <id>');
  });
});

describe('parsing', () => {
  it('passes typed options and arguments to the command', async () => {
    showRun.mockClear();
    const run = await execute(cli, [
      'item',
      'show',
      '12',
      '-s',
      'closed',
      '--label',
      'a',
      '--label=b',
      '--dry-run',
      '--project',
      'ABC',
    ]);
    expect(run.code).toBe(0);
    expect(showRun).toHaveBeenCalledWith(
      { state: 'closed', label: ['a', 'b'], dryRun: true, project: 'ABC' },
      { id: '12' },
    );
  });

  it('applies defaults and empty values for absent options', async () => {
    showRun.mockClear();
    await execute(cli, SHOW);
    expect(showRun).toHaveBeenCalledWith(
      { state: 'open', label: [], dryRun: false, project: 'ABC' },
      { id: '12' },
    );
  });

  it('treats everything after -- as arguments', async () => {
    showRun.mockClear();
    const run = await execute(cli, ['item', 'show', '--project', 'ABC', '--', '--weird']);
    expect(run.code).toBe(0);
    expect(showRun).toHaveBeenCalledWith(expect.anything(), { id: '--weird' });
  });
});

describe('output contract', () => {
  it('prints the short text by default and nothing on stderr', async () => {
    const run = await execute(cli, SHOW);
    expect(run).toMatchObject({ code: 0, stdout: '12 open\n', stderr: '' });
  });

  it('prints the full result as one compact JSON line with --json', async () => {
    const run = await execute(cli, [...SHOW, '--json']);
    expect(run.code).toBe(0);
    expect(run.stdout).toBe('{"id":"12","state":"open","labels":[],"project":"ABC"}\n');
    expect(run.json()).toEqual({ id: '12', state: 'open', labels: [], project: 'ABC' });
    expect(run.stderr).toBe('');
  });

  it('indents JSON when stdout is a terminal', async () => {
    const run = await execute(cli, [...SHOW, '--json'], { stdoutIsTTY: true });
    expect(run.stdout).toContain('\n  "id": "12"');
  });

  it('prints nothing for an empty short text, and the data with --json', async () => {
    expect((await execute(cli, ['silent'])).stdout).toBe('');
    expect((await execute(cli, ['silent', '--json'])).json()).toEqual({ done: true });
  });
});

describe('errors', () => {
  it('prints failures to stderr with causes and next steps, and uses the kind exit code', async () => {
    const run = await execute(cli, ['fail', '--kind', 'auth']);
    expect(run.code).toBe(3);
    expect(run.stdout).toBe('');
    expect(run.stderr).toBe('error: Not signed in.\n\nNext steps:\n  - Run the login command.\n');
  });

  it('prints errors as JSON on stderr with --json and keeps stdout empty', async () => {
    const run = await execute(cli, ['fail', '--json']);
    expect(run.code).toBe(5);
    expect(run.stdout).toBe('');
    expect(run.errorJson()).toEqual({
      error: { kind: 'not-found', exitCode: 5, message: 'No such thing.', causes: ['typo'] },
    });
  });

  it('reports unexpected exceptions with exit code 1 and hides the stack by default', async () => {
    const run = await execute(cli, ['fail', '--kind', 'unexpected']);
    expect(run.code).toBe(1);
    expect(run.stderr).toContain('error: Unexpected error: kaboom');
    expect(run.stderr).toContain('SDLC_DEBUG=1');
    expect(run.stderr).not.toContain('at ');
  });

  it('prints the stack when SDLC_DEBUG is set', async () => {
    const run = await execute(cli, ['fail', '--kind', 'unexpected'], { env: { SDLC_DEBUG: '1' } });
    expect(run.stderr).toContain('Error: kaboom');
    expect(run.stderr).toMatch(/\n\s+at /);
  });

  it('reports cancellation with exit code 130', async () => {
    const controller = new AbortController();
    controller.abort();
    const run = await execute(cli, ['fail', '--kind', 'unexpected'], { signal: controller.signal });
    expect(run.code).toBe(130);
    expect(run.stderr).toContain('Cancelled.');
  });
});

describe('definition validation', () => {
  const base = { summary: 's', run: () => ({ data: null, text: '' }) };

  it.each([
    ['an invalid command name', () => defineCommand({ ...base, name: 'Bad_Name' })],
    [
      'a reserved option key',
      () =>
        defineCommand({
          ...base,
          name: 'x',
          options: { json: { type: 'boolean', description: 'd' } },
        }),
    ],
    [
      'a reserved short flag',
      () =>
        defineCommand({
          ...base,
          name: 'x',
          options: { a: { type: 'boolean', short: 'h', description: 'd' } },
        }),
    ],
    [
      'a duplicate short flag',
      () =>
        defineCommand({
          ...base,
          name: 'x',
          options: {
            a: { type: 'boolean', short: 'a', description: 'd' },
            b: { type: 'boolean', short: 'a', description: 'd' },
          },
        }),
    ],
    [
      'a required option with a default',
      () =>
        defineCommand({
          ...base,
          name: 'x',
          options: { a: { type: 'string', required: true, default: 'v', description: 'd' } },
        }),
    ],
    [
      'a boolean with a default',
      () =>
        defineCommand({
          ...base,
          name: 'x',
          options: { a: { type: 'boolean', multiple: true, description: 'd' } },
        }),
    ],
    [
      'a required argument after an optional one',
      () =>
        defineCommand({
          ...base,
          name: 'x',
          positionals: [
            { name: 'a', description: 'd' },
            { name: 'b', description: 'd', required: true },
          ],
        }),
    ],
    [
      'a variadic argument that is not last',
      () =>
        defineCommand({
          ...base,
          name: 'x',
          positionals: [
            { name: 'a', description: 'd', variadic: true },
            { name: 'b', description: 'd' },
          ],
        }),
    ],
    [
      'duplicate commands',
      () =>
        defineCli({
          name: 'x',
          version: '1',
          summary: 's',
          commands: [defineCommand({ ...base, name: 'a' }), defineCommand({ ...base, name: 'a' })],
        }),
    ],
    [
      'a command named help',
      () =>
        defineCli({
          name: 'x',
          version: '1',
          summary: 's',
          commands: [defineCommand({ ...base, name: 'help' })],
        }),
    ],
  ])('rejects %s', (_label, build) => {
    expect(build).toThrow(Error);
  });
});
