import { describe, expect, it } from 'vitest';
import { CliError, ExitCode, formatErrorText, type ErrorKind } from '../src/errors.js';

describe('exit codes', () => {
  it('uses 0 for success and 2 for usage errors', () => {
    expect(ExitCode.Ok).toBe(0);
    expect(ExitCode.Usage).toBe(2);
  });

  it('gives every actionable failure a distinct code', () => {
    const codes = [
      ExitCode.Unexpected,
      ExitCode.Usage,
      ExitCode.Auth,
      ExitCode.Permission,
      ExitCode.NotFound,
      ExitCode.Server,
      ExitCode.Network,
      ExitCode.Cancelled,
    ];
    expect(new Set(codes).size).toBe(codes.length);
  });

  it.each<[ErrorKind, number]>([
    ['usage', 2],
    ['config', 2],
    ['auth', 3],
    ['permission', 4],
    ['not-found', 5],
    ['server', 6],
    ['network', 7],
    ['cancelled', 130],
    ['unexpected', 1],
  ])('maps the %s kind to exit code %i', (kind, exitCode) => {
    expect(new CliError(kind, 'x').exitCode).toBe(exitCode);
  });
});

describe('CliError', () => {
  it('serializes only the fields that are set', () => {
    const error = new CliError('auth', 'Not signed in.', { code: 'no_credentials' });
    expect(error.toJSON()).toEqual({
      kind: 'auth',
      code: 'no_credentials',
      exitCode: 3,
      message: 'Not signed in.',
    });
  });

  it('keeps causes, next steps, status and details in the JSON form', () => {
    const error = new CliError('not-found', 'Missing.', {
      status: 404,
      causes: ['typo'],
      next: ['check spelling'],
      details: { server: 'host.example.test' },
    });
    expect(error.toJSON()).toMatchObject({
      status: 404,
      causes: ['typo'],
      next: ['check spelling'],
      details: { server: 'host.example.test' },
    });
  });

  it('with() adds options without dropping existing ones', () => {
    const base = new CliError('auth', 'Nope.', { code: 'a', next: ['one'] });
    const extended = base.with({ next: ['one', 'two'] });
    expect(extended.code).toBe('a');
    expect(extended.next).toEqual(['one', 'two']);
    expect(base.next).toEqual(['one']);
  });
});

describe('formatErrorText', () => {
  it('lists likely causes and next steps under the message', () => {
    const text = formatErrorText(
      new CliError('permission', 'Denied.', { causes: ['no role'], next: ['ask an owner'] }),
    );
    expect(text).toBe(
      [
        'error: Denied.',
        '',
        'Likely causes:',
        '  - no role',
        '',
        'Next steps:',
        '  - ask an owner',
      ].join('\n'),
    );
  });

  it('appends command usage for usage errors', () => {
    const text = formatErrorText(new CliError('usage', 'Bad.', { usage: 'Usage:\n  tool run\n' }));
    expect(text).toBe('error: Bad.\n\nUsage:\n  tool run');
  });
});
