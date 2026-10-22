import { describe, expect, it } from 'vitest';
import { Lab } from './support/lab.js';

const HEAD = 'd'.repeat(40);
const NEXT = 'e'.repeat(40);
const MERGE = 'POST /repos/acme/widgets/pulls/1/merge';
const merge = ['pr', 'merge', '1', '--repo', 'acme/widgets'];

const STATUSES = { SDLC_FORGEJO_MERGE_REQUIRED_STATUSES: 'bot/review' };
const APPROVALS = { SDLC_FORGEJO_MERGE_REQUIRED_APPROVALS: '1' };

async function open(): Promise<Lab> {
  const lab = new Lab();
  await lab.signInWithToken();
  lab.forgejo.push('feat/export', HEAD);
  lab.forgejo.addPull({ head: 'feat/export', title: 'feat: export' });
  return lab;
}

interface Blocked {
  readonly code: string;
  readonly causes: string[];
  readonly details: {
    violations: string[];
    warnings: string[];
    unmet: Record<string, unknown>[];
  };
}

/** The merge is refused with exit code 6 and no merge request reaches the server. */
async function refused(lab: Lab, env: Record<string, string>, extra: string[] = []) {
  const run = await lab.run([...merge, ...extra, '--json'], { env });
  expect(run.code, run.stderr).toBe(6);
  expect(lab.forgejo.count(MERGE)).toBe(0);
  const error = run.errorJson().error as unknown as Blocked;
  expect(error.code).toBe('merge_blocked');
  return error;
}

describe('pr merge with required statuses', () => {
  it('is refused when the required status was never reported, and says so', async () => {
    const lab = await open();
    const error = await refused(lab, STATUSES);
    expect(error.causes).toEqual([
      'Required status "bot/review" has not been reported for the current head dddddddd.',
    ]);
    expect(error.details.unmet).toEqual([
      { kind: 'status', context: 'bot/review', state: 'missing', url: null },
    ]);
  });

  it.each(['pending', 'failure', 'error', 'warning'])(
    'is refused while the status is %s',
    async (state) => {
      const lab = await open();
      lab.forgejo.statuses.set(HEAD, [
        { id: 1, context: 'bot/review', status: state, target_url: 'https://ci.example.test/1' },
      ]);
      const error = await refused(lab, STATUSES);
      expect(error.details.unmet).toEqual([
        { kind: 'status', context: 'bot/review', state, url: 'https://ci.example.test/1' },
      ]);
    },
  );

  it('leaves out the link when the server reports an empty one', async () => {
    const lab = await open();
    lab.forgejo.statuses.set(HEAD, [
      { id: 1, context: 'bot/review', status: 'pending', target_url: '' },
    ]);
    const error = await refused(lab, STATUSES);
    expect(error.causes).toEqual(['Required status "bot/review" must be success but is pending.']);
    expect(error.details.unmet).toEqual([
      { kind: 'status', context: 'bot/review', state: 'pending', url: null },
    ]);
  });

  it('does not count a status that was recorded for an older head', async () => {
    const lab = await open();
    lab.forgejo.statuses.set(HEAD, [{ id: 1, context: 'bot/review', status: 'success' }]);
    lab.forgejo.advanceHead(1, NEXT);
    const error = await refused(lab, STATUSES);
    expect(error.causes[0]).toContain('has not been reported for the current head eeeeeeee');
  });

  it('merges, pinned to the head it checked, once the status is success', async () => {
    const lab = await open();
    lab.forgejo.statuses.set(HEAD, [{ id: 1, context: 'bot/review', status: 'success' }]);
    const run = await lab.run([...merge, '--json'], { env: STATUSES });
    expect(run.code, run.stderr).toBe(0);
    expect(lab.forgejo.bodies.find((b) => b.route === MERGE)?.body).toMatchObject({
      Do: 'merge',
      head_commit_id: HEAD,
    });
    expect(run.json()).toMatchObject({ merged: true, method: 'merge' });
  });

  it('lets a rerun decide: a later success passes, a later failure blocks', async () => {
    const passing = await open();
    passing.forgejo.statuses.set(HEAD, [
      { id: 1, context: 'bot/review', status: 'failure' },
      { id: 2, context: 'bot/review', status: 'success' },
    ]);
    expect((await passing.run(merge, { env: STATUSES })).code).toBe(0);

    const failing = await open();
    failing.forgejo.statuses.set(HEAD, [
      { id: 1, context: 'bot/review', status: 'success' },
      { id: 2, context: 'bot/review', status: 'failure' },
    ]);
    await refused(failing, STATUSES);
  });

  it('reads every page of the status history', async () => {
    const lab = await open();
    lab.forgejo.pageCap = 2;
    lab.forgejo.statuses.set(HEAD, [
      { id: 1, context: 'bot/review', status: 'success' },
      ...Array.from({ length: 5 }, (_, index) => ({
        id: index + 2,
        context: `ci/job-${index}`,
        status: 'success',
      })),
    ]);
    const run = await lab.run(merge, { env: STATUSES });
    expect(run.code, run.stderr).toBe(0);
    expect(lab.forgejo.count(`GET /repos/acme/widgets/commits/${HEAD}/statuses`)).toBeGreaterThan(
      1,
    );
  });

  it('judges a context whose name contains a comma as one context', async () => {
    const lab = await open();
    lab.forgejo.statuses.set(HEAD, [
      { id: 1, context: 'build (node 22, linux)', status: 'success' },
      { id: 2, context: 'bot/review', status: 'success' },
    ]);
    const env = { SDLC_FORGEJO_MERGE_REQUIRED_STATUSES: 'build (node 22, linux), bot/review' };
    expect((await lab.run(merge, { env })).code).toBe(0);
  });

  it('stops with a permission error, not a guess, when the statuses cannot be read', async () => {
    const lab = await open();
    const original = lab.forgejo.handle;
    lab.forgejo.handle = (request) =>
      request.url.pathname.endsWith('/statuses')
        ? new Response(JSON.stringify({ message: 'forbidden' }), {
            status: 403,
            headers: { 'content-type': 'application/json' },
          })
        : original(request);
    const run = await lab.run([...merge, '--json'], { env: STATUSES });
    expect(run.code).toBe(4);
    expect(lab.forgejo.count(MERGE)).toBe(0);
  });

  it('keeps reporting CI results as warnings only when no status is required', async () => {
    const lab = await open();
    lab.forgejo.statuses.set(HEAD, [{ id: 1, context: 'ci/test', status: 'failure' }]);
    const run = await lab.run(merge);
    expect(run.code).toBe(0);
    expect(run.stderr).toContain('warning: CI check failed: ci/test');
  });
});

