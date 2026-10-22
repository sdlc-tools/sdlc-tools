import type { CiSummary, PullRequest, Review } from './model.js';

export function pullLine(pull: PullRequest): string {
  const state = pull.merged ? 'merged' : pull.draft ? 'draft' : pull.state;
  const author = pull.author === null ? '' : `  by ${pull.author}`;
  return `#${pull.number}  ${state}  ${pull.head.ref} → ${pull.base.ref}  ${pull.title}${author}`;
}

/** The latest decisive review of each reviewer; comments and withdrawn reviews decide nothing. */
export function decisiveReviews(reviews: readonly Review[]): Map<string, Review> {
  const latest = new Map<string, Review>();
  for (const review of reviews) {
    if (review.reviewer === null || review.dismissed) continue;
    if (review.state === 'APPROVED' || review.state === 'REQUEST_CHANGES') {
      latest.set(review.reviewer, review);
    }
  }
  return latest;
}

function names(values: readonly string[]): string {
  return values.length === 0 ? 'none' : values.join(', ');
}

function ciLine(ci: CiSummary | undefined): string {
  if (ci === undefined) return 'unavailable';
  if (ci.checked === 0) return 'no results';
  const parts = [`${ci.passed} passed`];
  if (ci.failed.length > 0)
    parts.push(`${ci.failed.length} failed (${ci.failed.map((c) => c.context).join(', ')})`);
  if (ci.pending.length > 0)
    parts.push(`${ci.pending.length} running (${ci.pending.map((c) => c.context).join(', ')})`);
  return parts.join(', ');
}

export function pullDetails(
  pull: PullRequest,
  reviews: readonly Review[],
  ci: CiSummary | undefined,
): string {
  const decisive = [...decisiveReviews(reviews).entries()];
  const approvedBy = decisive.filter(([, r]) => r.state === 'APPROVED').map(([login]) => login);
  const changesBy = decisive
    .filter(([, r]) => r.state === 'REQUEST_CHANGES')
    .map(([login]) => login);
  const mergeable = pull.mergeable === null ? 'unknown' : pull.mergeable ? 'yes' : 'no';
  return [
    pullLine(pull),
    pull.url,
    `Mergeable: ${mergeable}   Draft: ${pull.draft ? 'yes' : 'no'}`,
    `Labels: ${names(pull.labels)}`,
    `Review requested from: ${names(pull.reviewers)}`,
    `Approved by: ${names(approvedBy)}   Changes requested by: ${names(changesBy)}`,
    `CI: ${ciLine(ci)}`,
  ].join('\n');
}
