import http from 'node:http';
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSignedToken, hasPermission, verifySignedToken } from './lib/company-auth.js';

const CS_ACCESS = 'cs.access';
const SESSION_ISSUER = 'company-cs-gateway';
const SESSION_AUDIENCE = 'cs-session';
const MAX_CALLBACK_BODY_BYTES = 64 * 1024;

const externalHost = process.env.HOST || '0.0.0.0';
const externalPort = parsePort(process.env.PORT || '3000', 'PORT');
const internalPort = parsePort(process.env.CS_INTERNAL_PORT || '3100', 'CS_INTERNAL_PORT');
if (externalPort === internalPort) throw new Error('PORT와 CS_INTERNAL_PORT는 서로 달라야 합니다.');

const sharedSecret = String(process.env.COMPANY_SSO_SHARED_SECRET || '').trim();
const ssoIssuer = String(process.env.COMPANY_SSO_ISSUER || 'company-portal').trim();
const portalUrl = normalizePortalUrl(process.env.COMPANY_PORTAL_URL || '');
const secureCookies = parseBoolean(process.env.COOKIE_SECURE, false);
const trustProxy = parseBoolean(process.env.TRUST_PROXY, false);
const sessionMinutes = clampInteger(process.env.CS_SESSION_MINUTES, 5, 10080, 10080);
const sessionCookieName = secureCookies ? '__Host-CsSession' : 'CsSession';
const dataDir = String(process.env.CS_DATA_DIR || '').trim()
  || path.join(path.dirname(fileURLToPath(import.meta.url)), 'data');
const companyAuditPath = path.join(dataDir, 'company-access-audit.jsonl');

if (sharedSecret.length < 32) {
  throw new Error('SSO 모드에서는 COMPANY_SSO_SHARED_SECRET에 32자 이상의 공유 키가 필요합니다.');
}
if (!portalUrl) {
  throw new Error('SSO 모드에서는 COMPANY_PORTAL_URL 설정이 필요합니다.');
}

const gatewayUsername = '__company_gateway';
const gatewayPassword = crypto.randomBytes(48).toString('base64url');
const internalAuthorization = `Basic ${Buffer.from(`${gatewayUsername}:${gatewayPassword}`).toString('base64')}`;
const usedJtis = new Map();

await fs.mkdir(dataDir, { recursive: true });
await startInternalServer();

const gateway = http.createServer(async (req, res) => {
  const requestId = crypto.randomUUID();
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (url.pathname === '/health') {
      return proxyToInternal(req, res, null, requestId);
    }

    if (url.pathname === '/.well-known/assetlinks.json' && ['GET', 'HEAD'].includes(req.method || '')) {
      return proxyToInternal(req, res, null, requestId);
    }

    if (url.pathname === '/auth/sso/callback') {
      return await handleSsoCallback(req, res);
    }

    if (url.pathname === '/auth/logout') {
      clearSessionCookie(res);
      res.writeHead(303, { Location: portalUrl, 'Cache-Control': 'no-store' });
      res.end();
      return;
    }

    if (url.pathname === '/auth/company-home') {
      res.writeHead(303, { Location: portalUrl, 'Cache-Control': 'no-store' });
      res.end();
      return;
    }

    const user = readSession(req);
    if (!user || !hasPermission(user, CS_ACCESS)) {
      return requireLogin(req, res);
    }

    const state = await workspaceSessionStatus(user.sid, user.sub);
    if (state === 401) return requireLogin(req, res);
    if (state !== 204) return sendJson(res, state, { error: state===403?'서비스 접근 권한이 없습니다.':'회사 인증 서버 연결을 확인해 주세요.' });
    return proxyToInternal(req, res, user, requestId, renewSessionIfNeeded(user));
  } catch (error) {
    const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
    const message = statusCode < 500 ? error.message : 'CS 인증 게이트웨이 처리 중 오류가 발생했습니다.';
    if (!res.headersSent) sendJson(res, statusCode, { error: message, requestId });
    else res.destroy();
    if (statusCode >= 500) {
      console.error(`[company-gateway] requestId=${requestId} type=${error?.name || 'Error'} message=${error?.message || ''}`);
    }
  }
});

gateway.listen(externalPort, externalHost, () => {
  console.log(`[company-gateway] listening on ${externalHost}:${externalPort}, internal CS 127.0.0.1:${internalPort}`);
});