describe('pr merge with required approvals', () => {
  it('is refused without an approval, naming what is wanted', async () => {
    const lab = await open();
    const error = await refused(lab, APPROVALS);
    expect(error.causes).toEqual([
      'Approvals: 0 of 1 required for the current head dddddddd; 1 more needed from any reviewer.',
    ]);
    expect(error.details.unmet).toEqual([
      { kind: 'approval', required: 1, approvedBy: [], waitingFor: [], notCounted: [] },
    ]);
  });

  it('is refused when the approval was given for an older head, and merges after a new approval', async () => {
    const lab = await open();
    lab.forgejo.reviews.set(1, [{ user: 'bob', state: 'APPROVED' }]);
    lab.forgejo.advanceHead(1, NEXT);

    const error = await refused(lab, APPROVALS);
    expect(error.details.unmet[0]).toMatchObject({
      approvedBy: [],
      notCounted: [
        { reviewer: 'bob', reason: `approved ${HEAD.slice(0, 8)}, not the current head` },
      ],
    });

    lab.forgejo.reviews.get(1)?.push({ user: 'bob', state: 'APPROVED', commit: NEXT });
    const run = await lab.run([...merge, '--json'], { env: APPROVALS });
    expect(run.code, run.stderr).toBe(0);
    expect(lab.forgejo.bodies.find((b) => b.route === MERGE)?.body).toMatchObject({
      head_commit_id: NEXT,
    });
  });

  it('is refused for an approval on another commit that the server did not mark stale', async () => {
    const lab = await open();
    lab.forgejo.reviews.set(1, [{ user: 'bob', state: 'APPROVED', commit: NEXT }]);
    await refused(lab, APPROVALS);
  });

  it.each([
    ['left out of the answer', null],
    ['an empty string', ''],
  ])('is refused for an approval whose commit the server reports as %s', async (_, commit) => {
    const lab = await open();
    lab.forgejo.reviews.set(1, [{ user: 'bob', state: 'APPROVED', commit }]);
    const error = await refused(lab, APPROVALS);
    expect(error.details.unmet[0]).toMatchObject({
      approvedBy: [],
      notCounted: [{ reviewer: 'bob', reason: 'approval not tied to a commit' }],
    });
    expect(error.causes[0]).toContain('bob (approval not tied to a commit)');
  });

  it('is refused for a dismissed approval and for approval followed by a request for changes', async () => {
    const dismissed = await open();
    dismissed.forgejo.reviews.set(1, [{ user: 'bob', state: 'APPROVED', dismissed: true }]);
    await refused(dismissed, APPROVALS);

    const changed = await open();
    changed.forgejo.reviews.set(1, [
      { user: 'bob', state: 'APPROVED' },
      { user: 'bob', state: 'REQUEST_CHANGES' },
    ]);
    const error = await refused(changed, APPROVALS);
    expect(error.details.unmet[0]).toMatchObject({
      notCounted: [{ reviewer: 'bob', reason: 'requested changes' }],
    });
  });

  it('counts approvers by name or pattern, and demands as many as configured', async () => {
    const env = {
      SDLC_FORGEJO_MERGE_APPROVERS: 'alice, team-*',
      SDLC_FORGEJO_MERGE_REQUIRED_APPROVALS: '2',
    };
    const lab = await open();
    lab.forgejo.reviews.set(1, [
      { user: 'alice', state: 'APPROVED' },
      { user: 'mallory', state: 'APPROVED' },
    ]);
    const error = await refused(lab, env);
    expect(error.details.unmet[0]).toMatchObject({
      approvedBy: ['alice'],
      waitingFor: ['team-*'],
      notCounted: [{ reviewer: 'mallory', reason: 'not one of the required approvers' }],
    });

    lab.forgejo.reviews.get(1)?.push({ user: 'team-lead', state: 'APPROVED' });
    expect((await lab.run(merge, { env })).code).toBe(0);
  });

  it('defaults to one approval when approvers are listed', async () => {
    const env = { SDLC_FORGEJO_MERGE_APPROVERS: 'alice' };
    const lab = await open();
    await refused(lab, env);
    lab.forgejo.reviews.set(1, [{ user: 'Alice', state: 'APPROVED' }]);
    expect((await lab.run(merge, { env })).code).toBe(0);
  });

  it('reads every page of the reviews', async () => {
    const lab = await open();
    lab.forgejo.pageCap = 2;
    lab.forgejo.reviews.set(1, [
      { user: 'a', state: 'COMMENT' },
      { user: 'b', state: 'COMMENT' },
      { user: 'c', state: 'COMMENT' },
      { user: 'bob', state: 'APPROVED' },
    ]);
    expect((await lab.run(merge, { env: APPROVALS })).code).toBe(0);
  });

  it('warns, and still merges, while someone else has an open request for changes', async () => {
    const lab = await open();
    lab.forgejo.reviews.set(1, [
      { user: 'bob', state: 'APPROVED' },
      { user: 'dave', state: 'REQUEST_CHANGES' },
    ]);
    const run = await lab.run(merge, { env: APPROVALS });
    expect(run.code).toBe(0);
    expect(run.stderr).toContain('warning: Changes requested by dave are still open.');
  });

  it('does not read the reviews when no approvals are required', async () => {
    const lab = await open();
    await lab.run(merge);
    expect(lab.forgejo.count('GET /repos/acme/widgets/pulls/1/reviews')).toBe(0);
  });
});

