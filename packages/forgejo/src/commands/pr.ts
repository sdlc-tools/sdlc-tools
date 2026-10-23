import {
  CliError,
  defineCommand,
  defineGroup,
  isCliError,
  type CommandContext,
} from '@sdlc-tools/core';
import type { ForgejoApi } from '../api.js';
import { pullDetails, pullLine } from '../format.js';
import { mergeLogins, splitList } from '../lists.js';
import { MERGE_METHODS, type MergeMethod } from '../model.js';
import type { Ports } from '../ports.js';
import {
  buildMergePolicy,
  chooseMergeMethod,
  needsReviews,
  needsStatuses,
  type PolicyEvidence,
} from '../policy.js';
import {
  blockedError,
  buildTextRules,
  checkText,
  gateCreate,
  gateMerge,
  markDraft,
  type Verdict,
} from '../rules.js';
import { formatRepo, type RepoRef } from '../repo.js';
import { MERGE_POLICY_SETTINGS, resolveToolSettings } from '../settings.js';
import { summarizeStatuses } from '../statuses.js';
import {
  assertBranchName,
  openRepoSession,
  parsePullNumber,
  repoOptions,
  type RepoSession,
} from './shared.js';

const DEFAULT_LIMIT = 30;

async function readDescription(
  context: CommandContext,
  ports: Ports,
  options: { readonly body: string | undefined; readonly bodyFile: string | undefined },
): Promise<string> {
  if (options.body !== undefined && options.bodyFile !== undefined) {
    throw new CliError('usage', 'Give the description with --body or --body-file, not both.', {
      code: 'conflicting_options',
    });
  }
  if (options.body !== undefined) return options.body;
  if (options.bodyFile === undefined) {
    throw new CliError('usage', 'Missing the pull request description.', {
      code: 'missing_description',
      next: ['Pass --body "<text>", or --body-file <path> (use "-" for standard input).'],
    });
  }
  try {
    return options.bodyFile === '-'
      ? await context.stdin.readAll()
      : await ports.readTextFile(options.bodyFile);
  } catch (cause) {
    throw new CliError('usage', `Cannot read the description from ${options.bodyFile}.`, {
      code: 'description_unreadable',
      next: ['Check that the file exists and is readable.'],
      cause,
    });
  }
}

interface Assessment {
  readonly repo: RepoRef;
  readonly head: string;
  readonly base: string;
  readonly headSha: string | undefined;
  readonly localSha: string | undefined;
  readonly verdict: Verdict;
}

/** Everything that decides whether a pull request may be opened, gathered from the server and from git. */
async function assessCreate(
  context: CommandContext,
  ports: Ports,
  session: RepoSession,
  head: string,
  baseSetting: string | undefined,
): Promise<Assessment> {
  const { api, repo } = session;
  const repository = await api.getRepository(repo);
  const base = baseSetting ?? repository.defaultBranch;
  const [baseBranch, headBranch, pulls, localSha, changes, current] = await Promise.all([
    api.getBranch(repo, base),
    api.getBranch(repo, head),
    api.pullsForHead(repo, head),
    ports.git.resolveRef(context.cwd, `refs/heads/${head}`),
    ports.git.uncommittedChanges(context.cwd),
    ports.git.currentBranch(context.cwd),
  ]);
  const gate = gateCreate({
    head,
    base,
    baseExists: baseBranch !== undefined,
    remoteSha: headBranch?.sha,
    localSha,
    openPulls: pulls.open,
    closedPulls: pulls.closed,
  });
  const warnings = [...gate.warnings];
  if (current === head && changes !== undefined && changes.length > 0) {
    warnings.push(
      `${changes.length} uncommitted change(s) in the checkout are not part of the pull request.`,
    );
  }
  return {
    repo,
    head,
    base,
    headSha: headBranch?.sha,
    localSha,
    verdict: { violations: gate.violations, warnings },
  };
}

function createBlocked(assessment: Assessment): CliError {
  return blockedError(
    'create_blocked',
    `A pull request for "${assessment.head}" cannot be opened yet.`,
    assessment.verdict,
    [
      'Fix what is listed above, then run the command again.',
      'Check the state at any time with `sdlc-forgejo pr check`.',
    ],
  );
}

