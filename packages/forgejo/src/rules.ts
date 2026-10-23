import { CliError } from '@sdlc-tools/core';
import { splitList } from './lists.js';
import type { CiSummary, PullRequest } from './model.js';
import {
  evaluatePolicy,
  type MergePolicy,
  type PolicyEvidence,
  type UnmetCondition,
} from './policy.js';

export { splitList };

const TITLE_LIMIT = 255;

/** What a pull request must satisfy beyond being non-empty; both come from configuration. */
export interface TextRules {
  readonly titlePattern?: RegExp | undefined;
  /** Section names the description has to contain, as headings or bold lines. */
  readonly requiredSections: readonly string[];
}

export function buildTextRules(settings: {
  readonly prTitlePattern: string | undefined;
  readonly prRequiredSections: string | undefined;
}): TextRules {
  let titlePattern: RegExp | undefined;
  if (settings.prTitlePattern !== undefined) {
    try {
      titlePattern = new RegExp(settings.prTitlePattern, 'u');
    } catch (cause) {
      throw new CliError(
        'config',
        `"prTitlePattern" is not a valid regular expression: ${settings.prTitlePattern}`,
        {
          code: 'invalid_setting',
          next: ['Fix the pattern in the configuration, or remove the setting.'],
          cause,
        },
      );
    }
  }
  return { titlePattern, requiredSections: splitList(settings.prRequiredSections) };
}

const normalizeName = (raw: string): string =>
  raw.replace(/[*_]/g, '').replace(/:\s*$/, '').replace(/\s+/g, ' ').trim().toLowerCase();

interface SectionLabel {
  readonly line: number;
  readonly name: string;
  /** The heading level; `undefined` for a bold label, which ends at the next label of any kind. */
  readonly level: number | undefined;
  /** Text on the label's own line, after a bold `**Name**: value`. */
  readonly inline: string;
}

/**
 * The labels a description gives its sections: headings (`## Name`) and bold labels (`**Name**`,
 * `**Name:** value`, `**Name**: value`). Lines inside code fences label nothing, because a pasted
 * log or shell comment starting with `#` is not a heading.
 */
function sectionLabels(lines: readonly string[]): SectionLabel[] {
  const labels: SectionLabel[] = [];
  let fence: string | undefined;
  lines.forEach((text, line) => {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(text)?.[1]?.charAt(0);
    if (marker !== undefined) {
      fence = fence === undefined ? marker : fence === marker ? undefined : fence;
      return;
    }
    if (fence !== undefined) return;

    const heading = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(text);
    if (heading?.[1] !== undefined && heading[2] !== undefined) {
      labels.push({ line, name: normalizeName(heading[2]), level: heading[1].length, inline: '' });
      return;
    }
    const bold = /^\s{0,3}(\*\*|__)(.+?)\1(.*)$/.exec(text);
    if (bold?.[2] === undefined) return;
    const rest = (bold[3] ?? '').trim();
    const closedByColon = bold[2].trim().endsWith(':');
    if (rest === '' || rest.startsWith(':') || closedByColon) {
      labels.push({
        line,
        name: normalizeName(bold[2]),
        level: undefined,
        inline: rest.replace(/^:\s*/, ''),
      });
    }
  });
  return labels;
}

type SectionState = 'missing' | 'empty' | 'present';

/** Whether the description has the section, and whether anything but blank lines stands under it. */
function sectionState(body: string, section: string): SectionState {
  // A template's placeholder comments are not content, and a heading inside one is not a section.
  const lines = body.replace(/<!--[\s\S]*?-->/g, '').split(/\r?\n/);
  const labels = sectionLabels(lines);
  const wanted = normalizeName(section);
  let state: SectionState = 'missing';
  labels.forEach((label, index) => {
    if (label.name !== wanted) return;
    const end =
      labels
        .slice(index + 1)
        .find((next) =>
          label.level === undefined ? true : next.level !== undefined && next.level <= label.level,
        )?.line ?? lines.length;
    const content = [label.inline, ...lines.slice(label.line + 1, end)].join('\n').trim();
    if (content !== '') state = 'present';
    else if (state === 'missing') state = 'empty';
  });
  return state;
}

