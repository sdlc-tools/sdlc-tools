import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { computeCodeChallenge, generateCodeVerifier, generateState } from '../src/index.js';

describe('PKCE', () => {
  it('derives the S256 challenge from the RFC 7636 appendix B test vector', () => {
    expect(computeCodeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });

  it('generates verifiers within the RFC 7636 limits and alphabet', () => {
    for (let index = 0; index < 50; index += 1) {
      const verifier = generateCodeVerifier();
      expect(verifier.length).toBeGreaterThanOrEqual(43);
      expect(verifier.length).toBeLessThanOrEqual(128);
      expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it('generates a fresh verifier and state every time', () => {
    expect(new Set(Array.from({ length: 100 }, generateCodeVerifier)).size).toBe(100);
    expect(new Set(Array.from({ length: 100 }, generateState)).size).toBe(100);
  });

  it('never uses the plain method: the challenge differs from the verifier', () => {
    const verifier = generateCodeVerifier();
    const challenge = computeCodeChallenge(verifier);
    expect(challenge).not.toBe(verifier);
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'));
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('generates states with enough entropy to be unguessable', () => {
    expect(generateState().length).toBeGreaterThanOrEqual(32);
  });
});
