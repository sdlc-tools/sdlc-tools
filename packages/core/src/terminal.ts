import type { Readable } from 'node:stream';
import { Writable } from 'node:stream';
import { createInterface } from 'node:readline';
import { CliError } from './errors.js';
import type { WritableLike } from './runtime.js';

/**
 * Prints `prompt` to `output`, then reads one line from a terminal `input`
 * without echoing it: readline does the line editing and the raw mode, while
 * its own output goes to a sink. Ctrl-C cancels; Ctrl-D ends the input, which
 * yields an empty line. The terminal is restored in every case.
 */
export function readHiddenLine(
  input: Readable,
  output: WritableLike,
  prompt: string,
  signal?: AbortSignal,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const sink = new Writable({
      write(_chunk, _encoding, done) {
        done();
      },
    });
    const lines = createInterface({ input, output: sink, terminal: true, historySize: 0 });
    let line = '';
    let cancelled = false;

    const cancel = (): void => {
      cancelled = true;
      lines.close();
    };
    lines.once('line', (typed) => {
      line = typed;
      lines.close();
    });
    lines.once('SIGINT', cancel);
    lines.once('close', () => {
      signal?.removeEventListener('abort', cancel);
      output.write('\n');
      if (cancelled) reject(new CliError('cancelled', 'Cancelled.'));
      else resolve(line);
    });

    output.write(prompt);
    if (signal?.aborted === true) cancel();
    else signal?.addEventListener('abort', cancel, { once: true });
  });
}
