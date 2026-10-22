/** Optimal string alignment distance: insertions, deletions, substitutions and adjacent swaps each cost 1. */
function distance(a: string, b: string): number {
  const rows: number[][] = Array.from({ length: a.length + 1 }, (_unused, i) => [i]);
  const at = (i: number, j: number): number => rows[i]?.[j] ?? 0;
  for (let j = 1; j <= b.length; j += 1) rows[0]?.push(j);
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, at(i - 2, j - 2) + 1);
      }
      rows[i]?.push(best);
    }
  }
  return at(a.length, b.length);
}

/** The candidate closest to `input`, or undefined when nothing is plausibly a typo of it. */
export function suggest(input: string, candidates: readonly string[]): string | undefined {
  const limit = Math.max(1, Math.floor(input.length / 3));
  let best: { candidate: string; score: number } | undefined;
  for (const candidate of candidates) {
    const score = distance(input.toLowerCase(), candidate.toLowerCase());
    if (score <= limit && (best === undefined || score < best.score)) best = { candidate, score };
  }
  return best?.candidate;
}
