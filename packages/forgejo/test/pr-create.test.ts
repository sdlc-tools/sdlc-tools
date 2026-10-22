import { describe, expect, it } from 'vitest';
import { HOST } from './support/fake-forgejo.js';
import { Lab } from './support/lab.js';

const SHA = 'd'.repeat(40);
const PULLS = '/repos/acme/widgets/pulls';

/** A signed-in lab whose checkout is on `feat/export`, pushed and in sync with the server. */
async function ready(): Promise<Lab> {
  const lab = new Lab();
  await lab.signInWithToken();
  lab.forgejo.push('feat/export', SHA);
  lab.git.refs.set('refs/heads/feat/export', SHA);
  return lab;
}

const create = ['pr', 'create', '--title', 'feat: export', '--body', '## Summary\nExports data.'];

describe('pr create', () => {
  it('opens a pull request for the checked-out branch of the origin repository', async () => {
    const lab = await ready();
    const run = await lab.run(create);

    expect(run.code, run.stderr).toBe(0);
    expect(run.stdout).toBe(`Opened pull request #1: ${HOST}/acme/widgets/pulls/1\n`);
    expect(lab.forgejo.bodies.find((b) => b.route === `POST ${PULLS}`)?.body).toEqual({
      title: 'feat: export',
      body: '## Summary\nExports data.',
      head: 'feat/export',
      base: 'main',
    });
  });

  it('prints the full result with --json', async () => {
    const lab = await ready();
    const run = await lab.run([...create, '--json', '--reviewer', 'bob', '--label', 'bug']);
    expect(run.json()).toEqual({
      repo: 'acme/widgets',
      number: 1,
      url: `${HOST}/acme/widgets/pulls/1`,
      title: 'feat: export',
      head: 'feat/export',
      base: 'main',
      draft: false,
      headSha: SHA,
      reviewers: ['bob'],
      labels: ['bug'],
      warnings: [],
    });
  });

  it('requests reviewers and attaches labels by id', async () => {
    const lab = await ready();
    const run = await lab.run([
      ...create,
      '--reviewer',
      'bob',
      '--reviewer',
      'carol',
      '--label',
      'bug',
      '--label',
      'feature',
    ]);

    expect(run.code, run.stderr).toBe(0);
    const bodies = new Map(lab.forgejo.bodies.map((b) => [b.route, b.body]));
    expect(bodies.get(`POST ${PULLS}/1/requested_reviewers`)).toEqual({
      reviewers: ['bob', 'carol'],
    });
    expect(bodies.get('POST /repos/acme/widgets/issues/1/labels')).toEqual({ labels: [1, 2] });
    expect(lab.forgejo.pulls[0]?.reviewers).toEqual(['bob', 'carol']);
  });

  it('uses the configured labels unless the command line names others', async () => {
    const env = { SDLC_FORGEJO_LABELS: 'bug' };
    const lab = await ready();
    await lab.run(create, { env });
    expect(lab.forgejo.pulls[0]?.labels).toEqual([1]);

    const other = await ready();
    await other.run([...create, '--label', 'feature'], { env });
    expect(other.forgejo.pulls[0]?.labels).toEqual([2]);
  });

  describe('default reviewers', () => {
    const env = { SDLC_FORGEJO_REVIEWERS: 'bob, carol' };

    it('are requested on every pull request', async () => {
      const lab = await ready();
      const run = await lab.run([...create, '--json'], { env });
      expect(run.code, run.stderr).toBe(0);
      expect(lab.forgejo.pulls[0]?.reviewers).toEqual(['bob', 'carol']);
      expect(run.json()).toMatchObject({ reviewers: ['bob', 'carol'] });
    });

    it('are merged with --reviewer, each user once whatever the case', async () => {
      const lab = await ready();
      const run = await lab.run(
        [...create, '--json', '--reviewer', 'dave', '--reviewer', 'Bob', '--reviewer', 'dave'],
        { env },
      );
      expect(lab.forgejo.pulls[0]?.reviewers).toEqual(['bob', 'carol', 'dave']);
      expect(run.json()).toMatchObject({ reviewers: ['bob', 'carol', 'dave'] });
      expect(lab.forgejo.count(`POST ${PULLS}/1/requested_reviewers`)).toBe(1);
    });

    it('leave out the author, so that the others are still requested', async () => {
      const lab = await ready();
      const run = await lab.run([...create, '--json'], {
        env: { SDLC_FORGEJO_REVIEWERS: 'bob, Alice, carol' },
      });
      expect(run.code, run.stderr).toBe(0);
      expect(lab.forgejo.pulls[0]?.reviewers).toEqual(['bob', 'carol']);
      expect(run.json()).toMatchObject({ reviewers: ['bob', 'carol'] });
    });

    it('request nobody when the author is the only default reviewer', async () => {
      const lab = await ready();
      const run = await lab.run(create, { env: { SDLC_FORGEJO_REVIEWERS: 'alice' } });
      expect(run.code, run.stderr).toBe(0);
      expect(lab.forgejo.count(`POST ${PULLS}/1/requested_reviewers`)).toBe(0);
    });

    it('leave the call to the server when the author is named with --reviewer', async () => {
      const lab = await ready();
      const run = await lab.run([...create, '--reviewer', 'alice', '--json'], { env });
      expect(run.code).toBe(6);
      expect(run.errorJson().error.code).toBe('pull_request_incomplete');
    });

    it('do not cost a request to look up the author when there are none', async () => {
      const lab = await ready();
      await lab.run(create);
      expect(lab.forgejo.count('GET /user')).toBe(0);
    });

    it('ask for nothing when there are none', async () => {
      const lab = await ready();
      await lab.run(create);
      expect(lab.forgejo.count(`POST ${PULLS}/1/requested_reviewers`)).toBe(0);
    });
  });

  it('reads the description from a file or from standard input', async () => {
    const lab = await ready();
    lab.files.set('description.md', 'From a file.');
    await lab.run(['pr', 'create', '--title', 'T', '--body-file', 'description.md']);
    expect(lab.forgejo.pulls[0]?.body).toBe('From a file.');

    lab.forgejo.push('feat/other', SHA);
    lab.git.branch = 'feat/other';
    lab.stdin = 'From stdin.';
    await lab.run(['pr', 'create', '--title', 'T', '--body-file', '-']);
    expect(lab.forgejo.pulls[1]?.body).toBe('From stdin.');
  });

  it('opens a draft by prefixing the title once', async () => {
    const lab = await ready();
    await lab.run([...create, '--draft']);
    expect(lab.forgejo.pulls[0]?.title).toBe('WIP: feat: export');

    lab.forgejo.push('feat/two', SHA);
    await lab.run([
      'pr',
      'create',
      '--title',
      'WIP: already',
      '--body',
      'x',
      '--head',
      'feat/two',
      '--draft',
    ]);
    expect(lab.forgejo.pulls[1]?.title).toBe('WIP: already');
  });

  it('targets the base it is given', async () => {
    const lab = await ready();
    lab.forgejo.push('release', 'e'.repeat(40));
    await lab.run([...create, '--base', 'release']);
    expect(lab.forgejo.pulls[0]?.base.ref).toBe('release');
  });

  it('warns about uncommitted changes without blocking', async () => {
    const lab = await ready();
    lab.git.changes = [' M src/a.ts', '?? new.ts'];
    const run = await lab.run(create);
    expect(run.code).toBe(0);
    expect(run.stderr).toContain('warning: 2 uncommitted change(s)');
  });
});

