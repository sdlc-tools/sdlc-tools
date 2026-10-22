import { describe, expect, it } from 'vitest';
import type { PullRequest } from '../src/model.js';
import { summarizeStatuses } from '../src/api.js';
import {
  buildTextRules,
  checkText,
  gateCreate,
  gateMerge,
  isDraftTitle,
  markDraft,
  splitList,
} from '../src/rules.js';
import { parseRemoteUrl, parseRepoRef } from '../src/repo.js';

const noRules = { requiredSections: [] };

const pull = (overrides: Partial<PullRequest> = {}): PullRequest => ({
  number: 7,
  title: 'feat: x',
  body: '',
  state: 'open',
  merged: false,
  draft: false,
  mergeable: true,
  head: { ref: 'feat/x', sha: 'abcdef0123456789', repo: 'a/b' },
  base: { ref: 'main', sha: '0'.repeat(40) },
  author: 'alice',
  url: '',
  labels: [],
  reviewers: [],
  mergeCommitSha: null,
  createdAt: null,
  updatedAt: null,
  ...overrides,
});

describe('checkText', () => {
  it('accepts any non-empty single-line title and description by default', () => {
    expect(checkText('feat: x', 'because', noRules)).toEqual([]);
    expect(checkText('Fix the thing 🎉', 'because', noRules)).toEqual([]);
  });

  it('applies the configured title pattern and sections', () => {
    const rules = buildTextRules({
      prTitlePattern: '^[A-Z]+-\\d+ ',
      prRequiredSections: 'Why, How',
    });
    expect(checkText('ABC-1 do it', '# Why\nx\n**How**\ny', rules)).toEqual([]);
    expect(checkText('do it', '# Why\nx', rules)).toEqual([
      expect.stringContaining('does not match'),
      'The description lacks the section(s): How.',
    ]);
  });

  it('matches sections by their whole name, not by a word inside a line', () => {
    const rules = buildTextRules({ prTitlePattern: undefined, prRequiredSections: 'Testing' });
    expect(checkText('t', 'We did Testing here', rules)).toHaveLength(1);
    expect(checkText('t', '## Testing:\nran', rules)).toEqual([]);
    expect(checkText('t', '__Testing__\nran', rules)).toEqual([]);
  });
});

describe('drafts', () => {
  it('recognises and adds the prefix', () => {
    expect(isDraftTitle('WIP: x')).toBe(true);
    expect(isDraftTitle('[wip] x')).toBe(true);
    expect(isDraftTitle('wipe it')).toBe(false);
    expect(markDraft('x')).toBe('WIP: x');
    expect(markDraft('[WIP] x')).toBe('[WIP] x');
  });
});

describe('gateCreate', () => {
  const ok = {
    head: 'feat/x',
    base: 'main',
    baseExists: true,
    remoteSha: 'a'.repeat(40),
    localSha: 'a'.repeat(40),
    openPulls: [],
    closedPulls: [],
  };

  it('passes a pushed branch in sync with the server', () => {
    expect(gateCreate(ok)).toEqual({ violations: [], warnings: [] });
  });

  it('passes when there is no local checkout to compare with', () => {
    expect(gateCreate({ ...ok, localSha: undefined }).violations).toEqual([]);
  });

  it('blocks on each fact separately', () => {
    expect(gateCreate({ ...ok, remoteSha: undefined }).violations).toHaveLength(1);
    expect(gateCreate({ ...ok, localSha: 'b'.repeat(40) }).violations).toHaveLength(1);
    expect(gateCreate({ ...ok, baseExists: false }).violations).toHaveLength(1);
    expect(gateCreate({ ...ok, base: 'feat/x' }).violations).toHaveLength(1);
    expect(gateCreate({ ...ok, openPulls: [pull()] }).violations).toHaveLength(1);
  });

  it('warns, but does not block, about closed pull requests', () => {
    const verdict = gateCreate({ ...ok, closedPulls: [pull({ number: 3 })] });
    expect(verdict.violations).toEqual([]);
    expect(verdict.warnings).toEqual([expect.stringContaining('#3')]);
  });
});

describe('gateMerge', () => {
  it('passes an open, mergeable pull request', () => {
    expect(gateMerge({ pull: pull() }).violations).toEqual([]);
  });

  it('treats an undecided mergeable state as mergeable and lets the server decide', () => {
    expect(gateMerge({ pull: pull({ mergeable: null }) }).violations).toEqual([]);
  });

  it('matches the head commit by prefix, case-insensitively', () => {
    expect(gateMerge({ pull: pull(), matchHead: 'ABCDEF0' }).violations).toEqual([]);
    expect(gateMerge({ pull: pull(), matchHead: 'abcdef9' }).violations).toHaveLength(1);
  });

  it('turns CI results into warnings only, and a repository without CI into none', () => {
    const ci = summarizeStatuses([
      { id: 1, context: 'a', status: 'failure' },
      { id: 2, context: 'b', status: 'warning' },
    ]);
    const verdict = gateMerge({ pull: pull(), ci });
    expect(verdict.violations).toEqual([]);
    expect(verdict.warnings).toHaveLength(2);
    expect(gateMerge({ pull: pull(), ci: summarizeStatuses([]) }).warnings).toEqual([]);
  });
});

describe('summarizeStatuses', () => {
  it('keeps the latest result of each check', () => {
    const ci = summarizeStatuses([
      { id: 9, context: 'test', status: 'success' },
      { id: 2, context: 'test', status: 'failure' },
      { id: 3, context: 'lint', status: 'error', target_url: 'https://ci.example.test/3' },
      { id: 4, context: 'build', status: 'pending' },
      { context: 'ignored-without-id', status: 'failure' },
    ]);
    expect(ci).toEqual({
      checked: 4,
      passed: 1,
      failed: [
        { context: 'lint', url: 'https://ci.example.test/3' },
        { context: 'ignored-without-id', url: null },
      ],
      pending: [{ context: 'build', url: null }],
    });
  });
});

describe('splitList', () => {
  it('splits on commas and drops blanks', () => {
    expect(splitList(' a, b ,,c ')).toEqual(['a', 'b', 'c']);
    expect(splitList(undefined)).toEqual([]);
  });
});

describe('repository coordinates', () => {
  it('parses owner/name', () => {
    expect(parseRepoRef('acme/widgets')).toEqual({ owner: 'acme', name: 'widgets' });
  });

  it.each(['widgets', 'a/b/c', '/b', 'a/', 'a/..', '../b', 'a b/c', ''])('rejects %j', (value) => {
    expect(() => parseRepoRef(value)).toThrow('owner/name');
  });

  it.each([
    ['git@git.example.test:acme/widgets.git', 'git.example.test', 'acme', 'widgets'],
    ['ssh://git@git.example.test:2222/acme/widgets.git', 'git.example.test', 'acme', 'widgets'],
    ['https://git.example.test/acme/widgets', 'git.example.test', 'acme', 'widgets'],
    ['https://user@Git.Example.test/acme/widgets.git', 'git.example.test', 'acme', 'widgets'],
    ['https://git.example.test/prefix/acme/widgets.git', 'git.example.test', 'acme', 'widgets'],
  ])('reads the remote %s', (url, hostname, owner, name) => {
    expect(parseRemoteUrl(url)).toEqual({ hostname, owner, name });
  });

  it.each(['', '/local/path/repo', 'C:\\work\\repo', 'https://git.example.test/only-one'])(
    'does not read %j as a remote on a server',
    (url) => {
      expect(parseRemoteUrl(url)).toBeUndefined();
    },
  );
});
