import type { CiSummary, StatusRecord } from './model.js';

/**
 * The current result of every status context: a rerun adds a record to the same context, so the
 * record with the highest id wins and an earlier failure cannot hide a later success (or the reverse).
 */
export function latestStatuses(history: readonly StatusRecord[]): StatusRecord[] {
  const latest = new Map<string, StatusRecord>();
  for (const record of [...history].sort((a, b) => b.id - a.id)) {
    if (!latest.has(record.context)) latest.set(record.context, record);
  }
  return [...latest.values()];
}

/** Folds the status history of a commit into the latest state per check. */
export function summarizeStatuses(history: readonly StatusRecord[]): CiSummary {
  const latest = latestStatuses(history);
  const pick = (states: readonly string[]) =>
    latest
      .filter((record) => states.includes(record.state))
      .map((record) => ({ context: record.context, url: record.url }));
  return {
    checked: latest.length,
    passed: pick(['success']).length,
    failed: pick(['failure', 'error']),
    pending: pick(['pending', 'warning']),
  };
}
