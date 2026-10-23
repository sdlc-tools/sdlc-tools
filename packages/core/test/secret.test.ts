import { describe, expect, it } from 'vitest';
import { CliError, readSecret } from '../src/index.js';
import { createTestRuntime } from '../src/testing/index.js';

const TOKEN = 'tok-abc123';

async function failure(promise: Promise<unknown>): Promise<CliError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(CliError);
    return error as CliError;
  }
  throw new Error('expected a rejection');
}

describe('readSecret', () => {
  it.each([
    ['one line', `${TOKEN}\n`],
    ['no line break', TOKEN],
    ['Windows line break', `${TOKEN}\r\n`],
    ['surrounding blanks', `\n  ${TOKEN}  \n\n`],
  ])('reads piped input: %s', async (_name, stdin) => {
    const { runtime } = createTestRuntime({ stdin });
    expect(await readSecret(runtime, { label: 'API token' })).toBe(TOKEN);
  });

  it('prompts on a terminal and never shows what was typed', async () => {
    const test = createTestRuntime({ stdin: { typed: TOKEN } });
    expect(await readSecret(test.runtime, { label: 'API token' })).toBe(TOKEN);
    expect(test.stderr()).toBe('API token: \n');
    expect(test.stdout()).toBe('');
  });

  it('uses the prompt it is given', async () => {
    const test = createTestRuntime({ stdin: { typed: TOKEN } });
    await readSecret(test.runtime, { label: 'API token', prompt: 'Paste the token: ' });
    expect(test.stderr()).toBe('Paste the token: \n');
  });

  it('refuses to prompt for input that is not a terminal', async () => {
    const { runtime } = createTestRuntime({ stdin: TOKEN });
    expect(runtime.stdin.isTTY).toBe(false);
    await expect(runtime.stdin.readHidden('x')).rejects.toThrow('not a terminal');
  });

  it.each([
    ['no input at all', undefined, 'Standard input was empty'],
    ['blank piped input', ' \n\n', 'Standard input was empty'],
    ['an empty line typed', { typed: '' }, 'Nothing was typed'],
  ])('fails with a usage error for %s', async (_name, stdin, message) => {
    const { runtime } = createTestRuntime(stdin === undefined ? {} : { stdin });
    const error = await failure(readSecret(runtime, { label: 'API token' }));
    expect(error.kind).toBe('usage');
    expect(error.exitCode).toBe(2);
    expect(error.code).toBe('empty_secret');
    expect(error.message).toBe(`${message}: the API token is missing.`);
    expect(error.next).toHaveLength(1);
  });

  it.each([
    ['two words', 'two words'],
    ['two lines', 'first\nsecond\n'],
    ['a typed space', { typed: 'a b' }],
  ])('refuses %s without repeating them', async (_name, stdin) => {
    const { runtime } = createTestRuntime({ stdin });
    const error = await failure(readSecret(runtime, { label: 'API token' }));
    expect(error.code).toBe('invalid_secret');
    expect(error.exitCode).toBe(2);
    const shown = JSON.stringify(error.toJSON()) + error.message;
    expect(shown).not.toMatch(/two|first|second|a b/);
  });
});