async function startInternalServer() {
  const saved = {
    HOST: process.env.HOST,
    PORT: process.env.PORT,
    CS_INTERNAL_GATEWAY_USERNAME: process.env.CS_INTERNAL_GATEWAY_USERNAME,
    CS_INTERNAL_GATEWAY_PASSWORD: process.env.CS_INTERNAL_GATEWAY_PASSWORD,
    TRUST_PROXY: process.env.TRUST_PROXY
  };

  process.env.HOST = '127.0.0.1';
  process.env.PORT = String(internalPort);
  process.env.CS_INTERNAL_GATEWAY_USERNAME = gatewayUsername;
  process.env.CS_INTERNAL_GATEWAY_PASSWORD = gatewayPassword;
  process.env.TRUST_PROXY = 'true';

  try {
    await import('./app-server.js');
  } finally {
    restoreEnv('HOST', saved.HOST);
    restoreEnv('PORT', saved.PORT);
    restoreEnv('CS_INTERNAL_GATEWAY_USERNAME', saved.CS_INTERNAL_GATEWAY_USERNAME);
    restoreEnv('CS_INTERNAL_GATEWAY_PASSWORD', saved.CS_INTERNAL_GATEWAY_PASSWORD);
    restoreEnv('TRUST_PROXY', saved.TRUST_PROXY);
  }
}

async function handleSsoCallback(req, res) {
  if (req.method !== 'POST') {
    res.writeHead(405, { Allow: 'POST', 'Cache-Control': 'no-store' });
    res.end();
    return;
  }

  const body = await readBody(req, MAX_CALLBACK_BODY_BYTES);
  const form = new URLSearchParams(body.toString('utf8'));
  const token = form.get('token') || '';
  const user = verifySignedToken(token, sharedSecret, {
    issuer: ssoIssuer,
    audience: 'cs'
  });

  if (!user.sub || !user.name || !user.email || !user.jti) {
    const error = new Error('SSO 사용자 정보가 올바르지 않습니다.');
    error.statusCode = 401;
    throw error;
  }
  if (!hasPermission(user, CS_ACCESS)) {
    const error = new Error('CS 접근 권한이 없습니다.');
    error.statusCode = 403;
    throw error;
  }

  cleanupUsedJtis();
  if (usedJtis.has(user.jti)) {
    const error = new Error('이미 사용된 SSO 토큰입니다. 회사 페이지에서 다시 진입해 주세요.');
    error.statusCode = 401;
    throw error;
  }
  usedJtis.set(user.jti, user.exp);

  const session = createGatewaySession(user);

  setSessionCookie(res, session);
  res.writeHead(303, {
    Location: normalizeReturnUrl(user.returnUrl) || '/',
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer'
  });
  res.end();
}

function createGatewaySession(user, now = Math.floor(Date.now() / 1000)) {
  return createSignedToken({
    iss: SESSION_ISSUER,
    aud: SESSION_AUDIENCE,
    sub: String(user.sub),
    sid: user.sid,
    name: String(user.name),
    email: String(user.email),
    permissions: user.permissions,
    iat: now,
    exp: now + sessionMinutes * 60,
    jti: crypto.randomUUID()
  }, sharedSecret);
}

function renewSessionIfNeeded(user) {
  const now = Math.floor(Date.now() / 1000);
  const renewalWindowSeconds = Math.ceil(sessionMinutes * 60 / 2);
  if (user.exp - now > renewalWindowSeconds) return '';
  return createGatewaySession(user, now);
}

function readSession(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  const token = cookies[sessionCookieName];
  if (!token) return null;

  try {
    return verifySignedToken(token, sharedSecret, {
      issuer: SESSION_ISSUER,
      audience: SESSION_AUDIENCE
    });
  } catch {
    return null;
  }
}

function requireLogin(req, res) {
  const requestedReturnUrl = String(req.headers['x-cs-return-url'] || '').trim();
  const returnUrl = normalizeReturnUrl(requestedReturnUrl)
    || (!String(req.url || '').startsWith('/api/') ? normalizeReturnUrl(req.url) : null)
    || '/';
  const loginUrl = new URL('/Auth/Cs', `${portalUrl}/`);
  loginUrl.searchParams.set('returnUrl', returnUrl);
  const pathname = String(req.url || '');
  if (pathname.startsWith('/api/')) {
    return sendJson(res, 401, { error: '회사 계정 로그인이 필요합니다.', loginUrl: loginUrl.toString() });
  }

  res.writeHead(303, {
    Location: loginUrl.toString(),
    'Cache-Control': 'no-store'
  });
  res.end();
}

