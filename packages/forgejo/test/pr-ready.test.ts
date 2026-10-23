import { describe, expect, it } from 'vitest';
import { HOST } from './support/fake-forgejo.js';
import { Lab } from './support/lab.js';

const PATCH = 'PATCH /repos/acme/widgets/pulls/1';
const ready = ['pr', 'ready', '--repo', 'acme/widgets'];

async function lab(title: string): Promise<Lab> {
  const lab = new Lab();
  await lab.signInWithToken();
  lab.forgejo.push('feat/export', 'd'.repeat(40));
  lab.forgejo.addPull({ head: 'feat/export', title });
  return lab;
}

describe('pr ready', () => {
  it.each([
    ['WIP: feat: export', 'feat: export'],
    ['[WIP] feat: export', 'feat: export'],
    ['wip:feat: export', 'feat: export'],
    ['WIP: [WIP] feat: export', 'feat: export'],
  ])('marks "%s" ready and leaves the rest of the title alone', async (title, expected) => {
    const lab_ = await lab(title);
    const run = await lab_.run([...ready, '1']);

    expect(run.code, run.stderr).toBe(0);
    expect(run.stdout).toBe(`#1 is now ready for review: ${HOST}/acme/widgets/pulls/1\n`);
    expect(lab_.forgejo.pulls[0]?.title).toBe(expected);
    expect(lab_.forgejo.bodies.find((b) => b.route === PATCH)?.body).toEqual({ title: expected });
  });

  it('turns a ready pull request back into a draft with --undo', async () => {
    const lab_ = await lab('feat: export');
    const run = await lab_.run([...ready, '1', '--undo']);

    expect(run.code, run.stderr).toBe(0);
    expect(run.stdout).toBe(`#1 is now a draft: ${HOST}/acme/widgets/pulls/1\n`);
    expect(lab_.forgejo.pulls[0]?.title).toBe('WIP: feat: export');
  });

  it('sends nothing when the pull request is already ready', async () => {
    const lab_ = await lab('feat: export');
    const run = await lab_.run([...ready, '1']);

    expect(run.code, run.stderr).toBe(0);
    expect(run.stdout).toBe('#1 is already ready for review; nothing was changed.\n');
    expect(lab_.forgejo.count(PATCH)).toBe(0);
  });

  it('sends nothing when --undo finds a draft already', async () => {
    const lab_ = await lab('[WIP] feat: export');
    const run = await lab_.run([...ready, '1', '--undo']);

    expect(run.stdout).toBe('#1 is already a draft; nothing was changed.\n');
    expect(lab_.forgejo.count(PATCH)).toBe(0);
    expect(lab_.forgejo.pulls[0]?.title).toBe('[WIP] feat: export');
  });

  it('reports the result with --json', async () => {
    const lab_ = await lab('WIP: feat: export');
    const run = await lab_.run([...ready, '1', '--json']);
    expect(run.json()).toEqual({
      repo: 'acme/widgets',
      number: 1,
      url: `${HOST}/acme/widgets/pulls/1`,
      title: 'feat: export',
      draft: false,
      changed: true,
    });
  });

  it('acts on the open pull request of the checked-out branch without a number', async () => {
    const lab_ = await lab('WIP: feat: export');
    lab_.git.branch = 'feat/export';
    const run = await lab_.run(ready);

    expect(run.code, run.stderr).toBe(0);
    expect(lab_.forgejo.pulls[0]?.title).toBe('feat: export');
  });

  it('says so when the checked-out branch has no open pull request', async () => {
    const lab_ = await lab('WIP: feat: export');
    lab_.git.branch = 'feat/other';
    const run = await lab_.run(ready);

    expect(run.code).toBe(5);
    expect(run.stderr).toContain('feat/other');
    expect(lab_.forgejo.count(PATCH)).toBe(0);
  });

  it('refuses a merged pull request', async () => {
    const lab_ = await lab('WIP: feat: export');
    lab_.forgejo.pulls[0]!.merged = true;
    lab_.forgejo.pulls[0]!.state = 'closed';
    const run = await lab_.run([...ready, '1']);

    expect(run.code).toBe(6);
    expect(run.stderr).toContain('#1 is merged');
    expect(lab_.forgejo.count(PATCH)).toBe(0);
  });

  it('does not report a change the server did not make', async () => {
    const lab_ = await lab('WIP: feat: export');
    lab_.forgejo.ignoreTitleEdits = true;
    const run = await lab_.run([...ready, '1']);

    expect(run.code).toBe(6);
    expect(run.stderr).toContain('still reads as a draft');
  });

  it('lets pr merge accept the pull request once it is ready', async () => {
    const lab_ = await lab('WIP: feat: export');
    const merge = ['pr', 'merge', '1', '--repo', 'acme/widgets'];

    const blocked = await lab_.run(merge);
    expect(blocked.code).toBe(6);
    expect(blocked.stderr).toContain('sdlc-forgejo pr ready 1');

    await lab_.run([...ready, '1']);
    const merged = await lab_.run(merge);
    expect(merged.code, merged.stderr).toBe(0);
    expect(lab_.forgejo.pulls[0]?.merged).toBe(true);
  });

  it('rejects a malformed number before contacting the server', async () => {
    const lab_ = await lab('WIP: feat: export');
    const run = await lab_.run([...ready, 'abc']);
    expect(run.code).toBe(2);
    expect(lab_.forgejo.log).toEqual([]);
  });
});
