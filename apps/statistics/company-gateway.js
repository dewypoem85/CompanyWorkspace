import http from 'node:http';
import crypto from 'node:crypto';
import { createSignedToken, hasPermission, verifySignedToken } from './lib/company-auth.js';

const ACCESS = 'statistics.access';
const SESSION_ISSUER = 'company-statistics-gateway';
const SESSION_AUDIENCE = 'statistics-session';
const externalHost = process.env.HOST || '0.0.0.0';
const externalPort = parsePort(process.env.PORT || '3010', 'PORT');
const internalPort = parsePort(process.env.STATISTICS_INTERNAL_PORT || '3110', 'STATISTICS_INTERNAL_PORT');
const sharedSecret = String(process.env.COMPANY_SSO_SHARED_SECRET || '').trim();
const ssoIssuer = String(process.env.COMPANY_SSO_ISSUER || 'company-portal').trim();
const portalUrl = normalizePortalUrl(process.env.COMPANY_PORTAL_URL || '');
const secureCookies = parseBoolean(process.env.COOKIE_SECURE, false);
const trustProxy = parseBoolean(process.env.TRUST_PROXY, false);
const sessionMinutes = clampInteger(process.env.STATISTICS_SESSION_MINUTES, 5, 10080, 10080);
const cookieName = secureCookies ? '__Host-StatisticsSession' : 'StatisticsSession';
const gatewayUsername = '__company_gateway';
const gatewayPassword = crypto.randomBytes(48).toString('base64url');
const internalAuthorization = `Basic ${Buffer.from(`${gatewayUsername}:${gatewayPassword}`).toString('base64')}`;
const usedJtis = new Map();
const sessionStatusCache = new Map();
const sessionStatusInflight = new Map();
const sessionCacheMs = clampInteger(process.env.STATISTICS_SESSION_CACHE_MS, 10, 30_000, 30_000);
const sessionFailureCacheMs = clampInteger(process.env.STATISTICS_SESSION_FAILURE_CACHE_MS, 10, 5_000, 5_000);

if (externalPort === internalPort) throw new Error('PORT와 STATISTICS_INTERNAL_PORT는 서로 달라야 합니다.');
if (sharedSecret.length < 32) throw new Error('COMPANY_SSO_SHARED_SECRET에 32자 이상의 공유 키가 필요합니다.');
if (!portalUrl) throw new Error('COMPANY_PORTAL_URL 설정이 필요합니다.');

await startInternalServer();

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname === '/health') return proxy(req, res, null);
    if (url.pathname === '/.well-known/assetlinks.json' && ['GET', 'HEAD'].includes(req.method || '')) return proxy(req, res, null);
    if (url.pathname === '/auth/sso/callback') return await handleCallback(req, res);
    if (url.pathname === '/auth/logout') { clearCookie(res); res.writeHead(303, { Location: portalUrl, 'Cache-Control': 'no-store' }); return res.end(); }
    if (url.pathname === '/auth/company-home') { res.writeHead(303, { Location: portalUrl, 'Cache-Control': 'no-store' }); return res.end(); }
    if (isPublicStatic(url.pathname) && ['GET', 'HEAD'].includes(req.method || '')) return proxy(req, res, null);
    const user = readSession(req);
    if (!user || !hasPermission(user, ACCESS)) return requireLogin(req, res);
    const state = await workspaceSessionStatus(user.sid, user.sub);
    if (state === 401) return requireLogin(req, res);
    if (state !== 204) return sendJson(res, state, { error: state===403?'서비스 접근 권한이 없습니다.':'회사 인증 서버 연결을 확인해 주세요.' });
    return proxy(req, res, user);
  } catch (error) {
    const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
    sendJson(res, status, { error: status < 500 ? error.message : '통계 인증 처리 중 오류가 발생했습니다.' });
  }
}).listen(externalPort, externalHost, () => console.log(`[statistics-gateway] listening on ${externalHost}:${externalPort}`));

