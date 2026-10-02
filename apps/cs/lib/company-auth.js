import crypto from 'node:crypto';

export function createSignedToken(payload, secret) {
  const payloadPart = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signaturePart = sign(payloadPart, secret);
  return `${payloadPart}.${signaturePart}`;
}

export function verifySignedToken(token, secret, {
  issuer,
  audience,
  nowSeconds = Math.floor(Date.now() / 1000)
} = {}) {
  const raw = String(token || '').trim();
  const parts = raw.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw authError('SSO 토큰 형식이 올바르지 않습니다.');
  }

  const expected = sign(parts[0], secret);
  if (!safeEqual(parts[1], expected)) {
    throw authError('SSO 토큰 서명이 올바르지 않습니다.');
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  } catch {
    throw authError('SSO 토큰 본문을 읽을 수 없습니다.');
  }

  if (!payload || typeof payload !== 'object') throw authError('SSO 토큰 본문이 올바르지 않습니다.');
  if (issuer && payload.iss !== issuer) throw authError('SSO 토큰 발급자가 올바르지 않습니다.');
  if (audience && payload.aud !== audience) throw authError('SSO 토큰 대상이 올바르지 않습니다.');
  if (!Number.isInteger(payload.exp) || payload.exp < nowSeconds) throw authError('SSO 토큰이 만료되었습니다.');
  if (Number.isInteger(payload.iat) && payload.iat > nowSeconds + 60) throw authError('SSO 토큰 발급 시간이 올바르지 않습니다.');

  return {
    ...payload,
    permissions: normalizePermissions(payload.permissions)
  };
}

export function hasPermission(user, permission) {
  return Array.isArray(user?.permissions) && user.permissions.includes(permission);
}

export function normalizePermissions(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(item => String(item || '').trim()).filter(Boolean))].sort();
}

function sign(payloadPart, secret) {
  return crypto
    .createHmac('sha256', String(secret || ''))
    .update(payloadPart, 'utf8')
    .digest('base64url');
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function authError(message) {
  const error = new Error(message);
  error.name = 'CompanyAuthError';
  error.statusCode = 401;
  return error;
}
