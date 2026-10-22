import { createHash, randomBytes } from 'node:crypto';

/** 32 random bytes encode to a 43-character verifier, the minimum RFC 7636 §4.1 allows. */
export function generateCodeVerifier(): string {
  return randomBytes(32).toString('base64url');
}

/** `BASE64URL(SHA256(ASCII(verifier)))`, the `S256` method of RFC 7636 §4.2. */
export function computeCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

/** Unguessable value binding the authorization response to this login (RFC 6749 §10.12). */
export function generateState(): string {
  return randomBytes(24).toString('base64url');
}
