import { CliError } from '@sdlc-tools/core';
import { mergeLogins, splitList, splitOutsideBrackets } from './lists.js';
import { MERGE_METHODS, type MergeMethod, type Review, type StatusRecord } from './model.js';
import { latestStatuses } from './statuses.js';

/** A user name, or a pattern in which `*` stands for any run of characters; matched against the whole login. */
export interface ApproverRule {
  readonly entry: string;
  readonly wildcard: boolean;
  readonly test: (login: string) => boolean;
}

/** What a pull request has to satisfy before it may be merged, as the configuration states it. */
export interface MergePolicy {
  /** Status contexts whose latest result on the head commit must be `success`. */
  readonly statuses: readonly string[];
  /** Approvals needed on the head commit; 0 when none are required. */
  readonly approvals: number;
  /** Who may approve; empty when anyone may. */
  readonly approvers: readonly ApproverRule[];
  /** The merge methods that may be used; the first is the default. */
  readonly methods: readonly MergeMethod[];
}

export interface MergePolicySettings {
  readonly mergeRequiredStatuses: string | undefined;
  readonly mergeRequiredApprovals: string | undefined;
  readonly mergeApprovers: string | undefined;
  readonly mergeMethods: string | undefined;
}

const invalid = (message: string, next: readonly string[]): CliError =>
  new CliError('config', message, { code: 'invalid_setting', next });

const isMergeMethod = (value: string): value is MergeMethod =>
  (MERGE_METHODS as readonly string[]).includes(value);

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function approverRule(entry: string): ApproverRule {
  const pattern = new RegExp(`^${entry.split('*').map(escapeRegExp).join('.*')}$`, 'iu');
  return { entry, wildcard: entry.includes('*'), test: (login) => pattern.test(login) };
}

/** Reads the policy settings; anything that cannot be satisfied or understood fails here, before a request. */
export function buildMergePolicy(settings: MergePolicySettings): MergePolicy {
  const statuses = [...new Set(splitOutsideBrackets(settings.mergeRequiredStatuses))];

  const approvers = mergeLogins(splitList(settings.mergeApprovers)).map(approverRule);

  let approvals = approvers.length > 0 ? 1 : 0;
  if (settings.mergeRequiredApprovals !== undefined) {
    const text = settings.mergeRequiredApprovals.trim();
    if (!/^[1-9]\d*$/.test(text)) {
      throw invalid(`"mergeRequiredApprovals" must be a positive whole number, not "${text}".`, [
        'Set the number of approvals a pull request needs, for example 2, or remove the setting.',
      ]);
    }
    approvals = Number(text);
  }
  if (
    approvers.length > 0 &&
    !approvers.some((rule) => rule.wildcard) &&
    approvals > approvers.length
  ) {
    throw invalid(
      `"mergeRequiredApprovals" asks for ${approvals} approvals, but "mergeApprovers" names only ${approvers.length} user(s), so no pull request could ever be merged.`,
      ['Lower the number of approvals, or add approvers or a pattern such as "team-*".'],
    );
  }

  const requested =
    settings.mergeMethods === undefined
      ? ['merge']
      : splitList(settings.mergeMethods).map((method) => method.toLowerCase());
  if (requested.length === 0) {
    throw invalid('"mergeMethods" names no merge method.', [
      `Choose from: ${MERGE_METHODS.join(', ')}.`,
    ]);
  }
  const unknown = requested.filter((method) => !isMergeMethod(method));
  if (unknown.length > 0) {
    throw invalid(`"mergeMethods" contains unknown method(s): ${unknown.join(', ')}.`, [
      `Choose from: ${MERGE_METHODS.join(', ')}.`,
    ]);
  }
  const methods = [...new Set(requested.filter(isMergeMethod))];

  return { statuses, approvals, approvers, methods };
}

/** What the commands have to fetch from the server to judge the policy. */
export const needsStatuses = (policy: MergePolicy): boolean => policy.statuses.length > 0;
export const needsReviews = (policy: MergePolicy): boolean => policy.approvals > 0;

/**
 * The method a merge uses: the one asked for, or the policy's first. A request outside the
 * policy is refused here, locally. The advice never says how to loosen the policy: the point of
 * enforcing it in a tool is that whoever runs the command cannot talk it away.
 */
export function chooseMergeMethod(
  policy: MergePolicy,
  requested: MergeMethod | undefined,
): MergeMethod {
  const method = requested ?? policy.methods[0] ?? 'merge';
  if (policy.methods.includes(method)) return method;
  throw new CliError('usage', `Merging with "${method}" is not allowed here.`, {
    code: 'merge_method_not_allowed',
    causes: [`The "mergeMethods" setting allows only: ${policy.methods.join(', ')}.`],
    next: [`Merge with --method ${policy.methods[0] ?? 'merge'}, or leave --method out.`],
    details: { requested: method, allowed: policy.methods },
  });
}

export interface PolicyEvidence {
  /** The results reported for the head commit, reruns included. */
  readonly statuses: readonly StatusRecord[];
  readonly reviews: readonly Review[];
}

export interface UnmetStatus {
  readonly kind: 'status';
  readonly context: string;
  /** `missing` when nothing was reported for the head commit; otherwise the state the server has. */
  readonly state: string;
  readonly url: string | null;
}

export interface UnmetApproval {
  readonly kind: 'approval';
  readonly required: number;
  readonly approvedBy: readonly string[];
  /** The entries of `mergeApprovers` that can still supply an approval; empty when anyone may. */
  readonly waitingFor: readonly string[];
  readonly notCounted: readonly { readonly reviewer: string; readonly reason: string }[];
}

