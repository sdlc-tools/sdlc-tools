import { isCliError } from '@sdlc-tools/core';
import { describe, expect, it } from 'vitest';
import { splitOutsideBrackets, mergeLogins } from '../src/lists.js';
import type { Review, StatusRecord } from '../src/model.js';
import {
  buildMergePolicy,
  chooseMergeMethod,
  evaluatePolicy,
  latestDecisions,
  type MergePolicy,
  type MergePolicySettings,
} from '../src/policy.js';

const HEAD = 'd'.repeat(40);
const OLD = 'b'.repeat(40);

const none: MergePolicySettings = {
  mergeRequiredStatuses: undefined,
  mergeRequiredApprovals: undefined,
  mergeApprovers: undefined,
  mergeMethods: undefined,
};
const policyOf = (settings: Partial<MergePolicySettings>): MergePolicy =>
  buildMergePolicy({ ...none, ...settings });

const status = (id: number, context: string, state: string, url: string | null = null) =>
  ({ id, context, state, url }) satisfies StatusRecord;

const review = (
  id: number,
  reviewer: string,
  state: string,
  extra: Partial<Review> = {},
): Review => ({
  id,
  reviewer,
  state,
  commit: HEAD,
  stale: false,
  dismissed: false,
  ...extra,
});

function configError(settings: Partial<MergePolicySettings>) {
  try {
    policyOf(settings);
  } catch (error) {
    if (isCliError(error)) return error;
    throw error;
  }
  throw new Error('the settings were accepted');
}

describe('lists', () => {
  it('keeps a comma inside parentheses or brackets within one item', () => {
    expect(splitOutsideBrackets('ci/lint, build (node 22, linux), [a, b] x,, ')).toEqual([
      'ci/lint',
      'build (node 22, linux)',
      '[a, b] x',
    ]);
    expect(splitOutsideBrackets('broken (open, ok')).toEqual(['broken (open, ok']);
    expect(splitOutsideBrackets(undefined)).toEqual([]);
  });

  it('lists each user once, whatever the case, keeping the first spelling', () => {
    expect(mergeLogins(['Bob', 'carol'], ['bob', 'dave'], [])).toEqual(['Bob', 'carol', 'dave']);
  });
});

describe('buildMergePolicy', () => {
  it('requires nothing and allows only merge commits when nothing is configured', () => {
    expect(policyOf({})).toEqual({ statuses: [], approvals: 0, approvers: [], methods: ['merge'] });
  });

  it('reads statuses once each and approvers as names or patterns', () => {
    const policy = policyOf({
      mergeRequiredStatuses: 'bot/review, ci/build (a, b), bot/review',
      mergeApprovers: 'alice, Bob, bot-*, alice',
    });
    expect(policy.statuses).toEqual(['bot/review', 'ci/build (a, b)']);
    expect(policy.approvers.map((rule) => rule.entry)).toEqual(['alice', 'Bob', 'bot-*']);
    expect(policy.approvals).toBe(1);
  });

  it('matches approvers against the whole login, ignoring case, with * for any run of characters', () => {
    const [name, prefix, anything] = policyOf({ mergeApprovers: 'Alice, bot-*, *' }).approvers;
    expect(name?.test('alice')).toBe(true);
    expect(name?.test('malice')).toBe(false);
    expect(name?.test('alice2')).toBe(false);
    expect(prefix?.test('BOT-review')).toBe(true);
    expect(prefix?.test('robot-review')).toBe(false);
    expect(anything?.test('whoever')).toBe(true);
  });

  it('treats characters other than * in an approver as plain text', () => {
    const [rule] = policyOf({ mergeApprovers: 'a.b+c' }).approvers;
    expect(rule?.test('a.b+c')).toBe(true);
    expect(rule?.test('aXbbc')).toBe(false);
  });

  it('takes the number of approvals from the setting', () => {
    expect(policyOf({ mergeRequiredApprovals: '2' }).approvals).toBe(2);
    expect(policyOf({ mergeRequiredApprovals: '2', mergeApprovers: 'a, b, c' }).approvals).toBe(2);
  });

  it.each(['0', '-1', 'two', '1.5', ''])('rejects %j as a number of approvals', (value) => {
    const error = configError({ mergeRequiredApprovals: value });
    expect(error.code).toBe('invalid_setting');
    expect(error.message).toContain('mergeRequiredApprovals');
    expect(error.exitCode).toBe(2);
  });

  it('rejects more approvals than the named approvers can give, but not when a pattern is present', () => {
    const error = configError({ mergeRequiredApprovals: '3', mergeApprovers: 'alice, bob' });
    expect(error.message).toContain('no pull request could ever be merged');
    expect(
      policyOf({ mergeRequiredApprovals: '3', mergeApprovers: 'alice, team-*' }).approvals,
    ).toBe(3);
  });

  it('reads the allowed merge methods in order, case-insensitively', () => {
    expect(policyOf({ mergeMethods: 'Squash, merge, squash' }).methods).toEqual([
      'squash',
      'merge',
    ]);
  });

  it('rejects an unknown merge method, an empty list, and the method that only records a merge', () => {
    expect(configError({ mergeMethods: 'merge, yolo' }).message).toContain('yolo');
    expect(configError({ mergeMethods: ' , ' }).message).toContain('names no merge method');
    expect(configError({ mergeMethods: 'manually-merged' }).message).toContain('manually-merged');
  });
});

