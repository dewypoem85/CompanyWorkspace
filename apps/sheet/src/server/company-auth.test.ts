import { describe, expect, it } from 'vitest';
import { createSignedToken, normalizeReturnUrl, verifySignedToken } from './company-auth.js';

const secret = 'test-company-shared-secret-that-is-long-enough';

describe('company SSO token', () => {
  it('verifies a valid signed portal token', () => {
    const token = createSignedToken({
      iss: 'company-portal',
      aud: 'sheet',
      sub: '7',
      sid: 'company-session-test',
      permissions: ['sheet.access'],
      iat: 100,
      exp: 200,
    }, secret);

    expect(verifySignedToken(token, secret, {
      issuer: 'company-portal',
      audience: 'sheet',
      nowSeconds: 150,
    }).sub).toBe('7');
    expect(verifySignedToken(token, secret, {
      issuer: 'company-portal', audience: 'sheet', nowSeconds: 150,
    }).sid).toBe('company-session-test');
  });

  it('rejects altered and expired tokens', () => {
    const token = createSignedToken({
      iss: 'company-portal',
      aud: 'sheet',
      exp: 100,
    }, secret);

    expect(() => verifySignedToken(`${token}x`, secret, {
      issuer: 'company-portal',
      audience: 'sheet',
      nowSeconds: 50,
    })).toThrow('서명');
    expect(() => verifySignedToken(token, secret, {
      issuer: 'company-portal',
      audience: 'sheet',
      nowSeconds: 101,
    })).toThrow('만료');
  });
});

describe('normalizeReturnUrl', () => {
  it('allows only local application paths', () => {
    expect(normalizeReturnUrl('/snapshots?tab=latest')).toBe('/snapshots?tab=latest');
    expect(normalizeReturnUrl('//evil.example')).toBe('/');
    expect(normalizeReturnUrl('https://evil.example')).toBe('/');
    expect(normalizeReturnUrl('/auth/logout')).toBe('/');
  });
});
