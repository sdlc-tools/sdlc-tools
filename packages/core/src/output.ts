import type { CommandResult } from './command.js';
import { formatErrorText, type CliError } from './errors.js';
import type { WritableLike } from './runtime.js';

/**
 * Indented for a terminal, one compact line otherwise, so piped output stays
 * cheap to read for scripts and agents.
 */
export function serializeJson(value: unknown, stream: WritableLike): string {
  return JSON.stringify(value ?? null, null, stream.isTTY === true ? 2 : undefined);
}

export function writeLine(stream: WritableLike, text: string): void {
  stream.write(text.endsWith('\n') ? text : `${text}\n`);
}

/** Results go to stdout: the full document with `--json`, the short text otherwise. */
export function writeResult(stdout: WritableLike, result: CommandResult, json: boolean): void {
  if (json) {
    writeLine(stdout, serializeJson(result.data, stdout));
  } else if (result.text !== '') {
    writeLine(stdout, result.text);
  }
}

/** Errors go to stderr, as JSON with `--json` so agents can parse them. */
export function writeError(
  stderr: WritableLike,
  error: CliError,
  json: boolean,
  debugStack?: string,
): void {
  if (json) {
    writeLine(stderr, serializeJson({ error: error.toJSON() }, stderr));
    return;
  }
  writeLine(stderr, formatErrorText(error));
  if (debugStack !== undefined) writeLine(stderr, `\n${debugStack}`);
}
