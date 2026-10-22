import { describe, expect, it } from 'vitest';
import { Lab } from './support/lab.js';

/** Every invocation here must fail on this machine, before a byte reaches the network. */
async function fails(lab: Lab, argv: string[], code: number, expected: string[], env = {}) {
  const run = await lab.run(argv, { env });
  expect(run.stderr).toContain(expected[0]);
  for (const text of expected.slice(1)) expect(run.stderr).toContain(text);
  expect(run.code).toBe(code);
  expect(run.stdout).toBe('');
  expect(lab.fetch.calls).toHaveLength(0);
}

describe('wrong invocations print the usage of the command in question and exit with 2', () => {
  it('unknown command, with a suggestion', async () => {
    await fails(new Lab(), ['pr', 'creat'], 2, [
      "Unknown command 'creat'",
      "Did you mean 'create'?",
    ]);
  });

  it('unknown flag', async () => {
    await fails(new Lab(), ['pr', 'list', '--stat', 'open'], 2, ['--stat', 'sdlc-forgejo pr list']);
  });

  it('a flag of another command', async () => {
    await fails(new Lab(), ['pr', 'list', '--draft'], 2, ['--draft']);
  });

  it('a missing required option', async () => {
    await fails(new Lab(), ['pr', 'create', '--body', 'x'], 2, [
      '--title',
      'sdlc-forgejo pr create',
    ]);
  });

  it('a missing required argument', async () => {
    await fails(new Lab(), ['pr', 'view'], 2, ['<number>', 'sdlc-forgejo pr view']);
  });

  it('a value outside the allowed choices', async () => {
    await fails(new Lab(), ['pr', 'list', '--state', 'merged'], 2, ['merged']);
  });
});

describe('missing settings and credentials fail locally', () => {
  it('no server address, naming every way to give one', async () => {
    await fails(
      new Lab(),
      ['pr', 'list', '--repo', 'a/b'],
      2,
      ['Missing Forgejo server address.', '--host', 'SDLC_FORGEJO_HOST', '"host" under "forgejo"'],
      { SDLC_FORGEJO_HOST: undefined },
    );
  });

  it('a server address over plain http', async () => {
    await fails(
      new Lab(),
      ['pr', 'list', '--repo', 'a/b', '--host', 'http://git.example.test'],
      2,
      ['must use https'],
    );
  });

  it('no repository when the checkout has no usable origin', async () => {
    const lab = new Lab();
    lab.git.remote = undefined;
    await lab.signInWithToken();
    await fails(lab, ['pr', 'list'], 2, [
      'Missing repository.',
      '--repo',
      'SDLC_FORGEJO_REPO',
      'origin',
    ]);
  });

  it('refuses to take the repository from a remote on another server', async () => {
    const lab = new Lab();
    lab.git.remote = 'git@evil.example.test:acme/widgets.git';
    await lab.signInWithToken();
    await fails(lab, ['pr', 'list'], 2, ['Missing repository.', 'points to evil.example.test']);
  });

  it('a malformed repository', async () => {
    await fails(new Lab(), ['pr', 'list', '--repo', 'just-a-name'], 2, [
      'not a repository in the form owner/name',
    ]);
  });

  it('no credentials, for every command that talks to the server', async () => {
    const lab = new Lab();
    const commands = [
      ['pr', 'list'],
      ['pr', 'view', '3'],
      ['pr', 'check', '--head', 'feat/x'],
      ['pr', 'create', '--title', 'T', '--body', 'B', '--head', 'feat/x'],
      ['pr', 'reviewers', '3', '--add', 'bob'],
      ['pr', 'labels', '3', '--add', 'bug'],
      ['pr', 'merge', '3'],
      ['branch', 'cleanup', 'feat/x'],
    ];
    for (const argv of [
      ...commands.map((c) => [...c, '--repo', 'acme/widgets']),
      ['auth', 'status'],
    ]) {
      const run = await lab.run(argv);
      expect(run.code, argv.join(' ')).toBe(3);
      expect(run.stderr).toContain('No credentials found');
    }
    expect(lab.fetch.calls).toHaveLength(0);
  });

  it('never sends the Authorization header token undefined: a missing token stops the command', async () => {
    const lab = new Lab();
    await fails(lab, ['pr', 'merge', '3', '--repo', 'acme/widgets'], 3, ['No credentials found']);
  });
});

describe('invalid values fail locally', () => {
  it.each([['abc'], ['0'], ['1.5'], ['12abc']])('pull request number %j', async (number) => {
    const lab = new Lab();
    await lab.signInWithToken();
    await fails(lab, ['pr', 'view', number, '--repo', 'acme/widgets'], 2, [
      'is not a pull request number',
    ]);
  });

  it('a limit that is not a positive number', async () => {
    const lab = new Lab();
    await lab.signInWithToken();
    await fails(lab, ['pr', 'list', '--repo', 'acme/widgets', '--limit', '0'], 2, [
      'not a valid --limit',
    ]);
  });

  it('a commit that is not a hash', async () => {
    const lab = new Lab();
    await lab.signInWithToken();
    await fails(
      lab,
      ['pr', 'merge', '3', '--repo', 'acme/widgets', '--match-head-commit', 'main'],
      2,
      ['is not a commit hash'],
    );
  });

  it('a branch name that git would take for an option', async () => {
    const lab = new Lab();
    await lab.signInWithToken();
    await fails(lab, ['branch', 'cleanup', '--delete', '--repo', 'acme/widgets'], 2, ['--delete']);
    await fails(lab, ['branch', 'cleanup', '--repo=acme/widgets', '--', '-D'], 2, [
      'not a valid branch name',
    ]);
  });

  it('reviewers and labels commands that change nothing', async () => {
    const lab = new Lab();
    await lab.signInWithToken();
    await fails(lab, ['pr', 'reviewers', '3', '--repo', 'acme/widgets'], 2, ['Nothing to change']);
    await fails(lab, ['pr', 'labels', '3', '--repo', 'acme/widgets'], 2, ['Nothing to change']);
  });
});