/** Everything wrong with a pull request's title and description; empty when it is acceptable. */
export function checkText(title: string, body: string, rules: TextRules): string[] {
  const problems: string[] = [];
  const trimmedTitle = title.trim();
  if (trimmedTitle === '') problems.push('The title is empty.');
  else {
    if (/[\r\n]/.test(trimmedTitle)) problems.push('The title must be a single line.');
    if (trimmedTitle.length > TITLE_LIMIT) {
      problems.push(
        `The title is ${trimmedTitle.length} characters long; the limit is ${TITLE_LIMIT}.`,
      );
    }
    if (rules.titlePattern !== undefined && !rules.titlePattern.test(trimmedTitle)) {
      problems.push(
        `The title does not match the configured pattern ${rules.titlePattern.source}.`,
      );
    }
  }
  if (body.trim() === '') problems.push('The description is empty.');
  else {
    const states = rules.requiredSections.map((section) => [section, sectionState(body, section)]);
    const named = (wanted: SectionState): string =>
      states
        .filter(([, state]) => state === wanted)
        .map(([section]) => section)
        .join(', ');
    if (named('missing') !== '') {
      problems.push(`The description lacks the section(s): ${named('missing')}.`);
    }
    if (named('empty') !== '') {
      problems.push(`The description has nothing under the section(s): ${named('empty')}.`);
    }
  }
  return problems;
}

// A draft is a title that starts with one of the server's work-in-progress prefixes, compared
// case-insensitively. These are the server defaults (`WORK_IN_PROGRESS_PREFIXES = WIP:,[WIP]` under
// `[repository.pull-request]` in app.ini); a server may configure others, which is why the API's
// own `draft` value is preferred and this pattern only edits titles and covers servers that omit it.
const DRAFT_PREFIX = /^\s*(?:\[WIP\]|WIP:)\s*/i;

export function markDraft(title: string): string {
  return DRAFT_PREFIX.test(title) ? title : `WIP: ${title}`;
}

export function isDraftTitle(title: string): boolean {
  return DRAFT_PREFIX.test(title);
}

/** The title without its draft prefixes; every stacked prefix goes, or the title would still read as a draft. */
export function unmarkDraft(title: string): string {
  let rest = title;
  while (DRAFT_PREFIX.test(rest)) rest = rest.replace(DRAFT_PREFIX, '');
  return rest;
}

export interface Verdict {
  readonly violations: readonly string[];
  readonly warnings: readonly string[];
}

export interface CreateGateInput {
  readonly head: string;
  readonly base: string;
  readonly baseExists: boolean;
  /** The head branch as the server has it; `undefined` when it was never pushed. */
  readonly remoteSha: string | undefined;
  /** The head branch in the local checkout, when there is one. */
  readonly localSha: string | undefined;
  readonly openPulls: readonly PullRequest[];
  readonly closedPulls: readonly PullRequest[];
}

const describePulls = (pulls: readonly PullRequest[]): string =>
  pulls.map((pull) => `#${pull.number}`).join(', ');

/** Whether a pull request for this branch may be opened, judged from facts the server and git reported. */
export function gateCreate(input: CreateGateInput): Verdict {
  const violations: string[] = [];
  const warnings: string[] = [];
  if (input.head === input.base) {
    violations.push(`The head and the base are the same branch (${input.head}).`);
  }
  if (!input.baseExists) {
    violations.push(`The base branch "${input.base}" does not exist on the server.`);
  }
  if (input.remoteSha === undefined) {
    violations.push(`The branch "${input.head}" is not on the server yet; push it first.`);
  } else if (input.localSha !== undefined && input.localSha !== input.remoteSha) {
    violations.push(
      `The server has ${input.head} at ${input.remoteSha.slice(0, 8)}, but your local branch is at ${input.localSha.slice(0, 8)}; push (or pull) so the pull request shows your work.`,
    );
  }
  if (input.openPulls.length > 0) {
    violations.push(
      `A pull request for "${input.head}" is already open: ${describePulls(input.openPulls)}.`,
    );
  }
  if (input.closedPulls.length > 0) {
    warnings.push(
      `Earlier pull requests for "${input.head}" were closed or merged: ${describePulls(input.closedPulls)}. Read why they were closed before opening another.`,
    );
  }
  return { violations, warnings };
}