async function startInternalServer() {
  process.env.HOST = '127.0.0.1';
  process.env.PORT = String(internalPort);
  process.env.STATISTICS_INTERNAL_GATEWAY_USERNAME = gatewayUsername;
  process.env.STATISTICS_INTERNAL_GATEWAY_PASSWORD = gatewayPassword;
  await import('./app-server.js');
}

async function handleCallback(req, res) {
  if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST' }); return res.end(); }
  const body = await readBody(req, 64 * 1024);
  const token = new URLSearchParams(body.toString('utf8')).get('token') || '';
  const user = verifySignedToken(token, sharedSecret, { issuer: ssoIssuer, audience: 'statistics' });
  if (!user.sub || !user.name || !user.email || !user.jti || !hasPermission(user, ACCESS)) throw httpError(403, '통계 시스템 접근 권한이 없습니다.');
  cleanupJtis();
  if (usedJtis.has(user.jti)) throw httpError(401, '이미 사용된 SSO 토큰입니다. 회사 홈에서 다시 진입해 주세요.');
  usedJtis.set(user.jti, user.exp);
  const now = Math.floor(Date.now() / 1000);
  const session = createSignedToken({ iss: SESSION_ISSUER, aud: SESSION_AUDIENCE, sub: String(user.sub), sid: user.sid, name: String(user.name), email: String(user.email), role: String(user.role || 'employee'), permissions: user.permissions, iat: now, exp: now + sessionMinutes * 60, jti: crypto.randomUUID() }, sharedSecret);
  setCookie(res, session);
  res.writeHead(303, { Location: normalizeReturnUrl(user.returnUrl) || '/', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  res.end();
}

function readSession(req) {
  const cookies = Object.fromEntries(String(req.headers.cookie || '').split(';').map(item => item.trim().split(/=(.*)/s)).filter(parts => parts[0]));
  try { return verifySignedToken(cookies[cookieName], sharedSecret, { issuer: SESSION_ISSUER, audience: SESSION_AUDIENCE }); }
  catch { return null; }
}

function requireLogin(req, res) {
  const requested = String(req.headers['x-statistics-return-url'] || '').trim();
  const returnUrl = normalizeReturnUrl(requested) || (!String(req.url || '').startsWith('/api/') ? normalizeReturnUrl(req.url) : null) || '/';
  const loginUrl = new URL('/Auth/Statistics', `${portalUrl}/`);
  loginUrl.searchParams.set('returnUrl', returnUrl);
  if (String(req.url || '').startsWith('/api/')) return sendJson(res, 401, { error: '회사 계정 로그인이 필요합니다.', loginUrl: loginUrl.toString() });
  res.writeHead(303, { Location: loginUrl.toString(), 'Cache-Control': 'no-store' });
  res.end();
}

function proxy(req, res, user) {
  const headers = { ...req.headers, authorization: internalAuthorization, 'x-forwarded-proto': externalProtocol(req) };
  for (const name of Object.keys(headers)) if (name.toLowerCase().startsWith('x-company-')) delete headers[name];
  delete headers.connection; delete headers['proxy-connection']; delete headers.upgrade;
  if (user) { headers['x-company-user-id'] = String(user.sub); headers['x-company-user-name'] = encodeURIComponent(String(user.name)); headers['x-company-user-email'] = encodeURIComponent(String(user.email)); headers['x-company-user-role'] = String(user.role || 'employee'); }
  const proxyReq = http.request({ hostname: '127.0.0.1', port: internalPort, method: req.method, path: req.url, headers }, proxyRes => { res.writeHead(proxyRes.statusCode || 502, proxyRes.headers); proxyRes.pipe(res); });
  proxyReq.on('error', () => sendJson(res, 502, { error: '내부 통계 서버에 연결할 수 없습니다.' }));
  req.pipe(proxyReq);
}

function setCookie(res, token) { res.setHeader('Set-Cookie', `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${sessionMinutes * 60}${secureCookies ? '; Secure' : ''}`); }
function clearCookie(res) { res.setHeader('Set-Cookie', `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureCookies ? '; Secure' : ''}`); }
function cleanupJtis() { const now = Math.floor(Date.now() / 1000); for (const [jti, exp] of usedJtis) if (!Number.isInteger(exp) || exp < now) usedJtis.delete(jti); }
function externalProtocol(req) { if (trustProxy) { const value = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim(); if (['http', 'https'].includes(value)) return value; } return req.socket.encrypted ? 'https' : 'http'; }
function normalizePortalUrl(value) { try { const url = new URL(String(value || '').trim()); if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) return ''; return url.toString().replace(/\/$/, ''); } catch { return ''; } }
function normalizeReturnUrl(value) { const raw = String(value || '').trim(); if (!raw || raw.length > 2048 || !raw.startsWith('/') || raw.startsWith('//')) return ''; try { const parsed = new URL(raw, 'http://statistics.local'); if (parsed.origin !== 'http://statistics.local' || parsed.pathname.startsWith('/auth/') || parsed.pathname === '/health') return '/'; return `${parsed.pathname}${parsed.search}`; } catch { return ''; } }
function parsePort(value, name) { const port = Number.parseInt(String(value || ''), 10); if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`${name} 설정이 올바르지 않습니다.`); return port; }
function clampInteger(value, min, max, fallback) { const parsed = Number.parseInt(String(value ?? ''), 10); return Number.isInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback; }
function parseBoolean(value, fallback) { if (value === undefined || value === null || value === '') return fallback; return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase()); }
async function readBody(req, max) { const chunks = []; let total = 0; for await (const chunk of req) { total += chunk.length; if (total > max) throw httpError(413, 'SSO 요청 데이터가 너무 큽니다.'); chunks.push(chunk); } return Buffer.concat(chunks); }
function sendJson(res, status, payload) { if (res.headersSent) return res.destroy(); const body = JSON.stringify(payload); res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' }); res.end(body); }
function httpError(statusCode, message) { const error = new Error(message); error.statusCode = statusCode; return error; }


async function workspaceSessionStatus(sid, sub) {
  if (typeof sid !== 'string' || !sid || typeof sub !== 'string' || !sub) return 401;
  const key = `${sid}:${sub}`;
  const cached = sessionStatusCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.status;
  if (sessionStatusInflight.has(key)) return sessionStatusInflight.get(key);
  const request = requestWorkspaceSessionStatus(sid, sub).then(status => {
    sessionStatusCache.set(key, { status, expiresAt: Date.now() + (status === 204 ? sessionCacheMs : sessionFailureCacheMs) });
    if (sessionStatusCache.size > 10_000) cleanupSessionCache();
    return status;
  }).finally(() => sessionStatusInflight.delete(key));
  sessionStatusInflight.set(key, request);
  return request;
}

async function requestWorkspaceSessionStatus(sid, sub) {
  const now = Math.floor(Date.now()/1000);
  const token = createSignedToken({iss:'statistics',aud:'workspace-session',sid,sub,iat:now,exp:now+60,jti:crypto.randomUUID()}, sharedSecret);
  try {
    const response = await fetch((process.env.COMPANY_PORTAL_INTERNAL_URL || 'http://company-portal:8080')+'/api/internal/workspace/session', {
      headers: {Authorization:'Bearer '+token,Host:'company.example.com'}, redirect:'error', signal:AbortSignal.timeout(5000)
    });
    return response.ok ? 204 : [401,403].includes(response.status) ? response.status : 503;
  } catch { return 503; }
}

function isPublicStatic(pathname) {
  return pathname.startsWith('/dist/assets/') || pathname.startsWith('/assets/entities/');
}

function cleanupSessionCache() {
  const now = Date.now();
  for (const [key, value] of sessionStatusCache) if (value.expiresAt <= now) sessionStatusCache.delete(key);
  while (sessionStatusCache.size > 10_000) sessionStatusCache.delete(sessionStatusCache.keys().next().value);
}