describe('chooseMergeMethod', () => {
  it('uses the first allowed method unless another allowed one is asked for', () => {
    const policy = policyOf({ mergeMethods: 'squash, merge' });
    expect(chooseMergeMethod(policy, undefined)).toBe('squash');
    expect(chooseMergeMethod(policy, 'merge')).toBe('merge');
  });

  it('refuses every other method and never suggests loosening the policy', () => {
    const policy = policyOf({});
    for (const method of ['squash', 'rebase', 'rebase-merge', 'fast-forward-only'] as const) {
      let error;
      try {
        chooseMergeMethod(policy, method);
      } catch (caught) {
        error = caught;
      }
      expect(isCliError(error) && error.code).toBe('merge_method_not_allowed');
      expect(isCliError(error) && error.exitCode).toBe(2);
      expect(isCliError(error) && error.next).toEqual([
        'Merge with --method merge, or leave --method out.',
      ]);
    }
  });
});

describe('required statuses', () => {
  const policy = policyOf({ mergeRequiredStatuses: 'bot/review, ci/build' });
  const judge = (statuses: StatusRecord[]) =>
    evaluatePolicy(policy, HEAD, { statuses, reviews: [] });

  it('are met when each context is success', () => {
    const verdict = judge([status(1, 'bot/review', 'success'), status(2, 'ci/build', 'success')]);
    expect(verdict).toEqual({ violations: [], warnings: [], unmet: [] });
  });

  it('names each context that was never reported', () => {
    const verdict = judge([status(1, 'ci/build', 'success')]);
    expect(verdict.violations).toEqual([
      'Required status "bot/review" has not been reported for the current head dddddddd.',
    ]);
    expect(verdict.unmet).toEqual([
      { kind: 'status', context: 'bot/review', state: 'missing', url: null },
    ]);
  });

  it.each(['pending', 'failure', 'error', 'warning'])('does not accept %s', (state) => {
    const verdict = judge([
      status(1, 'bot/review', state, 'https://ci.example.test/1'),
      status(2, 'ci/build', 'success'),
    ]);
    expect(verdict.violations).toEqual([
      `Required status "bot/review" must be success but is ${state} (https://ci.example.test/1).`,
    ]);
    expect(verdict.unmet).toEqual([
      { kind: 'status', context: 'bot/review', state, url: 'https://ci.example.test/1' },
    ]);
  });

  it('lets the newest result of a context decide, in either direction', () => {
    expect(
      judge([
        status(1, 'bot/review', 'failure'),
        status(5, 'bot/review', 'success'),
        status(2, 'ci/build', 'success'),
      ]).violations,
    ).toEqual([]);
    expect(
      judge([
        status(1, 'bot/review', 'success'),
        status(5, 'bot/review', 'pending'),
        status(2, 'ci/build', 'success'),
      ]).violations,
    ).toHaveLength(1);
  });

  it('matches the context exactly, not by prefix or case', () => {
    const verdict = judge([
      status(1, 'bot/review-extra', 'success'),
      status(2, 'Bot/Review', 'success'),
      status(3, 'ci/build', 'success'),
    ]);
    expect(verdict.unmet).toHaveLength(1);
  });

  it('ignores statuses that are not required', () => {
    const verdict = judge([
      status(1, 'bot/review', 'success'),
      status(2, 'ci/build', 'success'),
      status(3, 'extra/check', 'failure'),
    ]);
    expect(verdict.violations).toEqual([]);
  });
});

