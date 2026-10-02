import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { config } from './config.js';

const ACCESS_PERMISSION = 'sheet.access';
const SESSION_ISSUER = 'company-sheet';
const SESSION_AUDIENCE = 'sheet-session';
const usedJtis = new Map<string, number>();
const requestActors = new WeakMap<Request, string>();

interface CompanyToken {
  iss?: string;
  aud?: string;
  sub?: string;
  sid?: string;
  name?: string;
  email?: string;
  role?: string;
  permissions?: string[];
  iat?: number;
  exp?: number;
  jti?: string;
  returnUrl?: string;
}

export function createSignedToken(payload: CompanyToken, secret: string): string {
  const payloadPart = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  return `${payloadPart}.${sign(payloadPart, secret)}`;
}

export function verifySignedToken(
  token: string | undefined,
  secret: string,
  expected: { issuer: string; audience: string; nowSeconds?: number },
): CompanyToken {
  const parts = String(token ?? '').trim().split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw authError('SSO 토큰 형식이 올바르지 않습니다.');

  const signature = sign(parts[0], secret);
  if (!safeEqual(parts[1], signature)) throw authError('SSO 토큰 서명이 올바르지 않습니다.');

  let payload: CompanyToken;
  try {
    payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as CompanyToken;
  } catch {
    throw authError('SSO 토큰 본문을 읽을 수 없습니다.');
  }

  const now = expected.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (payload.iss !== expected.issuer) throw authError('SSO 토큰 발급자가 올바르지 않습니다.');
  if (payload.aud !== expected.audience) throw authError('SSO 토큰 대상이 올바르지 않습니다.');
  if (!Number.isInteger(payload.exp) || Number(payload.exp) < now) throw authError('SSO 토큰이 만료되었습니다.');
  if (Number.isInteger(payload.iat) && Number(payload.iat) > now + 60) throw authError('SSO 토큰 발급 시간이 올바르지 않습니다.');
  payload.permissions = normalizePermissions(payload.permissions);
  return payload;
}

export function normalizeReturnUrl(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw || raw.length > 2048 || !raw.startsWith('/') || raw.startsWith('//')) return '/';
  try {
    const parsed = new URL(raw, 'http://sheet.local');
    if (parsed.origin !== 'http://sheet.local' || parsed.pathname.startsWith('/auth/')) return '/';
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return '/';
  }
}

export function registerCompanyAuthRoutes(
  app: import('express').Express,
): void {
  if (config.companySso.trustProxy) app.set('trust proxy', true);

  app.post('/auth/sso/callback', (request, response) => {
    if (!config.companySso.enabled) {
      response.status(404).end();
      return;
    }

    try {
      const token = verifySignedToken(
        String(request.body?.token ?? ''),
        config.companySso.sharedSecret,
        { issuer: config.companySso.issuer, audience: 'sheet' },
      );
      if (!token.sub || !token.name || !token.email || !token.jti || !hasPermission(token, ACCESS_PERMISSION)) {
        response.status(403).json({ error: '시트 관리 시스템 접근 권한이 없습니다.' });
        return;
      }

      cleanupJtis();
      if (usedJtis.has(token.jti)) {
        response.status(401).json({ error: '이미 사용된 SSO 토큰입니다. 회사 홈에서 다시 진입해 주세요.' });
        return;
      }
      usedJtis.set(token.jti, Number(token.exp));

      const now = Math.floor(Date.now() / 1000);
      const session = createSignedToken({
        iss: SESSION_ISSUER,
        aud: SESSION_AUDIENCE,
        sub: token.sub,
        sid: token.sid,
        name: token.name,
        email: token.email,
        role: token.role ?? 'employee',
        permissions: token.permissions,
        iat: now,
        exp: now + config.companySso.sessionMinutes * 60,
        jti: crypto.randomUUID(),
      }, config.companySso.sharedSecret);

      response
        .set('Cache-Control', 'no-store')
        .set('Referrer-Policy', 'no-referrer')
        .set('Set-Cookie', sessionCookie(session))
        .redirect(303, normalizeReturnUrl(token.returnUrl));
    } catch (error) {
      const status = error instanceof CompanyAuthError ? error.statusCode : 500;
      response.status(status).json({
        error: status < 500 && error instanceof Error
          ? error.message
          : '회사 계정 인증 처리 중 오류가 발생했습니다.',
      });
    }
  });

  app.get('/auth/logout', (_request, response) => {
    response
      .set('Cache-Control', 'no-store')
      .set('Set-Cookie', expiredSessionCookie())
      .redirect(303, config.companySso.portalUrl || '/');
  });

  app.get('/auth/company-home', (_request, response) => {
    response.redirect(303, config.companySso.portalUrl || '/');
  });
}