describe('pr create refuses to open a pull request that should not exist', () => {
  async function blocked(lab: Lab, extra: string[] = [], expected: string[] = []) {
    const run = await lab.run([...create, ...extra, '--json']);
    expect(run.code).toBe(6);
    const error = run.errorJson().error;
    expect(error.code).toBe('create_blocked');
    for (const text of expected) expect((error.causes as string[]).join('\n')).toContain(text);
    expect(lab.forgejo.count(`POST ${PULLS}`)).toBe(0);
    return error;
  }

  it('when the branch was not pushed', async () => {
    const lab = await ready();
    lab.forgejo.branches.delete('feat/export');
    await blocked(lab, [], ['is not on the server yet']);
  });

  it('when the server has other commits than the local branch', async () => {
    const lab = await ready();
    lab.git.refs.set('refs/heads/feat/export', 'f'.repeat(40));
    await blocked(lab, [], ['ffffffff', 'dddddddd']);
  });

  it('when a pull request for the branch is already open, whatever its base', async () => {
    const lab = await ready();
    lab.forgejo.addPull({ head: 'feat/export', base: 'release' });
    await blocked(lab, [], ['already open: #1']);
  });

  it('but a pull request from a fork branch of the same name is not a duplicate', async () => {
    const lab = await ready();
    lab.forgejo.addPull({ head: 'feat/export', headRepo: 'someone/widgets' });
    const run = await lab.run(create);
    expect(run.code, run.stderr).toBe(0);
  });

  it('when the base does not exist', async () => {
    const lab = await ready();
    await blocked(lab, ['--base', 'nowhere'], ['"nowhere" does not exist']);
  });

  it('when head and base are the same branch', async () => {
    const lab = await ready();
    await blocked(lab, ['--base', 'feat/export'], ['same branch']);
  });

  it('only warns when earlier pull requests for the branch were closed', async () => {
    const lab = await ready();
    lab.forgejo.addPull({ head: 'feat/export', state: 'closed', merged: false });
    const run = await lab.run([...create, '--json']);
    expect(run.code).toBe(0);
    expect(run.stderr).toContain('Read why they were closed');
    expect((run.json() as { warnings: string[] }).warnings).toHaveLength(1);
  });

  it('reports every reason at once', async () => {
    const lab = await ready();
    lab.forgejo.branches.delete('feat/export');
    const error = await blocked(lab, ['--base', 'nowhere']);
    expect((error.details as { violations: string[] }).violations).toHaveLength(2);
  });

  it('without opening anything when a label does not exist', async () => {
    const lab = await ready();
    const run = await lab.run([...create, '--label', 'bug', '--label', 'urgent']);
    expect(run.code).toBe(5);
    expect(run.stderr).toContain('no label named urgent');
    expect(run.stderr).toContain('Existing labels: bug, feature.');
    expect(lab.forgejo.count(`POST ${PULLS}`)).toBe(0);
  });
});