export type UnmetCondition = UnmetStatus | UnmetApproval;

export interface PolicyVerdict {
  readonly violations: readonly string[];
  readonly warnings: readonly string[];
  readonly unmet: readonly UnmetCondition[];
}

/**
 * The latest decisive review of each reviewer, oldest reviewer first. Comments decide nothing, and a
 * later review replaces an earlier one, so an approval followed by a request for changes is gone.
 */
export function latestDecisions(reviews: readonly Review[]): Review[] {
  const latest = new Map<string, Review>();
  for (const review of [...reviews].sort((a, b) => a.id - b.id)) {
    if (review.reviewer === null) continue;
    if (review.state === 'APPROVED' || review.state === 'REQUEST_CHANGES') {
      latest.set(review.reviewer.toLowerCase(), review);
    }
  }
  return [...latest.values()];
}

const short = (sha: string): string => sha.slice(0, 8);

/**
 * An approval counts for the head only if the server says it was written on that very commit and
 * has not marked it stale. An approval whose commit is unknown cannot be tied to the head and does
 * not count: Forgejo 15 keeps `stale: false` on an approval for an older commit, so the flag alone proves nothing.
 */
function approvalFailure(review: Review, head: string): string | undefined {
  if (review.dismissed) return 'approval dismissed';
  if (review.commit === null) return 'approval not tied to a commit';
  if (review.commit.toLowerCase() !== head.toLowerCase()) {
    return `approved ${short(review.commit)}, not the current head`;
  }
  if (review.stale) return 'approval is stale: the head changed after it';
  return undefined;
}

function judgeStatuses(
  policy: MergePolicy,
  head: string,
  history: readonly StatusRecord[],
): { violations: string[]; unmet: UnmetStatus[] } {
  const latest = new Map(latestStatuses(history).map((record) => [record.context, record]));
  const violations: string[] = [];
  const unmet: UnmetStatus[] = [];
  for (const context of policy.statuses) {
    const record = latest.get(context);
    if (record?.state === 'success') continue;
    if (record === undefined) {
      unmet.push({ kind: 'status', context, state: 'missing', url: null });
      violations.push(
        `Required status "${context}" has not been reported for the current head ${short(head)}.`,
      );
    } else {
      unmet.push({ kind: 'status', context, state: record.state, url: record.url });
      violations.push(
        `Required status "${context}" must be success but is ${record.state}${record.url === null ? '' : ` (${record.url})`}.`,
      );
    }
  }
  return { violations, unmet };
}

function judgeApprovals(
  policy: MergePolicy,
  head: string,
  reviews: readonly Review[],
): { violations: string[]; warnings: string[]; unmet: UnmetApproval[] } {
  const decisions = latestDecisions(reviews);
  const approvedBy: string[] = [];
  const notCounted: { reviewer: string; reason: string }[] = [];
  for (const review of decisions) {
    const reviewer = review.reviewer ?? '';
    const reason =
      review.state !== 'APPROVED'
        ? review.dismissed
          ? 'review dismissed'
          : 'requested changes'
        : policy.approvers.length > 0 && !policy.approvers.some((rule) => rule.test(reviewer))
          ? 'not one of the required approvers'
          : approvalFailure(review, head);
    if (reason === undefined) approvedBy.push(reviewer);
    else notCounted.push({ reviewer, reason });
  }

  const missing = policy.approvals - approvedBy.length;
  if (missing <= 0) {
    const open = decisions
      .filter((review) => review.state === 'REQUEST_CHANGES' && !review.dismissed)
      .map((review) => review.reviewer ?? '');
    return {
      violations: [],
      warnings:
        open.length === 0 ? [] : [`Changes requested by ${open.join(', ')} are still open.`],
      unmet: [],
    };
  }

  const approved = new Set(approvedBy.map((login) => login.toLowerCase()));
  const waitingFor = policy.approvers
    .filter((rule) => rule.wildcard || !approved.has(rule.entry.toLowerCase()))
    .map((rule) => rule.entry);
  const counted = approvedBy.length === 0 ? '' : ` (${approvedBy.join(', ')})`;
  const skipped =
    notCounted.length === 0
      ? ''
      : ` Not counted: ${notCounted.map((entry) => `${entry.reviewer} (${entry.reason})`).join(', ')}.`;
  return {
    violations: [
      `Approvals: ${approvedBy.length} of ${policy.approvals} required for the current head ${short(head)}${counted}; ${missing} more needed from ${waitingFor.length === 0 ? 'any reviewer' : waitingFor.join(', ')}.${skipped}`,
    ],
    warnings: [],
    unmet: [{ kind: 'approval', required: policy.approvals, approvedBy, waitingFor, notCounted }],
  };
}

/** Judges the policy against the head commit; nothing recorded for an older head is in the evidence. */
export function evaluatePolicy(
  policy: MergePolicy,
  head: string,
  evidence: PolicyEvidence,
): PolicyVerdict {
  const statuses = needsStatuses(policy)
    ? judgeStatuses(policy, head, evidence.statuses)
    : { violations: [], unmet: [] };
  const approvals = needsReviews(policy)
    ? judgeApprovals(policy, head, evidence.reviews)
    : { violations: [], warnings: [], unmet: [] };
  return {
    violations: [...statuses.violations, ...approvals.violations],
    warnings: approvals.warnings,
    unmet: [...statuses.unmet, ...approvals.unmet],
  };
}