describe('pr merge with several conditions', () => {
  const both = { ...STATUSES, ...APPROVALS };

  it('lists every unmet item at once', async () => {
    const lab = await open();
    const error = await refused(lab, both);
    expect(error.details.violations).toHaveLength(2);
    expect(error.details.unmet.map((entry) => entry.kind)).toEqual(['status', 'approval']);
  });

  it('lists structural problems and policy items together', async () => {
    const lab = await open();
    lab.forgejo.pulls[0]!.title = 'WIP: feat: export';
    const error = await refused(lab, both);
    expect(error.details.violations).toHaveLength(3);
    expect(error.causes[0]).toContain('is a draft');
  });

  it('merges only when every condition holds', async () => {
    const lab = await open();
    lab.forgejo.statuses.set(HEAD, [{ id: 1, context: 'bot/review', status: 'success' }]);
    await refused(lab, both);
    lab.forgejo.reviews.set(1, [{ user: 'bob', state: 'APPROVED' }]);
    expect((await lab.run(merge, { env: both })).code).toBe(0);
    expect(lab.forgejo.pulls[0]?.merged).toBe(true);
  });

  it('judges nothing for a pull request that is already merged or closed', async () => {
    const lab = await open();
    lab.forgejo.pulls[0]!.merged = true;
    lab.forgejo.pulls[0]!.state = 'closed';
    const error = await refused(lab, both);
    expect(error.details.violations).toEqual(['#1 is already merged.']);
    expect(error.details.unmet).toEqual([]);
  });

  it('reports no unmet items in the error of a pull request that has a policy but fails for another reason', async () => {
    const lab = await open();
    lab.forgejo.statuses.set(HEAD, [{ id: 1, context: 'bot/review', status: 'success' }]);
    lab.forgejo.reviews.set(1, [{ user: 'bob', state: 'APPROVED' }]);
    const error = await refused(lab, both, ['--expect-base', 'release']);
    expect(error.details.unmet).toEqual([]);
  });
});