export async function requireCompanyAuth(request: Request, response: Response, next: NextFunction): Promise<void> {
  if (!config.companySso.enabled) {
    requestActors.set(request, 'local-development');
    next();
    return;
  }
  if (request.path === '/api/health') {
    next();
    return;
  }

  const session = readSession(request);
  if (session && hasPermission(session, ACCESS_PERMISSION)) {
    const state = await workspaceSessionStatus(session.sid, session.sub);
    if (state !== 204) { response.status(state).json({error:state === 503 ? '회사 인증 서버에 연결하지 못했습니다. 다시 시도해 주세요.' : '회사 계정 로그인이 필요합니다.',loginUrl:'/auth/login'}); return; }
    const now = Math.floor(Date.now() / 1000);
    if (Number(session.exp) - now <= Math.ceil(config.companySso.sessionMinutes * 30)) {
      const renewed = createSignedToken({
        ...session,
        iat: now,
        exp: now + config.companySso.sessionMinutes * 60,
        jti: crypto.randomUUID(),
      }, config.companySso.sharedSecret);
      response.append('Set-Cookie', sessionCookie(renewed));
    }
    requestActors.set(request, String(session.sub));
    next();
    return;
  }

  const returnUrl = request.path.startsWith('/api/') ? '/' : normalizeReturnUrl(request.originalUrl);
  const loginUrl = new URL('/Auth/Sheet', `${config.companySso.portalUrl}/`);
  loginUrl.searchParams.set('returnUrl', returnUrl);

  if (request.path.startsWith('/api/')) {
    response.status(401).json({ error: '회사 계정 로그인이 필요합니다.', loginUrl: loginUrl.toString() });
    return;
  }
  response.set('Cache-Control', 'no-store').redirect(303, loginUrl.toString());
}

export function companyActorId(request: Request): string {
  return requestActors.get(request) ?? '';
}

function readSession(request: Request): CompanyToken | null {
  const cookies = Object.fromEntries(
    String(request.headers.cookie ?? '')
      .split(';')
      .map((item) => item.trim().split(/=(.*)/s))
      .filter((parts) => Boolean(parts[0])),
  );
  try {
    return verifySignedToken(cookies[cookieName()], config.companySso.sharedSecret, {
      issuer: SESSION_ISSUER,
      audience: SESSION_AUDIENCE,
    });
  } catch {
    return null;
  }
}

function hasPermission(token: CompanyToken, permission: string): boolean {
  return Array.isArray(token.permissions) && token.permissions.includes(permission);
}

function normalizePermissions(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item ?? '').trim()).filter(Boolean))].sort();
}

function cookieName(): string {
  return config.companySso.cookieSecure ? '__Host-SheetSession' : 'SheetSession';
}

function sessionCookie(token: string): string {
  return `${cookieName()}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${config.companySso.sessionMinutes * 60}${config.companySso.cookieSecure ? '; Secure' : ''}`;
}

function expiredSessionCookie(): string {
  return `${cookieName()}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${config.companySso.cookieSecure ? '; Secure' : ''}`;
}

function cleanupJtis(): void {
  const now = Math.floor(Date.now() / 1000);
  for (const [jti, expiresAt] of usedJtis) {
    if (!Number.isInteger(expiresAt) || expiresAt < now) usedJtis.delete(jti);
  }
}

function sign(payloadPart: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(payloadPart, 'utf8').digest('base64url');
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

class CompanyAuthError extends Error {
  statusCode = 401;
}

function authError(message: string): CompanyAuthError {
  return new CompanyAuthError(message);
}


async function workspaceSessionStatus(sid: unknown, sub: unknown): Promise<number> {
  if (typeof sid !== 'string' || !sid || typeof sub !== 'string' || !sub) return 401;
  const now = Math.floor(Date.now()/1000);
  const token = createSignedToken({iss:'sheet',aud:'workspace-session',sid,sub,iat:now,exp:now+60,jti:crypto.randomUUID()}, config.companySso.sharedSecret);
  try {
    const response = await fetch((process.env.COMPANY_PORTAL_INTERNAL_URL || 'http://company-portal:8080')+'/api/internal/workspace/session', {
      headers: {Authorization:'Bearer '+token,Host:'company.example.com'}, redirect:'error', signal:AbortSignal.timeout(5000)
    });
    return response.ok ? 204 : [401,403].includes(response.status) ? response.status : 503;
  } catch { return 503; }
}
