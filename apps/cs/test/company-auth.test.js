import test from 'node:test';
import assert from 'node:assert/strict';
import { createSignedToken, hasPermission, verifySignedToken } from '../lib/company-auth.js';

const secret = '0123456789abcdef0123456789abcdef0123456789abcdef';

function payload(overrides = {}) {
  return {
    iss: 'company-portal',
    aud: 'cs',
    sub: '15',
    name: '홍길동',
    email: 'hong@example.com',
    permissions: ['cs.access'],
    iat: 1_800_000_000,
    exp: 1_800_000_060,
    jti: 'abc',
    ...overrides
  };
}

test('회사 SSO 토큰을 검증하고 권한을 읽는다', () => {
  const token = createSignedToken(payload(), secret);
  const user = verifySignedToken(token, secret, {
    issuer: 'company-portal',
    audience: 'cs',
    nowSeconds: 1_800_000_010
  });

  assert.equal(user.sub, '15');
  assert.equal(user.name, '홍길동');
  assert.equal(hasPermission(user, 'cs.access'), true);
  assert.equal(hasPermission(user, 'leave.access'), false);
});

test('서명이 변경된 토큰을 거부한다', () => {
  const token = createSignedToken(payload(), secret);
  const [body, signature] = token.split('.');
  const tampered = `${body}.${signature.slice(0, -1)}A`;

  assert.throws(() => verifySignedToken(tampered, secret, {
    issuer: 'company-portal',
    audience: 'cs',
    nowSeconds: 1_800_000_010
  }), /서명/);
});

test('발급자와 대상이 다르면 거부한다', () => {
  const token = createSignedToken(payload(), secret);

  assert.throws(() => verifySignedToken(token, secret, {
    issuer: 'other-issuer',
    audience: 'cs',
    nowSeconds: 1_800_000_010
  }), /발급자/);

  assert.throws(() => verifySignedToken(token, secret, {
    issuer: 'company-portal',
    audience: 'other',
    nowSeconds: 1_800_000_010
  }), /대상/);
});

test('만료된 토큰을 거부한다', () => {
  const token = createSignedToken(payload({ exp: 1_800_000_005 }), secret);

  assert.throws(() => verifySignedToken(token, secret, {
    issuer: 'company-portal',
    audience: 'cs',
    nowSeconds: 1_800_000_010
  }), /만료/);
});
