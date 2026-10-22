import { CliError } from '@sdlc-tools/core';
import type { CiSummary, PullRequest } from './model.js';

const TITLE_LIMIT = 255;

/** What a pull request must satisfy beyond being non-empty; both come from configuration. */
export interface TextRules {
  readonly titlePattern?: RegExp | undefined;
  /** Section names the description has to contain, as headings or bold lines. */
  readonly requiredSections: readonly string[];
}

export function splitList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
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

/** The name a heading (`## Name`) or a bold line (`**Name**`) gives its section. */
function sectionName(line: string): string | undefined {
  const heading = /^\s{0,3}#{1,6}\s+(.*)$/.exec(line);
  const bold = /^\s{0,3}(?:\*\*|__)(.+?)(?:\*\*|__)\s*:?\s*$/.exec(line);
  const raw = heading?.[1] ?? bold?.[1];
  return raw?.replace(/[*_]/g, '').replace(/:\s*$/, '').trim().toLowerCase();
}

function hasSection(body: string, section: string): boolean {
  const wanted = section.trim().toLowerCase();
  return body.split('\n').some((line) => sectionName(line) === wanted);
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
    const missing = rules.requiredSections.filter((section) => !hasSection(body, section));
    if (missing.length > 0) {
      problems.push(`The description lacks the section(s): ${missing.join(', ')}.`);
    }
  }
  return problems;
}

const DRAFT_PREFIX = /^\s*(?:\[WIP\]|WIP:)\s*/i;

export function markDraft(title: string): string {
  return DRAFT_PREFIX.test(title) ? title : `WIP: ${title}`;
}

export function isDraftTitle(title: string): boolean {
  return DRAFT_PREFIX.test(title);
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
}

/** Whether a pull request may be merged now. CI results only warn: branch protection owns that rule. */
export function gateMerge(input: MergeGateInput): Verdict {
  const { pull } = input;
  const violations: string[] = [];
  const warnings: string[] = [];
  if (pull.merged) violations.push(`#${pull.number} is already merged.`);
  else if (pull.state !== 'open') violations.push(`#${pull.number} is ${pull.state}, not open.`);
  if (pull.draft) {
    violations.push(`#${pull.number} is a draft; mark it ready for review in the web interface.`);
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
  return { violations, warnings };
}

/** Turns a failed gate into the error every blocked command raises. */
export function blockedError(
  code: string,
  headline: string,
  verdict: Verdict,
  next: readonly string[],
): CliError {
  return new CliError('server', headline, {
    code,
    causes: verdict.violations,
    next,
    details: { violations: verdict.violations, warnings: verdict.warnings },
  });
}
