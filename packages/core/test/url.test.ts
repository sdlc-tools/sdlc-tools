import { describe, expect, it } from 'vitest';
import { type CliError } from '../src/errors.js';
import { normalizeServerUrl, urlPath, validatePort } from '../src/url.js';

describe('normalizeServerUrl', () => {
  it('keeps the origin and any path prefix, without a trailing slash', () => {
    expect(normalizeServerUrl('https://git.example.test/gitea/')).toEqual({
      baseUrl: 'https://git.example.test/gitea',
      origin: 'https://git.example.test',
      host: 'git.example.test',
    });
  });

  it('assumes https for a bare host name', () => {
    expect(normalizeServerUrl('git.example.test:8443').baseUrl).toBe(
      'https://git.example.test:8443',
    );
  });

  it('allows plain http only for loopback hosts', () => {
    expect(normalizeServerUrl('http://localhost:3000').baseUrl).toBe('http://localhost:3000');
    expect(normalizeServerUrl('http://127.0.0.1:3000').baseUrl).toBe('http://127.0.0.1:3000');
    expect(() => normalizeServerUrl('http://git.example.test')).toThrow(
      expect.objectContaining({ code: 'insecure_server_url', exitCode: 2 }) as Error,
    );
  });

  it.each([
    ['https://user:secret@git.example.test', 'credentials_in_url'],
    ['https://git.example.test/?a=1', 'invalid_server_url'],
    ['https://git.example.test/#frag', 'invalid_server_url'],
    ['https://', 'invalid_server_url'],
  ])('rejects %s', (raw, code) => {
    expect(() => normalizeServerUrl(raw)).toThrow(expect.objectContaining({ code }) as Error);
  });

  it('does not echo embedded credentials in the error message', () => {
    try {
      normalizeServerUrl('https://user:hunter2@git.example.test');
      expect.unreachable();
    } catch (error) {
      expect((error as CliError).message).not.toContain('hunter2');
    }
  });
});

describe('urlPath', () => {
  it('percent-encodes each value as a single segment', () => {
    expect(urlPath`/repos/${'my org'}/${'a/b'}/pulls/${12}`).toBe('/repos/my%20org/a%2Fb/pulls/12');
  });

  it.each(['', '.', '..'])('rejects the dot-segment value "%s"', (value) => {
    expect(() => urlPath`/repos/${value}`).toThrow(
      expect.objectContaining({ code: 'invalid_path_segment' }) as Error,
    );
  });
});

describe('validatePort', () => {
  it.each(['1', '8765', '65535'])('accepts "%s" and returns it unchanged', (value) => {
    expect(validatePort(value)).toBe(value);
  });

  it.each(['', '0', '65536', '-1', '80.5', '8 0', 'http'])('rejects "%s"', (value) => {
    expect(() => validatePort(value)).toThrow(
      expect.objectContaining({ code: 'invalid_port', kind: 'usage' }) as Error,
    );
  });
});
