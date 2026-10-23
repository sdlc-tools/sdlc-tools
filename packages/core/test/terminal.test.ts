import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { CliError } from '../src/index.js';
import { readHiddenLine } from '../src/terminal.js';

function setup(signal?: AbortSignal) {
  const input = new PassThrough();
  let written = '';
  const output = {
    write: (chunk: string) => {
      written += chunk;
    },
  };
  const read = readHiddenLine(input, output, 'Token: ', signal);
  return { input, read, written: () => written };
}

async function cancellation(promise: Promise<unknown>): Promise<CliError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(CliError);
    return error as CliError;
  }
  throw new Error('expected a rejection');
}

describe('readHiddenLine', () => {
  it('reads one line and shows only the prompt, never the typed characters', async () => {
    const { input, read, written } = setup();
    input.write('s3cret-value\n');
    expect(await read).toBe('s3cret-value');
    expect(written()).toBe('Token: \n');
  });

  it('shows the prompt before anything is typed', () => {
    const { written } = setup();
    expect(written()).toBe('Token: ');
  });

  it('applies backspace and keeps only the first line', async () => {
    const { input, read } = setup();
    input.write('abcd\x7f\x7fxy\nignored\n');
    expect(await read).toBe('abxy');
  });

  it('reads characters outside ASCII', async () => {
    const { input, read } = setup();
    input.write('토큰-é\n');
    expect(await read).toBe('토큰-é');
  });

  it('treats Ctrl-D on an empty line as no input', async () => {
    const { input, read, written } = setup();
    input.write('\x04');
    expect(await read).toBe('');
    expect(written()).toBe('Token: \n');
  });

  it('cancels on Ctrl-C', async () => {
    const { input, read } = setup();
    input.write('half\x03');
    const error = await cancellation(read);
    expect(error.kind).toBe('cancelled');
    expect(error.exitCode).toBe(130);
  });

  it('cancels when the signal aborts while waiting', async () => {
    const controller = new AbortController();
    const { read } = setup(controller.signal);
    controller.abort();
    expect((await cancellation(read)).kind).toBe('cancelled');
  });

  it('cancels at once when the signal was already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const { read, written } = setup(controller.signal);
    expect((await cancellation(read)).kind).toBe('cancelled');
    expect(written()).toBe('Token: \n');
  });
});
