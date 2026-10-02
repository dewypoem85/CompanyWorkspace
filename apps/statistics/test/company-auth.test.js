import test from 'node:test';
import assert from 'node:assert/strict';
import { createSignedToken, hasPermission, verifySignedToken } from '../lib/company-auth.js';

const secret = '0123456789abcdef0123456789abcdef0123456789abcdef';

test('회사 SSO 토큰에서 statistics 접근 권한을 검증한다', () => {
  const payload = { iss: 'company-portal', aud: 'statistics', sub: '15', name: '홍길동', email: 'hong@example.com', permissions: ['statistics.access'], iat: 1_800_000_000, exp: 1_800_000_060, jti: 'once' };
  const token = createSignedToken(payload, secret);
  const user = verifySignedToken(token, secret, { issuer: payload.iss, audience: payload.aud, nowSeconds: 1_800_000_010 });
  assert.equal(user.sub, '15');
  assert.equal(hasPermission(user, 'statistics.access'), true);
  assert.equal(hasPermission(user, 'cs.access'), false);
});

test('서명과 audience가 다른 토큰을 거부한다', () => {
  const payload = { iss: 'company-portal', aud: 'statistics', exp: 1_800_000_060 };
  const token = createSignedToken(payload, secret);
  assert.throws(() => verifySignedToken(token, secret, { issuer: payload.iss, audience: 'cs', nowSeconds: 1_800_000_010 }), /대상/);
  const [body, signature] = token.split('.');
  assert.throws(() => verifySignedToken(`${body}.${signature.slice(0, -1)}A`, secret, { issuer: payload.iss, audience: payload.aud, nowSeconds: 1_800_000_010 }), /서명/);
});