describe('pr create when the pull request exists but a follow-up request failed', () => {
  it('keeps the pull request and exits with 6, naming it and how to finish', async () => {
    const lab = await ready();
    lab.forgejo.unknownUsers.add('ghost');
    const run = await lab.run([...create, '--reviewer', 'ghost', '--json']);

    expect(run.code).toBe(6);
    const error = run.errorJson().error;
    expect(error.code).toBe('pull_request_incomplete');
    expect(error.message).toContain('#1 was opened');
    expect(error.message).toContain(`${HOST}/acme/widgets/pulls/1`);
    expect(JSON.stringify(error)).toContain('user does not exist [name: ghost]');
    expect(error.details).toEqual({ number: 1, url: `${HOST}/acme/widgets/pulls/1` });
    expect(lab.forgejo.pulls).toHaveLength(1);

    const again = await lab.run([...create, '--json']);
    expect(again.errorJson().error.code).toBe('create_blocked');
  });
});

describe('pr create checks the text before anything else', () => {
  async function rejected(argv: string[], expected: string, env = {}) {
    const lab = await ready();
    const run = await lab.run(argv, { env });
    expect(run.code).toBe(2);
    expect(run.stderr).toContain(expected);
    expect(lab.fetch.calls).toHaveLength(0);
  }

  it('an empty title or description', async () => {
    await rejected(['pr', 'create', '--title', '  ', '--body', 'x'], 'The title is empty.');
    await rejected(['pr', 'create', '--title', 'T', '--body', ' \n'], 'The description is empty.');
  });

  it('a title over the limit or on several lines', async () => {
    await rejected(['pr', 'create', '--title', 'x'.repeat(256), '--body', 'b'], '256 characters');
    await rejected(['pr', 'create', '--title', 'a\nb', '--body', 'b'], 'single line');
  });

  it('a title that does not match the configured pattern', async () => {
    const env = { SDLC_FORGEJO_PR_TITLE_PATTERN: '^(feat|fix): .+ \\[[A-Z]+-\\d+\\]$' };
    await rejected(
      ['pr', 'create', '--title', 'feat: nothing', '--body', 'b'],
      'does not match the configured pattern',
      env,
    );
  });

  it('a description lacking the configured sections', async () => {
    const env = { SDLC_FORGEJO_PR_REQUIRED_SECTIONS: 'Summary, Testing' };
    await rejected(
      ['pr', 'create', '--title', 'T', '--body', '## Summary\nx'],
      'lacks the section(s): Testing',
      env,
    );
  });

  it('a description whose configured section is empty', async () => {
    const env = { SDLC_FORGEJO_PR_REQUIRED_SECTIONS: 'Summary, Testing' };
    await rejected(
      ['pr', 'create', '--title', 'T', '--body', '## Summary\nx\n## Testing\n<!-- how? -->'],
      'nothing under the section(s): Testing',
      env,
    );
  });

  it('accepts a description that has the configured sections as headings or bold lines', async () => {
    const lab = await ready();
    const env = { SDLC_FORGEJO_PR_REQUIRED_SECTIONS: 'Summary,Testing' };
    const run = await lab.run(
      ['pr', 'create', '--title', 'T', '--body', '## summary\nx\n\n**Testing**\nran'],
      { env },
    );
    expect(run.code, run.stderr).toBe(0);
  });

  it('a pattern that is not a regular expression', async () => {
    await rejected(
      ['pr', 'create', '--title', 'T', '--body', 'b'],
      'not a valid regular expression',
      {
        SDLC_FORGEJO_PR_TITLE_PATTERN: '(',
      },
    );
  });

  it('both --body and --body-file, or neither', async () => {
    await rejected(['pr', 'create', '--title', 'T', '--body', 'b', '--body-file', 'x'], 'not both');
    await rejected(['pr', 'create', '--title', 'T'], 'Missing the pull request description.');
  });

  it('a description file that cannot be read', async () => {
    await rejected(
      ['pr', 'create', '--title', 'T', '--body-file', 'missing.md'],
      'Cannot read the description',
    );
  });

  it('a checkout that is not on a branch, when --head is not given', async () => {
    const lab = await ready();
    lab.git.branch = undefined;
    const run = await lab.run(create);
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('Pass --head <branch>');
    expect(lab.fetch.calls).toHaveLength(0);
  });
});