function proxyToInternal(req, res, user, requestId, renewedSession = '') {
  const clientIp = getClientIp(req);
  const headers = { ...req.headers };
  for (const name of Object.keys(headers)) {
    if (name.toLowerCase().startsWith('x-company-')) delete headers[name];
  }
  delete headers.connection;
  delete headers['proxy-connection'];
  delete headers.upgrade;
  headers.authorization = internalAuthorization;
  headers['x-forwarded-for'] = clientIp;
  headers['x-forwarded-proto'] = getExternalProtocol(req);
  headers['x-company-request-id'] = requestId;

  if (user) {
    headers['x-company-user-id'] = String(user.sub);
    headers['x-company-user-name'] = encodeURIComponent(String(user.name));
    headers['x-company-user-email'] = encodeURIComponent(String(user.email));
  }

  const proxyReq = http.request({
    hostname: '127.0.0.1',
    port: internalPort,
    method: req.method,
    path: req.url,
    headers
  }, proxyRes => {
    const responseHeaders = { ...proxyRes.headers };
    delete responseHeaders.connection;
    if (renewedSession) {
      const renewedCookie = sessionCookie(renewedSession);
      const existingCookies = responseHeaders['set-cookie'];
      responseHeaders['set-cookie'] = existingCookies
        ? [...(Array.isArray(existingCookies) ? existingCookies : [existingCookies]), renewedCookie]
        : renewedCookie;
    }
    res.writeHead(proxyRes.statusCode || 502, responseHeaders);
    proxyRes.pipe(res);

    if (user && isSensitiveRequest(req.method, String(req.url || ''))) {
      proxyRes.once('end', () => {
        appendCompanyAudit({
          timestamp: new Date().toISOString(),
          requestId,
          userId: String(user.sub),
          userName: String(user.name),
          userEmail: String(user.email),
          method: req.method,
          path: String(req.url || '').split('?')[0],
          statusCode: proxyRes.statusCode || 0,
          ip: clientIp
        }).catch(error => console.error(`[company-gateway] audit write failed: ${error?.message || error}`));
      });
    }
  });

  proxyReq.on('error', error => {
    if (!res.headersSent) sendJson(res, 502, { error: '내부 CS 서버에 연결할 수 없습니다.', requestId });
    else res.destroy();
    console.error(`[company-gateway] proxy error requestId=${requestId} message=${error.message}`);
  });

  req.pipe(proxyReq);
}

function isSensitiveRequest(method, rawUrl) {
  if (method !== 'POST') return false;
  const pathname = rawUrl.split('?')[0];
  return pathname === '/api/transactions/refund'
    || pathname === '/api/playfab/product-commands/execute'
    || pathname === '/api/playfab/product-commands/delete';
}

async function appendCompanyAudit(record) {
  await fs.appendFile(companyAuditPath, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 });
}

function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', sessionCookie(token));
}

function sessionCookie(token) {
  const secure = secureCookies ? '; Secure' : '';
  return `${sessionCookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${sessionMinutes * 60}${secure}`;
}

function clearSessionCookie(res) {
  const secure = secureCookies ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${sessionCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
}

function parseCookies(header) {
  const cookies = {};
  for (const entry of header.split(';')) {
    const separator = entry.indexOf('=');
    if (separator < 0) continue;
    cookies[entry.slice(0, separator).trim()] = entry.slice(separator + 1).trim();
  }
  return cookies;
}

function getClientIp(req) {
  if (trustProxy) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (forwarded) return forwarded;
  }
  return req.socket.remoteAddress || 'unknown';
}

function getExternalProtocol(req) {
  if (trustProxy) {
    const forwarded = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
    if (forwarded === 'https' || forwarded === 'http') return forwarded;
  }
  return req.socket.encrypted ? 'https' : 'http';
}

function cleanupUsedJtis() {
  const now = Math.floor(Date.now() / 1000);
  for (const [jti, exp] of usedJtis) {
    if (!Number.isInteger(exp) || exp < now) usedJtis.delete(jti);
  }
}

async function readBody(req, maxBytes) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      const error = new Error('SSO 요청 데이터가 너무 큽니다.');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function normalizePortalUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') return '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

function normalizeReturnUrl(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.length > 2048 || !raw.startsWith('/') || raw.startsWith('//')) return '';
  try {
    const parsed = new URL(raw, 'http://cs.local');
    if (parsed.origin !== 'http://cs.local') return '';
    if (parsed.pathname.startsWith('/auth/') || parsed.pathname === '/health') return '/';
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return '';
  }
}

function parsePort(value, name) {
  const port = Number.parseInt(String(value || ''), 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`${name} 설정이 올바르지 않습니다.`);
  return port;
}

function clampInteger(value, minimum, maximum, fallback) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function restoreEnv(key, value) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}


async function workspaceSessionStatus(sid, sub) {
  if (typeof sid !== 'string' || !sid || typeof sub !== 'string' || !sub) return 401;
  const now = Math.floor(Date.now()/1000);
  const token = createSignedToken({iss:'cs',aud:'workspace-session',sid,sub,iat:now,exp:now+60,jti:crypto.randomUUID()}, sharedSecret);
  try {
    const response = await fetch((process.env.COMPANY_PORTAL_INTERNAL_URL || 'http://company-portal:8080')+'/api/internal/workspace/session', {
      headers: {Authorization:'Bearer '+token,Host:'company.example.com'}, redirect:'error', signal:AbortSignal.timeout(5000)
    });
    return response.ok ? 204 : [401,403].includes(response.status) ? response.status : 503;
  } catch { return 503; }
}