describe('required approvals', () => {
  const judge = (policy: MergePolicy, reviews: Review[]) =>
    evaluatePolicy(policy, HEAD, { statuses: [], reviews });

  it('asks for nothing when no approvals are required', () => {
    expect(judge(policyOf({}), [])).toEqual({ violations: [], warnings: [], unmet: [] });
  });

  it('counts an approval written on the head commit', () => {
    const verdict = judge(policyOf({ mergeRequiredApprovals: '1' }), [
      review(1, 'bob', 'APPROVED'),
    ]);
    expect(verdict.violations).toEqual([]);
  });

  it('reports the shortfall, who is still wanted, and who was not counted and why', () => {
    const verdict = judge(
      policyOf({ mergeRequiredApprovals: '2', mergeApprovers: 'bob, carol, team-*' }),
      [
        review(1, 'bob', 'APPROVED'),
        review(2, 'carol', 'APPROVED', { commit: OLD, stale: true }),
        review(3, 'dave', 'REQUEST_CHANGES'),
        review(4, 'erin', 'APPROVED'),
      ],
    );
    expect(verdict.violations).toEqual([
      'Approvals: 1 of 2 required for the current head dddddddd (bob); 1 more needed from carol, team-*. Not counted: carol (approved bbbbbbbb, not the current head), dave (requested changes), erin (not one of the required approvers).',
    ]);
    expect(verdict.unmet).toEqual([
      {
        kind: 'approval',
        required: 2,
        approvedBy: ['bob'],
        waitingFor: ['carol', 'team-*'],
        notCounted: [
          { reviewer: 'carol', reason: 'approved bbbbbbbb, not the current head' },
          { reviewer: 'dave', reason: 'requested changes' },
          { reviewer: 'erin', reason: 'not one of the required approvers' },
        ],
      },
    ]);
  });

  it('says "any reviewer" when anyone may approve', () => {
    const verdict = judge(policyOf({ mergeRequiredApprovals: '1' }), []);
    expect(verdict.violations).toEqual([
      'Approvals: 0 of 1 required for the current head dddddddd; 1 more needed from any reviewer.',
    ]);
  });

  it('does not count an approval the server marks stale, even when it names the head', () => {
    const verdict = judge(policyOf({ mergeRequiredApprovals: '1' }), [
      review(1, 'bob', 'APPROVED', { stale: true }),
    ]);
    expect(verdict.unmet).toHaveLength(1);
    expect(verdict.violations[0]).toContain('bob (approval is stale: the head changed after it)');
  });

  it('does not count an approval written on another commit, even when the server does not mark it stale', () => {
    const verdict = judge(policyOf({ mergeRequiredApprovals: '1' }), [
      review(1, 'bob', 'APPROVED', { commit: OLD }),
    ]);
    expect(verdict.violations[0]).toContain('bob (approved bbbbbbbb, not the current head)');
  });

  it('does not count an approval the server does not tie to a commit, whether or not it is marked stale', () => {
    const policy = policyOf({ mergeRequiredApprovals: '1' });
    for (const stale of [false, true]) {
      const verdict = judge(policy, [review(1, 'bob', 'APPROVED', { commit: null, stale })]);
      expect(verdict.violations[0]).toContain('bob (approval not tied to a commit)');
      expect(verdict.unmet[0]).toMatchObject({
        approvedBy: [],
        notCounted: [{ reviewer: 'bob', reason: 'approval not tied to a commit' }],
      });
    }
  });

  it('compares commits ignoring case', () => {
    const verdict = judge(policyOf({ mergeRequiredApprovals: '1' }), [
      review(1, 'bob', 'APPROVED', { commit: HEAD.toUpperCase() }),
    ]);
    expect(verdict.violations).toEqual([]);
  });

  it('does not count a dismissed approval', () => {
    const verdict = judge(policyOf({ mergeRequiredApprovals: '1' }), [
      review(1, 'bob', 'APPROVED', { dismissed: true }),
    ]);
    expect(verdict.violations[0]).toContain('bob (approval dismissed)');
  });

  it('lets a later request for changes replace an earlier approval, and a later approval replace it back', () => {
    const policy = policyOf({ mergeRequiredApprovals: '1' });
    expect(
      judge(policy, [review(1, 'bob', 'APPROVED'), review(2, 'bob', 'REQUEST_CHANGES')]).violations,
    ).toHaveLength(1);
    expect(
      judge(policy, [review(1, 'bob', 'REQUEST_CHANGES'), review(2, 'bob', 'APPROVED')]).violations,
    ).toEqual([]);
  });

  it('keeps an approval through later comments', () => {
    const verdict = judge(policyOf({ mergeRequiredApprovals: '1' }), [
      review(1, 'bob', 'APPROVED'),
      review(2, 'bob', 'COMMENT'),
    ]);
    expect(verdict.violations).toEqual([]);
  });

  it('orders reviews by id, not by the order the server listed them', () => {
    const verdict = judge(policyOf({ mergeRequiredApprovals: '1' }), [
      review(2, 'bob', 'APPROVED'),
      review(1, 'bob', 'REQUEST_CHANGES', { dismissed: true }),
    ]);
    expect(verdict.violations).toEqual([]);
  });

  it('counts each approver once, whatever the case of the login', () => {
    const verdict = judge(policyOf({ mergeRequiredApprovals: '2' }), [
      review(1, 'Bob', 'APPROVED'),
      review(2, 'bob', 'APPROVED'),
    ]);
    expect(verdict.unmet[0]).toMatchObject({ approvedBy: ['bob'] });
  });

  it('accepts a pattern approver and a named approver together', () => {
    const verdict = judge(
      policyOf({ mergeRequiredApprovals: '2', mergeApprovers: 'alice, team-*' }),
      [review(1, 'ALICE', 'APPROVED'), review(2, 'team-lead', 'APPROVED')],
    );
    expect(verdict.violations).toEqual([]);
  });

  it('warns about open requests for changes when the approvals are in', () => {
    const verdict = judge(policyOf({ mergeRequiredApprovals: '1' }), [
      review(1, 'bob', 'APPROVED'),
      review(2, 'dave', 'REQUEST_CHANGES'),
      review(3, 'erin', 'REQUEST_CHANGES', { dismissed: true }),
    ]);
    expect(verdict.violations).toEqual([]);
    expect(verdict.warnings).toEqual(['Changes requested by dave are still open.']);
  });
});

describe('latestDecisions', () => {
  it('keeps the latest approval or change request of each reviewer and drops plain comments', () => {
    const decisions = latestDecisions([
      review(3, 'bob', 'COMMENT'),
      review(1, 'bob', 'APPROVED'),
      review(2, 'carol', 'REQUEST_CHANGES'),
      review(4, 'carol', 'PENDING'),
    ]);
    expect(decisions.map((entry) => [entry.reviewer, entry.state])).toEqual([
      ['bob', 'APPROVED'],
      ['carol', 'REQUEST_CHANGES'],
    ]);
  });
});