describe('pr check', () => {
  it('says when a pull request can be opened', async () => {
    const lab = await ready();
    const run = await lab.run(['pr', 'check', '--json']);
    expect(run.code).toBe(0);
    expect(run.json()).toEqual({
      ok: true,
      repo: 'acme/widgets',
      head: 'feat/export',
      base: 'main',
      headSha: SHA,
      warnings: [],
    });
    expect(lab.forgejo.count(`POST ${PULLS}`)).toBe(0);
  });

  it('exits with 6 and lists what is in the way', async () => {
    const lab = await ready();
    lab.forgejo.addPull({ head: 'feat/export' });
    const run = await lab.run(['pr', 'check']);
    expect(run.code).toBe(6);
    expect(run.stderr).toContain('already open: #1');
    expect(run.stderr).toContain('sdlc-forgejo pr check');
  });

  it('works for a branch named on the command line, outside any checkout', async () => {
    const lab = await ready();
    lab.git.branch = undefined;
    lab.git.remote = undefined;
    const run = await lab.run(['pr', 'check', '--head', 'feat/export', '--repo', 'acme/widgets']);
    expect(run.code, run.stderr).toBe(0);
  });
});

describe('server errors are translated', () => {
  it('a repository that does not exist', async () => {
    const lab = await ready();
    const run = await lab.run([...create, '--repo', 'acme/missing']);
    expect(run.code).toBe(5);
    expect(run.stderr).toContain('could not find repository acme/missing');
  });
});