describe('pr merge with a configuration it cannot act on', () => {
  async function failsLocally(env: Record<string, string>, extra: string[] = []) {
    const lab = await open();
    const run = await lab.run([...merge, ...extra, '--json'], { env });
    expect(run.code).toBe(2);
    expect(lab.fetch.calls).toHaveLength(0);
    return run.errorJson().error;
  }

  it('an approval count that is not a positive number', async () => {
    const error = await failsLocally({ SDLC_FORGEJO_MERGE_REQUIRED_APPROVALS: 'two' });
    expect(error.code).toBe('invalid_setting');
  });

  it('more approvals than the named approvers can give', async () => {
    const error = await failsLocally({
      SDLC_FORGEJO_MERGE_REQUIRED_APPROVALS: '3',
      SDLC_FORGEJO_MERGE_APPROVERS: 'alice,bob',
    });
    expect(error.code).toBe('invalid_setting');
  });

  it('an unknown merge method in the configuration', async () => {
    const error = await failsLocally({ SDLC_FORGEJO_MERGE_METHODS: 'merge,yolo' });
    expect(error.message).toContain('yolo');
  });
});

describe('pr merge method lock', () => {
  it.each(['squash', 'rebase', 'rebase-merge', 'fast-forward-only'])(
    'rejects --method %s by default, before any request',
    async (method) => {
      const lab = await open();
      const run = await lab.run([...merge, '--method', method, '--json']);
      expect(run.code).toBe(2);
      expect(lab.fetch.calls).toHaveLength(0);
      expect(run.errorJson().error).toMatchObject({
        code: 'merge_method_not_allowed',
        details: { requested: method, allowed: ['merge'] },
      });
      expect(lab.forgejo.pulls[0]?.merged).toBe(false);
    },
  );

  it('rejects a method outside an explicit list', async () => {
    const lab = await open();
    const env = { SDLC_FORGEJO_MERGE_METHODS: 'merge, squash' };
    const run = await lab.run([...merge, '--method', 'rebase'], { env });
    expect(run.code).toBe(2);
    expect(run.stderr).toContain('"rebase" is not allowed here');
    expect(run.stderr).toContain('allows only: merge, squash');
    expect(lab.fetch.calls).toHaveLength(0);
  });

  it('merges with a merge commit when --method merge is given', async () => {
    const lab = await open();
    const run = await lab.run([...merge, '--method', 'merge']);
    expect(run.code, run.stderr).toBe(0);
    expect(lab.forgejo.bodies.find((b) => b.route === MERGE)?.body).toMatchObject({ Do: 'merge' });
  });

  it('merges with an allowed method the server is asked for by name, and leaves the commit text to the server', async () => {
    const lab = await open();
    const env = { SDLC_FORGEJO_MERGE_METHODS: 'merge,squash' };
    const run = await lab.run([...merge, '--method', 'squash', '--json'], { env });
    expect(run.code, run.stderr).toBe(0);
    expect(lab.forgejo.bodies.find((b) => b.route === MERGE)?.body).toEqual({
      Do: 'squash',
      delete_branch_after_merge: true,
      head_commit_id: HEAD,
    });
    expect(run.json()).toMatchObject({ method: 'squash' });
  });

  it('uses the first allowed method when none is given', async () => {
    const lab = await open();
    const env = { SDLC_FORGEJO_MERGE_METHODS: 'rebase-merge,merge' };
    await lab.run(merge, { env });
    expect(lab.forgejo.bodies.find((b) => b.route === MERGE)?.body).toMatchObject({
      Do: 'rebase-merge',
    });
  });

  it('explains a method the repository itself has disabled', async () => {
    const lab = await open();
    lab.forgejo.enabledMergeMethods.delete('squash');
    const env = { SDLC_FORGEJO_MERGE_METHODS: 'squash' };
    const run = await lab.run([...merge, '--json'], { env });
    expect(run.code).toBe(6);
    expect(run.errorJson().error).toMatchObject({ code: 'merge_rejected' });
    expect(JSON.stringify(run.errorJson().error.causes)).toContain(
      'does not enable the requested merge method',
    );
  });

  it('checks the policy before a permitted method is used', async () => {
    const lab = await open();
    const env = { SDLC_FORGEJO_MERGE_METHODS: 'squash', ...STATUSES };
    const run = await lab.run([...merge, '--json'], { env });
    expect(run.code).toBe(6);
    expect(lab.forgejo.count(MERGE)).toBe(0);
  });

  it('shows the methods in the help', async () => {
    const lab = await open();
    const run = await lab.run(['pr', 'merge', '--help']);
    expect(run.stdout).toContain('--method');
    expect(run.stdout).toContain('fast-forward-only');
  });
});