export interface MergeGateInput {
  readonly pull: PullRequest;
  /** Refuse unless the pull request targets this branch. */
  readonly expectBase?: string | undefined;
  /** Refuse unless the pull request head is this commit (a full sha or a prefix of it). */
  readonly matchHead?: string | undefined;
  readonly ci?: CiSummary | undefined;
  /** The configured merge preconditions, judged on the head commit with `evidence`. */
  readonly policy?: MergePolicy | undefined;
  readonly evidence?: PolicyEvidence | undefined;
}

export interface MergeVerdict extends Verdict {
  /** What the policy still lacks, item by item, for callers that read `--json`. */
  readonly unmet: readonly UnmetCondition[];
}

/**
 * Whether a pull request may be merged now. CI results only warn: whether they block is the
 * server's branch protection, unless the configuration names required statuses, which then block here.
 */
export function gateMerge(input: MergeGateInput): MergeVerdict {
  const { pull } = input;
  const violations: string[] = [];
  const warnings: string[] = [];
  if (pull.merged) violations.push(`#${pull.number} is already merged.`);
  else if (pull.state !== 'open') violations.push(`#${pull.number} is ${pull.state}, not open.`);
  if (pull.draft) {
    violations.push(
      `#${pull.number} is a draft; mark it ready with \`sdlc-forgejo pr ready ${pull.number}\`.`,
    );
  }
  if (pull.mergeable === false && !pull.draft) {
    violations.push(
      `The server reports that #${pull.number} cannot be merged (conflicts or unmet rules).`,
    );
  }
  if (input.expectBase !== undefined && pull.base.ref !== input.expectBase) {
    violations.push(`#${pull.number} targets "${pull.base.ref}", not "${input.expectBase}".`);
  }
  if (input.matchHead !== undefined && !pull.head.sha.startsWith(input.matchHead.toLowerCase())) {
    violations.push(
      `The head of #${pull.number} is ${pull.head.sha.slice(0, 8)}, not ${input.matchHead}; it changed since you reviewed it.`,
    );
  }
  if (input.ci !== undefined) {
    for (const check of input.ci.failed) {
      warnings.push(
        `CI check failed: ${check.context}${check.url === null ? '' : ` (${check.url})`}`,
      );
    }
    for (const check of input.ci.pending) warnings.push(`CI check still running: ${check.context}`);
  }

  // A pull request that is already merged or closed has nothing left to approve.
  let unmet: readonly UnmetCondition[] = [];
  if (input.policy !== undefined && !pull.merged && pull.state === 'open') {
    const policy = evaluatePolicy(
      input.policy,
      pull.head.sha,
      input.evidence ?? { statuses: [], reviews: [] },
    );
    violations.push(...policy.violations);
    warnings.push(...policy.warnings);
    unmet = policy.unmet;
  }
  return { violations, warnings, unmet };
}

/** Turns a failed gate into the error every blocked command raises. */
export function blockedError(
  code: string,
  headline: string,
  verdict: Verdict & { readonly unmet?: readonly UnmetCondition[] },
  next: readonly string[],
): CliError {
  return new CliError('server', headline, {
    code,
    causes: verdict.violations,
    next,
    details: {
      violations: verdict.violations,
      warnings: verdict.warnings,
      ...(verdict.unmet === undefined ? {} : { unmet: verdict.unmet }),
    },
  });
}