async function resolveLabelIds(
  api: ForgejoApi,
  repo: RepoRef,
  names: readonly string[],
): Promise<Map<string, number>> {
  const known = await api.listLabels(repo);
  const byName = new Map(known.map((label) => [label.name, label.id]));
  const unknown = names.filter((name) => !byName.has(name));
  if (unknown.length > 0) {
    throw new CliError(
      'not-found',
      `${formatRepo(repo)} has no label named ${unknown.join(', ')}.`,
      {
        code: 'unknown_label',
        causes: ['The name is misspelled; label names are matched exactly.'],
        next: [`Existing labels: ${known.map((label) => label.name).join(', ') || 'none'}.`],
      },
    );
  }
  return new Map(names.map((name) => [name, byName.get(name) ?? 0]));
}

const cliMessage = (error: unknown): string =>
  isCliError(error) ? error.message : error instanceof Error ? error.message : String(error);

export function prGroup(ports: Ports) {
  const list = defineCommand({
    name: 'list',
    summary: 'List pull requests',
    options: {
      ...repoOptions,
      state: {
        type: 'string',
        valueName: 'state',
        choices: ['open', 'closed', 'all'],
        default: 'open',
        description: 'Which pull requests to list',
      },
      head: {
        type: 'string',
        valueName: 'branch',
        description: 'Only pull requests from this branch',
      },
      base: {
        type: 'string',
        valueName: 'branch',
        description: 'Only pull requests into this branch',
      },
      limit: {
        type: 'string',
        valueName: 'count',
        default: String(DEFAULT_LIMIT),
        description: 'The most pull requests to list',
      },
    },
    async run({ options }, context) {
      if (!/^[1-9]\d*$/.test(options.limit)) {
        throw new CliError('usage', `"${options.limit}" is not a valid --limit.`, {
          code: 'invalid_limit',
          next: ['Use a positive whole number.'],
        });
      }
      const { values } = await resolveToolSettings(
        context,
        ['host', 'profile', 'clientId', 'repo'],
        {
          host: options.host,
          profile: options.profile,
          repo: options.repo,
        },
      );
      const { api, repo } = await openRepoSession(context, ports, values);
      const pulls = await api.listPulls(repo, {
        state: options.state,
        limit: Number(options.limit),
        accept: (pull) =>
          (options.head === undefined || pull.head.ref === options.head) &&
          (options.base === undefined || pull.base.ref === options.base),
      });
      return {
        data: { repo: formatRepo(repo), pulls },
        text: pulls.length === 0 ? 'No pull requests.' : pulls.map(pullLine).join('\n'),
      };
    },
  });

  const view = defineCommand({
    name: 'view',
    summary: 'Show a pull request with its reviews and CI results',
    positionals: [{ name: 'number', description: 'Pull request number', required: true }],
    options: { ...repoOptions },
    async run({ options, args }, context) {
      const number = parsePullNumber(args.number);
      const { values } = await resolveToolSettings(
        context,
        ['host', 'profile', 'clientId', 'repo'],
        {
          host: options.host,
          profile: options.profile,
          repo: options.repo,
        },
      );
      const { api, repo } = await openRepoSession(context, ports, values);
      const pull = await api.getPull(repo, number);
      const [reviews, ci] = await Promise.all([
        api.listReviews(repo, number),
        api.getCiSummary(repo, pull.head.sha),
      ]);
      return {
        data: { repo: formatRepo(repo), pull, reviews, ci: ci ?? null },
        text: pullDetails(pull, reviews, ci),
      };
    },
  });

  const check = defineCommand({
    name: 'check',
    summary: 'Check whether a pull request can be opened for a branch',
    description:
      'Reports what `pr create` would refuse: a branch that was not pushed or differs from the server, a pull request already open for it, a missing base. Exits with code 6 when it cannot be opened.',
    options: {
      ...repoOptions,
      head: {
        type: 'string',
        valueName: 'branch',
        description: 'Branch to check (default: the checked-out branch)',
      },
      base: {
        type: 'string',
        valueName: 'branch',
        description: 'Target branch (default: the repository default branch)',
      },
    },
    async run({ options }, context) {
      const { values } = await resolveToolSettings(
        context,
        ['host', 'profile', 'clientId', 'repo', 'base'],
        { host: options.host, profile: options.profile, repo: options.repo, base: options.base },
      );
      const head = await resolveHead(context, ports, options.head);
      const session = await openRepoSession(context, ports, values);
      const assessment = await assessCreate(context, ports, session, head, values.base);
      if (assessment.verdict.violations.length > 0) throw createBlocked(assessment);
      for (const warning of assessment.verdict.warnings) context.log(`warning: ${warning}`);
      return {
        data: {
          ok: true,
          repo: formatRepo(session.repo),
          head: assessment.head,
          base: assessment.base,
          headSha: assessment.headSha ?? null,
          warnings: assessment.verdict.warnings,
        },
        text: `Ready to open a pull request from ${assessment.head} into ${assessment.base}.`,
      };
    },
  });

  const create = defineCommand({
    name: 'create',
    summary: 'Open a pull request',
    description: [
      'Checks the title and description, makes sure the branch is pushed and no pull request is open for it,',
      'then opens the pull request and requests the reviewers and labels. Nothing is sent to the server',
      'when the text, the settings or the credentials are wrong.',
    ].join(' '),
    options: {
      ...repoOptions,
      title: {
        type: 'string',
        valueName: 'text',
        required: true,
        description: 'Pull request title',
      },
      body: { type: 'string', valueName: 'text', description: 'Pull request description' },
      bodyFile: {
        type: 'string',
        valueName: 'path',
        description: 'Read the description from a file; "-" reads standard input',
      },
      head: {
        type: 'string',
        valueName: 'branch',
        description: 'Branch with the changes (default: the checked-out branch)',
      },
      base: {
        type: 'string',
        valueName: 'branch',
        description: 'Branch to merge into (default: the repository default branch)',
      },
      reviewer: {
        type: 'string',
        valueName: 'login',
        multiple: true,
        description:
          'Request a review from this user, besides the configured reviewers; repeat for several',
      },
      label: {
        type: 'string',
        valueName: 'name',
        multiple: true,
        description: 'Attach this label; repeat for several',
      },
      draft: { type: 'boolean', description: 'Open as a draft (the title gets a "WIP:" prefix)' },
    },
    examples: [
      'sdlc-forgejo pr create --title "feat: add export" --body-file description.md --reviewer alice',
    ],
    async run({ options }, context) {
      const body = await readDescription(context, ports, options);
      const { values } = await resolveToolSettings(
        context,
        [
          'host',
          'profile',
          'clientId',
          'repo',
          'base',
          'reviewers',
          'labels',
          'prTitlePattern',
          'prRequiredSections',
        ],
        { host: options.host, profile: options.profile, repo: options.repo, base: options.base },
      );

      const problems = checkText(options.title, body, buildTextRules(values));
      if (problems.length > 0) {
        throw new CliError('usage', 'The pull request text is not acceptable.', {
          code: 'invalid_pull_request_text',
          causes: problems,
          next: ['Fix the title or the description and run the command again.'],
        });
      }
      const head = await resolveHead(context, ports, options.head);
      const labelNames = options.label.length > 0 ? options.label : splitList(values.labels);

      const session = await openRepoSession(context, ports, values);
      const { api, repo } = session;
      const assessment = await assessCreate(context, ports, session, head, values.base);
      if (assessment.verdict.violations.length > 0) throw createBlocked(assessment);
      for (const warning of assessment.verdict.warnings) context.log(`warning: ${warning}`);

      // Labels are checked before the pull request exists, so a typo cannot leave a half-finished one behind.
      const labelIds = await resolveLabelIds(api, repo, labelNames);

      // The server refuses the whole request when the author is among the reviewers, which would
      // leave a team's fixed reviewers unrequested whenever one of them opens the pull request.
      // Only the configured list is trimmed; a reviewer named on the command line is the caller's call.
      const configured = splitList(values.reviewers);
      const author =
        configured.length === 0 ? undefined : (await api.currentUser()).login.toLowerCase();
      const reviewers = mergeLogins(
        configured.filter((login) => login.toLowerCase() !== author),
        options.reviewer,
      );

      const title = options.title.trim();
      const pull = await api.createPull(repo, {
        title: options.draft ? markDraft(title) : title,
        body,
        head,
        base: assessment.base,
      });

      const failures: string[] = [];
      const attempt = async (what: string, action: () => Promise<void>): Promise<void> => {
        try {
          await action();
        } catch (error) {
          if (isCliError(error) && error.kind === 'cancelled') throw error;
          failures.push(`${what}: ${cliMessage(error)}`);
        }
      };
      if (reviewers.length > 0) {
        await attempt('requesting reviewers', () =>
          api.requestReviewers(repo, pull.number, reviewers),
        );
      }
      if (labelIds.size > 0) {
        await attempt('attaching labels', () =>
          api.addLabels(repo, pull.number, [...labelIds.values()]),
        );
      }
      if (failures.length > 0) {
        throw new CliError(
          'server',
          `Pull request #${pull.number} was opened (${pull.url}), but not everything requested was applied.`,
          {
            code: 'pull_request_incomplete',
            causes: failures,
            next: [
              `Retry with \`sdlc-forgejo pr reviewers ${pull.number} --add <login>\` or \`sdlc-forgejo pr labels ${pull.number} --add <name>\`.`,
            ],
            details: { number: pull.number, url: pull.url },
          },
        );
      }
      return {
        data: {
          repo: formatRepo(repo),
          number: pull.number,
          url: pull.url,
          title: pull.title,
          head,
          base: assessment.base,
          draft: pull.draft,
          headSha: assessment.headSha ?? null,
          reviewers,
          labels: labelNames,
          warnings: assessment.verdict.warnings,
        },
        text: `Opened pull request #${pull.number}: ${pull.url}`,
      };
    },
  });

  const reviewers = defineCommand({
    name: 'reviewers',
    summary: 'Request or withdraw review requests',
    positionals: [{ name: 'number', description: 'Pull request number', required: true }],
    options: {
      ...repoOptions,
      add: {
        type: 'string',
        valueName: 'login',
        multiple: true,
        description: 'Request a review from this user',
      },
      remove: {
        type: 'string',
        valueName: 'login',
        multiple: true,
        description: 'Withdraw the request to this user',
      },
    },
    async run({ options, args }, context) {
      const number = parsePullNumber(args.number);
      requireChange(options.add, options.remove);
      const { values } = await resolveToolSettings(
        context,
        ['host', 'profile', 'clientId', 'repo'],
        {
          host: options.host,
          profile: options.profile,
          repo: options.repo,
        },
      );
      const { api, repo } = await openRepoSession(context, ports, values);
      if (options.add.length > 0) await api.requestReviewers(repo, number, options.add);
      if (options.remove.length > 0) await api.removeReviewers(repo, number, options.remove);
      const pull = await api.getPull(repo, number);
      return {
        data: { repo: formatRepo(repo), number, reviewers: pull.reviewers },
        text: `#${number} review requested from: ${pull.reviewers.join(', ') || 'nobody'}`,
      };
    },
  });

  const labels = defineCommand({
    name: 'labels',
    summary: 'Attach or remove labels',
    positionals: [{ name: 'number', description: 'Pull request number', required: true }],
    options: {
      ...repoOptions,
      add: { type: 'string', valueName: 'name', multiple: true, description: 'Attach this label' },
      remove: {
        type: 'string',
        valueName: 'name',
        multiple: true,
        description: 'Remove this label',
      },
    },
    async run({ options, args }, context) {
      const number = parsePullNumber(args.number);
      requireChange(options.add, options.remove);
      const { values } = await resolveToolSettings(
        context,
        ['host', 'profile', 'clientId', 'repo'],
        {
          host: options.host,
          profile: options.profile,
          repo: options.repo,
        },
      );
      const { api, repo } = await openRepoSession(context, ports, values);
      const ids = await resolveLabelIds(api, repo, [...options.add, ...options.remove]);
      if (options.add.length > 0) {
        await api.addLabels(
          repo,
          number,
          options.add.map((name) => ids.get(name) ?? 0),
        );
      }
      for (const name of options.remove) await api.removeLabel(repo, number, ids.get(name) ?? 0);
      const pull = await api.getPull(repo, number);
      return {
        data: { repo: formatRepo(repo), number, labels: pull.labels },
        text: `#${number} labels: ${pull.labels.join(', ') || 'none'}`,
      };
    },
  });

  const merge = defineCommand({
    name: 'merge',
    summary: 'Merge a pull request once the configured conditions hold',
    description: [
      'Merges with a merge commit unless the configuration allows other methods and --method names one.',
      "The configured required statuses and approvals are judged on the pull request's current head,",
      'so a result recorded for an older commit does not count; if any is missing nothing is sent and each missing item is listed.',
      'The server merges only the commit that was checked here: if the head moves in between, the merge is refused.',
      'The branch is deleted on the server afterwards unless --keep-branch is given.',
    ].join(' '),
    positionals: [{ name: 'number', description: 'Pull request number', required: true }],
    options: {
      ...repoOptions,
      method: {
        type: 'string',
        valueName: 'method',
        choices: MERGE_METHODS,
        description:
          'How to merge (default: the first method the configuration allows, "merge" unless configured)',
      },
      matchHeadCommit: {
        type: 'string',
        valueName: 'sha',
        description: 'Refuse unless the pull request head is this commit (a prefix is enough)',
      },
      expectBase: {
        type: 'string',
        valueName: 'branch',
        description: 'Refuse unless the pull request targets this branch',
      },
      keepBranch: { type: 'boolean', description: 'Do not delete the branch after merging' },
    },
    async run({ options, args }, context) {
      const number = parsePullNumber(args.number);
      if (
        options.matchHeadCommit !== undefined &&
        !/^[0-9a-f]{7,64}$/i.test(options.matchHeadCommit)
      ) {
        throw new CliError('usage', `"${options.matchHeadCommit}" is not a commit hash.`, {
          code: 'invalid_commit',
          next: ['Give at least the first 7 hexadecimal digits of the commit hash.'],
        });
      }
      const { values } = await resolveToolSettings(
        context,
        ['host', 'profile', 'clientId', 'repo', ...MERGE_POLICY_SETTINGS],
        { host: options.host, profile: options.profile, repo: options.repo },
      );
      // The policy and the method are settled before the first request, so a configuration that
      // forbids what was asked for, or cannot be met, costs no round trip.
      const policy = buildMergePolicy(values);
      const method: MergeMethod = chooseMergeMethod(policy, options.method);
      const { api, repo } = await openRepoSession(context, ports, values);

      const pull = await api.getPull(repo, number);
      // Everything is read for the head commit seen here; the merge below is pinned to the same commit.
      const [history, reviews] = await Promise.all([
        needsStatuses(policy) ? api.listStatuses(repo, pull.head.sha) : undefined,
        needsReviews(policy) ? api.listReviews(repo, number) : undefined,
      ]);
      const ci =
        history === undefined
          ? await api.getCiSummary(repo, pull.head.sha)
          : summarizeStatuses(history);
      const evidence: PolicyEvidence = { statuses: history ?? [], reviews: reviews ?? [] };
      const verdict = gateMerge({
        pull,
        expectBase: options.expectBase,
        matchHead: options.matchHeadCommit,
        ci,
        policy,
        evidence,
      });
      if (verdict.violations.length > 0) {
        throw blockedError('merge_blocked', `#${number} was not merged.`, verdict, [
          `See the state of the pull request with \`sdlc-forgejo pr view ${number}\`.`,
          'Run the command again once everything listed above is in place.',
        ]);
      }
      const warnings = [...verdict.warnings];
      for (const warning of warnings) context.log(`warning: ${warning}`);

      await api.mergePull(repo, number, {
        method,
        deleteBranch: !options.keepBranch,
        headSha: pull.head.sha,
        ...(method === 'merge'
          ? {
              commitText: {
                title: `Merge pull request #${number} from ${pull.head.ref}`,
                message: pull.title,
              },
            }
          : {}),
      });

      // The answer to the merge request is not the proof; the pull request is read again.
      const after = await api.getPull(repo, number);
      if (!after.merged) {
        throw new CliError(
          'server',
          `The server accepted the merge of #${number}, but it is not merged.`,
          {
            code: 'merge_unconfirmed',
            next: [`Check \`sdlc-forgejo pr view ${number}\` before trying again.`],
          },
        );
      }
      let branchDeleted = false;
      if (!options.keepBranch) {
        branchDeleted = (await api.getBranch(repo, pull.head.ref)) === undefined;
        if (!branchDeleted) {
          const note = `The server kept the branch "${pull.head.ref}"; it may be protected. Remove it with \`sdlc-forgejo branch cleanup ${pull.head.ref}\`.`;
          warnings.push(note);
          context.log(`warning: ${note}`);
        }
      }
      return {
        data: {
          merged: true,
          repo: formatRepo(repo),
          number,
          method,
          mergeCommitSha: after.mergeCommitSha,
          head: pull.head.ref,
          base: after.base.ref,
          url: after.url,
          branchDeleted,
          warnings,
        },
        text: `Merged #${number} into ${after.base.ref}${after.mergeCommitSha === null ? '' : ` (${after.mergeCommitSha.slice(0, 8)})`}.${branchDeleted ? ` Deleted branch ${pull.head.ref}.` : ''}`,
      };
    },
  });

  return defineGroup({
    name: 'pr',
    summary: 'List, open, review and merge pull requests',
    commands: [list, view, check, create, reviewers, labels, merge],
  });
}

function requireChange(add: readonly string[], remove: readonly string[]): void {
  if (add.length === 0 && remove.length === 0) {
    throw new CliError('usage', 'Nothing to change.', {
      code: 'missing_option',
      next: ['Pass --add and/or --remove.'],
    });
  }
}

async function resolveHead(
  context: CommandContext,
  ports: Ports,
  head: string | undefined,
): Promise<string> {
  const name = head ?? (await ports.git.currentBranch(context.cwd));
  if (name === undefined) {
    throw new CliError('config', 'Cannot tell which branch to use.', {
      code: 'missing_head',
      causes: ['The current directory is not a checkout on a branch.'],
      next: ['Pass --head <branch>, or run the command inside a checkout on that branch.'],
    });
  }
  return assertBranchName(name, 'branch');
}
