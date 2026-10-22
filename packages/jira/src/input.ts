import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { CliError, type CommandContext } from '@sdlc-tools/core';

const ISSUE_KEY = /^[A-Za-z][A-Za-z0-9_]*-\d+$/;

/** Validates an issue key locally so a typo never costs a request; keys are upper case on the server. */
export function parseIssueKey(raw: string): string {
  const value = raw.trim();
  if (!ISSUE_KEY.test(value)) {
    throw new CliError('usage', `"${raw}" is not an issue key.`, {
      code: 'invalid_issue_key',
      next: ['Use the project key, a dash and the number, such as ABC-123.'],
    });
  }
  return value.toUpperCase();
}

export interface TextSource {
  readonly inline: string | undefined;
  readonly file: string | undefined;
  readonly label: string;
  readonly inlineFlag: string;
  readonly fileFlag: string;
}

/** Reads text given inline or from a file; exactly one source is allowed and the text must not be blank. */
export async function readText(
  context: Pick<CommandContext, 'cwd'>,
  source: TextSource,
): Promise<string | undefined> {
  if (source.inline !== undefined && source.file !== undefined) {
    throw new CliError(
      'usage',
      `Give the ${source.label} with ${source.inlineFlag} or ${source.fileFlag}, not both.`,
      {
        code: 'conflicting_options',
      },
    );
  }
  let text = source.inline;
  if (source.file !== undefined) {
    try {
      text = await readFile(resolve(context.cwd, source.file), 'utf8');
    } catch (error) {
      throw new CliError('usage', `Cannot read ${source.fileFlag} ${source.file}.`, {
        code: 'file_unreadable',
        next: ['Check that the path exists and is a readable file.'],
        cause: error,
      });
    }
  }
  if (text?.trim() === '') {
    throw new CliError('usage', `The ${source.label} is empty.`, { code: 'empty_text' });
  }
  return text;
}

function isCalendarDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/** A calendar date as `YYYY-MM-DD`, rejecting impossible dates such as 2026-02-30. */
export function parseDate(value: string, flag: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const [year = 0, month = 0, day = 0] = match?.slice(1, 4).map(Number) ?? [];
  if (match === null || !isCalendarDate(year, month, day)) {
    throw new CliError('usage', `${flag} must be a date written YYYY-MM-DD, not "${value}".`, {
      code: 'invalid_date',
    });
  }
  return value;
}

const DURATION = /^(\d+[wdhm]\s*)+$/i;

/** A Jira duration such as `1d 2h 30m`, checked locally. */
export function parseDuration(value: string, label: string): string {
  const trimmed = value.trim();
  if (!DURATION.test(trimmed)) {
    throw new CliError('usage', `${label} "${value}" is not a duration.`, {
      code: 'invalid_duration',
      next: ['Use weeks, days, hours and minutes such as "30m", "2h" or "1d 4h".'],
    });
  }
  return trimmed.replace(/\s+/g, ' ').toLowerCase();
}

const STARTED =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:?\d{2})$/;

/**
 * Converts an ISO 8601 timestamp with an explicit offset to the form the worklog
 * endpoint requires (`2026-01-02T09:00:00.000+0900`). An offset is required so
 * the result never depends on the machine's time zone.
 */
export function parseStarted(value: string): string {
  const match = STARTED.exec(value.trim());
  const [year = 0, month = 0, day = 0, hour = 99, minute = 99] =
    match?.slice(1, 6).map(Number) ?? [];
  const [offsetHour = 0, offsetMinute = 0] =
    /^[+-](\d{2}):?(\d{2})$/
      .exec(match?.[8] ?? '')
      ?.slice(1, 3)
      .map(Number) ?? [];
  const valid =
    match !== null &&
    isCalendarDate(year, month, day) &&
    hour < 24 &&
    minute < 60 &&
    Number(match[6] ?? 0) < 60 &&
    offsetHour < 24 &&
    offsetMinute < 60;
  if (!valid) {
    throw new CliError(
      'usage',
      `--started must be an ISO 8601 time with an offset, not "${value}".`,
      {
        code: 'invalid_started',
        next: ['Write it like 2026-01-02T09:00:00+09:00, or end it with Z for UTC.'],
      },
    );
  }
  const offset = match[8] === 'Z' ? '+0000' : (match[8] ?? '').replace(':', '');
  const date = value.trim().slice(0, 10);
  const time = `${match[4]}:${match[5]}:${match[6] ?? '00'}.${(match[7] ?? '').padEnd(3, '0')}`;
  return `${date}T${time}${offset}`;
}
