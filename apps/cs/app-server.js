import http from 'node:http';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  parseBoolean,
  validateAppId,
  ValidationError
} from './lib/validation.js';
import { createSteamClient, SteamApiError } from './lib/steam.js';
import { createSteamReportIndex, STEAM_REPORT_DEFAULT_START_TIME } from './lib/steam-report-index.js';
import { createProductCommandApi } from './lib/product-command-api.js';
import { createPlayFabLogSearchApi } from './lib/playfab-log-search.js';
import { createPlayerDataApi } from './lib/player-data-api.js';
import { companyUserAuditFields } from './lib/company-user.js';
import { resolvePublicAsset } from './lib/public-assets.js';
import { createSteamTransactionApi } from './lib/steam-transaction-api.js';
import { createSteamProductCatalog } from './lib/steam-product-catalog.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = String(process.env.CS_DATA_DIR || '').trim() || path.join(__dirname, 'data');
const REFUND_AUDIT_LOG_PATH = path.join(DATA_DIR, 'refund-audit.jsonl');
const MAX_BODY_BYTES = 512 * 1024;
const MAX_PLAYER_DATA_BODY_BYTES = 70 * 1024 * 1024;
const MAX_AUDIT_READ_BYTES = 2 * 1024 * 1024;
const CSRF_COOKIE = 'cs_tool_csrf';
const AUDIT_RESULTS = new Set(['attempted', 'success', 'failed', 'rejected']);

const config = loadConfig();
const steamClient = config.publisherKey
  ? createSteamClient({
      publisherKey: config.publisherKey,
      appId: config.appId,
      useSandbox: config.useSandbox
    })
  : null;
const steamReportIndex = steamClient
  ? createSteamReportIndex({
      steamClient,
      filePath: path.join(DATA_DIR, `steam-transactions-${config.appId}-${config.useSandbox ? 'sandbox' : 'production'}.json`),
      namespace: `${config.appId}/${config.useSandbox ? 'sandbox' : 'production'}`,
      startTime: config.steamReportStartTime
    })
  : null;

const productCommandApi = createProductCommandApi({
  dataDir: DATA_DIR,
  liveEnabled: false,
  mockMode: config.playFabProductCommandsMockMode,
  concurrency: config.playFabProductCommandsConcurrency
});

const playFabLogSearchApi = createPlayFabLogSearchApi({
  dataDir: DATA_DIR,
  storageAccount: config.azurePlayFabLogStorageAccount,
  container: config.azurePlayFabLogContainer,
  sasToken: config.azurePlayFabLogSasToken,
  prefix: config.azurePlayFabLogPrefix,
  liveTitleId: config.playFabLiveTitleId,
  testTitleId: config.playFabTestTitleId,
  concurrency: config.azurePlayFabLogConcurrency,
  jobConcurrency: config.azurePlayFabLogJobConcurrency
});

const playerDataApi = createPlayerDataApi({
  dataDir: DATA_DIR,
  liveEnabled: false,
  mockMode: config.playFabPlayerDataMockMode
});

const steamProductCatalog = createSteamProductCatalog({ playFabClient: productCommandApi.environments?.live?.client });
const steamTransactionApi = createSteamTransactionApi({ steamClient, steamReportIndex, steamProductCatalog, refundEnabled: config.refundEnabled, appendRefundAudit, appendRefundAuditSafe });
const rateLimits = new Map();

await fs.mkdir(DATA_DIR, { recursive: true });

const server = http.createServer(async (req, res) => {
  const requestId = crypto.randomUUID();
  setSecurityHeaders(res, config);
  res.setHeader('X-Request-ID', requestId);

  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (url.pathname === '/health') {
      const environments = productCommandApi.environments || {};
      const productConfigured = Boolean(environments.live?.client || environments.test?.client);
      const productWriteEnabled = Boolean(
        (environments.live?.client && (environments.live.client.mode === 'mock' || environments.live.liveEnabled))
        || (environments.test?.client && (environments.test.client.mode === 'mock' || environments.test.liveEnabled))
      );
      const playerDataEnvironments = playerDataApi.environments || {};
      const playerDataConfigured = Boolean(
        playerDataEnvironments.live?.client || playerDataEnvironments.test?.client
      );
      const playerDataWriteEnabled = Boolean(
        (playerDataEnvironments.live?.client
          && (playerDataEnvironments.live.client.mode === 'mock' || playerDataEnvironments.live.writeEnabled))
        || (playerDataEnvironments.test?.client
          && (playerDataEnvironments.test.client.mode === 'mock' || playerDataEnvironments.test.writeEnabled))
      );
      return sendJson(res, 200, {
        status: 'ok',
        configured: Boolean(config.gatewayUsername && config.gatewayPassword),
        steamConfigured: Boolean(steamClient),
        productCommandsConfigured: productConfigured,
        productCommandsMode: productCommandApi.client?.mode || 'disabled',
        productCommandsEnabled: productWriteEnabled,
        playerDataConfigured,
        playerDataWriteEnabled,
        playFabLogSearchConfigured: Boolean(playFabLogSearchApi.configured),
        refundEnabled: config.refundEnabled,
        sandbox: config.useSandbox
      });
    }

    if (url.pathname === '/.well-known/assetlinks.json' && ['GET', 'HEAD'].includes(req.method || '')) {
      return await serveStatic(res, url.pathname);
    }

    const authenticatedUser = authenticate(req, res, config);
    if (!authenticatedUser) return;

    if (url.pathname.startsWith('/api/')) {
      return await handleApi(req, res, url, authenticatedUser, requestId);
    }

    return await serveStatic(res, url.pathname, authenticatedUser.id);
  } catch (error) {
    await handleError(res, error, requestId);
  }
});

server.listen(config.port, config.host, () => {
  const steamMode = config.useSandbox ? 'SANDBOX' : 'PRODUCTION';
  console.log(`[startup] CS Tool listening on ${config.host}:${config.port} (Steam ${steamMode})`);

  if (!steamClient) {
    console.warn('[startup] STEAM_PUBLISHER_KEY가 없어 Steam API 기능이 비활성화됩니다.');
  }
  if (config.playFabProductCommandsMockMode) {
    console.warn('[startup] PlayFab 상품 지급·회수 기능이 MOCK 모드입니다. 실제 PlayFab을 변경하지 않습니다.');
  } else if (!productCommandApi.environments?.live?.client && !productCommandApi.environments?.test?.client) {
    console.warn('[startup] PlayFab 라이브/테스트 연결 설정이 없어 상품 지급·회수 기능이 비활성화됩니다.');
  }
  if (config.playFabPlayerDataMockMode) {
    console.warn('[startup] PlayFab 플레이어 데이터 기능이 MOCK 모드입니다. 실제 PlayFab을 변경하지 않습니다.');
  } else if (!playerDataApi.environments?.live?.client && !playerDataApi.environments?.test?.client) {
    console.warn('[startup] PlayFab 연결 설정이 없어 플레이어 데이터 기능이 비활성화됩니다.');
  }
  if (!playFabLogSearchApi.configured) {
    console.warn('[startup] Azure PlayFab 로그 검색 설정이 없어 로그 검색 기능이 비활성화됩니다.');
  }
  if (!config.gatewayUsername || !config.gatewayPassword) {
    console.warn('[startup] 내부 Company Gateway 인증정보가 없어 화면 접근이 차단됩니다.');
  }
  if (!config.useSandbox && config.refundEnabled) {
    console.warn('[startup] 실제 결제 환불이 활성화된 PRODUCTION 모드입니다.');
  }
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}

async function handleApi(req, res, url, authenticatedUser, requestId) {
  if (req.method === 'GET' && url.pathname === '/api/config') {
    const existingCsrfToken = readCsrfCookie(req);
    const csrfToken = existingCsrfToken || crypto.randomBytes(32).toString('base64url');
    if (!existingCsrfToken) setCsrfCookie(res, csrfToken, config.secureCookies);
    return sendJson(res, 200, {
      appId: config.appId,
      sandbox: config.useSandbox,
      refundEnabled: config.refundEnabled,
      apiConfigured: Boolean(steamClient),
      csrfToken,
      currentUser: authenticatedUser
    });
  }

  if (req.method === 'GET' && url.pathname === '/api/refund-logs') {
    const ip = getClientIp(req, config.trustProxy);
    enforceRateLimit(`logs:${ip}`, 60, 60_000);
    const limit = clampInteger(url.searchParams.get('limit'), 1, 200, 100);
    const result = String(url.searchParams.get('result') || '').trim().toLowerCase();
    const query = String(url.searchParams.get('query') || '').trim().slice(0, 100);
    if (result && !AUDIT_RESULTS.has(result)) {
      throw new ValidationError('로그 결과 필터가 올바르지 않습니다.');
    }
    return sendJson(res, 200, await readAuditLogs({ limit, result, query }));
  }

  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: '지원하지 않는 요청 방식입니다.' });
  }

  verifyCsrf(req);
  verifyOrigin(req, config);
  const ip = getClientIp(req, config.trustProxy);

  if (url.pathname.startsWith('/api/playfab/product-commands/')) {
    const body = await readJsonBody(req);
    const productResponse = await productCommandApi.handle({
      path: url.pathname,
      body,
      authenticatedUser,
      requestId,
      ip
    });
    return sendJson(res, productResponse.statusCode, productResponse.payload);
  }

  if (url.pathname.startsWith('/api/playfab/player-data/')) {
    enforceRateLimit(`player-data:${ip}`, 30, 60_000);
    const body = await readJsonBody(req, MAX_PLAYER_DATA_BODY_BYTES);
    const playerDataResponse = await playerDataApi.handle({
      path: url.pathname,
      body,
      authenticatedUser,
      requestId,
      ip
    });
    return sendJson(res, playerDataResponse.statusCode, playerDataResponse.payload);
  }

  if (url.pathname.startsWith('/api/playfab/log-search/')) {
    const isStatusPoll = url.pathname === '/api/playfab/log-search/status';
    enforceRateLimit(
      `${isStatusPoll ? 'playfab-log-search-status' : 'playfab-log-search'}:${ip}`,
      isStatusPoll ? 120 : 10,
      60_000
    );
    const body = await readJsonBody(req);
    const logResponse = await playFabLogSearchApi.handle({
      path: url.pathname,
      body,
      authenticatedUser,
      requestId,
      ip
    });
    return sendJson(res, logResponse.statusCode, logResponse.payload);
  }

  if (url.pathname === '/api/transactions/query') {
    enforceRateLimit(`query:${authenticatedUser.id}:${ip}`, 30, 60_000);
    ensureSteamConfigured();
    const body = await readJsonBody(req);
    const result = await steamTransactionApi.query(body);
    return sendJson(res, result.statusCode, result.payload);
  }

  if (url.pathname === '/api/transactions/history') {
    enforceRateLimit(`history:${authenticatedUser.id}:${ip}`, 10, 60_000);
    ensureSteamConfigured();
    const body = await readJsonBody(req);
    const result = await steamTransactionApi.history(body);
    return sendJson(res, result.statusCode, result.payload);
  }

  if (url.pathname === '/api/transactions/refund') {
    return handleRefund(req, res, authenticatedUser, requestId, ip);
  }

  return sendJson(res, 404, { error: 'API 경로를 찾을 수 없습니다.' });
}

async function handleRefund(req, res, authenticatedUser, requestId, ip) {
  enforceRateLimit(`refund:${ip}`, 5, 10 * 60_000);
  ensureSteamConfigured();
  if (!config.refundEnabled) {
    return sendJson(res, 403, { error: '서버에서 실제 환불 기능이 비활성화되어 있습니다.' });
  }
  const body = await readJsonBody(req);
  const result = await steamTransactionApi.refund(body, { authenticatedUser, requestId, ip });
  return sendJson(res, result.statusCode, result.payload);
}

function loadConfig() {
  const appId = validateAppId(process.env.STEAM_APP_ID || '2712460');
  const port = Number.parseInt(process.env.PORT || '3000', 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT 설정이 올바르지 않습니다.');
  }

  const productConcurrency = Number.parseInt(
    process.env.PLAYFAB_PRODUCT_COMMANDS_CONCURRENCY || '4',
    10
  );
  if (!Number.isInteger(productConcurrency) || productConcurrency < 1 || productConcurrency > 10) {
    throw new Error('PLAYFAB_PRODUCT_COMMANDS_CONCURRENCY는 1~10 범위의 정수여야 합니다.');
  }

  const logConcurrency = Number.parseInt(process.env.AZURE_PLAYFAB_LOG_CONCURRENCY || '4', 10);
  if (!Number.isInteger(logConcurrency) || logConcurrency < 1 || logConcurrency > 8) {
    throw new Error('AZURE_PLAYFAB_LOG_CONCURRENCY는 1~8 범위의 정수여야 합니다.');
  }
  const logJobConcurrency = Number.parseInt(process.env.AZURE_PLAYFAB_LOG_JOB_CONCURRENCY || '4', 10);
  if (!Number.isInteger(logJobConcurrency) || logJobConcurrency < 1 || logJobConcurrency > 8) {
    throw new Error('AZURE_PLAYFAB_LOG_JOB_CONCURRENCY는 1~8 범위의 정수여야 합니다.');
  }
  const steamReportStartTime = String(process.env.STEAM_REPORT_START_TIME || STEAM_REPORT_DEFAULT_START_TIME).trim();
  if (!steamReportStartTime || Number.isNaN(new Date(steamReportStartTime).getTime())) {
    throw new Error('STEAM_REPORT_START_TIME은 RFC 3339 날짜/시각이어야 합니다.');
  }

  return {
    host: process.env.HOST || '0.0.0.0',
    port,
    publisherKey: String(process.env.STEAM_PUBLISHER_KEY || '').trim(),
    appId,
    useSandbox: parseBoolean(process.env.STEAM_USE_SANDBOX, false),
    refundEnabled: parseBoolean(process.env.STEAM_REFUND_ENABLED, false),
    steamReportStartTime,
    playFabProductCommandsMockMode: parseBoolean(process.env.PLAYFAB_PRODUCT_COMMANDS_MOCK_MODE, false),
    playFabPlayerDataMockMode: parseBoolean(process.env.PLAYFAB_PLAYER_DATA_MOCK_MODE, false),
    playFabProductCommandsConcurrency: productConcurrency,
    playFabLiveTitleId: String(process.env.PLAYFAB_LIVE_TITLE_ID || '').trim(),
    playFabTestTitleId: String(process.env.PLAYFAB_TEST_TITLE_ID || '').trim(),
    azurePlayFabLogStorageAccount: String(process.env.AZURE_PLAYFAB_LOG_STORAGE_ACCOUNT || '').trim(),
    azurePlayFabLogContainer: String(process.env.AZURE_PLAYFAB_LOG_CONTAINER || 'logs').trim(),
    azurePlayFabLogSasToken: String(process.env.AZURE_PLAYFAB_LOG_SAS_TOKEN || '').trim(),
    azurePlayFabLogPrefix: String(process.env.AZURE_PLAYFAB_LOG_PREFIX || 'data').trim(),
    azurePlayFabLogConcurrency: logConcurrency,
    azurePlayFabLogJobConcurrency: logJobConcurrency,
    gatewayUsername: String(process.env.CS_INTERNAL_GATEWAY_USERNAME || '').trim(),
    gatewayPassword: String(process.env.CS_INTERNAL_GATEWAY_PASSWORD || ''),
    secureCookies: parseBoolean(process.env.COOKIE_SECURE, false),
    trustProxy: parseBoolean(process.env.TRUST_PROXY, false)
  };
}

function authenticate(req, res, appConfig) {
  if (!appConfig.gatewayUsername || !appConfig.gatewayPassword) {
    sendJson(res, 503, { error: '내부 Company Gateway 인증정보가 설정되지 않았습니다.' });
    return null;
  }

  const authorization = req.headers.authorization || '';
  if (!authorization.startsWith('Basic ')) {
    requestBasicAuth(res);
    return null;
  }

  let decoded;
  try {
    decoded = Buffer.from(authorization.slice(6), 'base64').toString('utf8');
  } catch {
    requestBasicAuth(res);
    return null;
  }

  const separatorIndex = decoded.indexOf(':');
  if (separatorIndex < 0) {
    requestBasicAuth(res);
    return null;
  }

  const username = decoded.slice(0, separatorIndex);
  const password = decoded.slice(separatorIndex + 1);
  if (!safeEqual(username, appConfig.gatewayUsername) || !safeEqual(password, appConfig.gatewayPassword)) {
    requestBasicAuth(res);
    return null;
  }
  const companyUser = readCompanyUser(req);
  if (!companyUser) {
    sendJson(res, 401, { error: '회사 인증 게이트웨이 사용자 정보가 올바르지 않습니다.' });
    return null;
  }
  return companyUser;
}

function readCompanyUser(req) {
  const id = String(req.headers['x-company-user-id'] || '').trim();
  const name = decodeCompanyHeader(req.headers['x-company-user-name']);
  const email = decodeCompanyHeader(req.headers['x-company-user-email']).toLowerCase();
  if (!/^\d+$/.test(id) || !name || !email || !email.includes('@')) return null;
  if (id.length > 32 || name.length > 200 || email.length > 320) return null;
  return { id, name, email };
}

function decodeCompanyHeader(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    return decodeURIComponent(raw);
  } catch {
    return '';
  }
}

function requestBasicAuth(res) {
  res.setHeader('WWW-Authenticate', 'Basic realm="CS", charset="UTF-8"');
  sendJson(res, 401, { error: '인증이 필요합니다.' });
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function setCsrfCookie(res, token, secure) {
  const secureFlag = secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${CSRF_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict${secureFlag}`);
}

function readCsrfCookie(req) {
  const token = parseCookies(req.headers.cookie || '')[CSRF_COOKIE] || '';
  return /^[A-Za-z0-9_-]{40,100}$/.test(token) ? token : '';
}

function verifyCsrf(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  const cookieToken = cookies[CSRF_COOKIE] || '';
  const headerToken = String(req.headers['x-csrf-token'] || '');
  if (!cookieToken || !headerToken || !safeEqual(cookieToken, headerToken)) {
    const error = new ValidationError('보안 토큰이 만료되었거나 올바르지 않습니다. 페이지를 새로고침해 주세요.');
    error.statusCode = 403;
    throw error;
  }
}

function verifyOrigin(req, appConfig) {
  const origin = req.headers.origin;
  if (!origin) return;
  const host = req.headers.host;
  const forwardedProto = appConfig.trustProxy
    ? String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim()
    : '';
  const protocol = forwardedProto || (req.socket.encrypted ? 'https' : 'http');
  if (origin !== `${protocol}://${host}`) {
    const error = new ValidationError('허용되지 않은 출처의 요청입니다.');
    error.statusCode = 403;
    throw error;
  }
}

function parseCookies(cookieHeader) {
  const cookies = {};
  for (const entry of cookieHeader.split(';')) {
    const separator = entry.indexOf('=');
    if (separator < 0) continue;
    cookies[entry.slice(0, separator).trim()] = entry.slice(separator + 1).trim();
  }
  return cookies;
}

function enforceRateLimit(key, limit, windowMs) {
  const now = Date.now();
  const current = rateLimits.get(key);
  if (!current || current.resetAt <= now) {
    rateLimits.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }
  current.count += 1;
  if (current.count > limit) {
    const error = new ValidationError('요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.');
    error.statusCode = 429;
    throw error;
  }
  if (rateLimits.size > 2_000) {
    for (const [entryKey, value] of rateLimits) {
      if (value.resetAt <= now) rateLimits.delete(entryKey);
    }
  }
}

function getClientIp(req, trustProxy) {
  if (trustProxy) {
    const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (forwarded) return forwarded;
  }
  return req.socket.remoteAddress || 'unknown';
}

async function readJsonBody(req, maxBodyBytes = MAX_BODY_BYTES) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBodyBytes) {
      const error = new ValidationError('요청 데이터가 너무 큽니다.');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw new ValidationError('요청 데이터 형식이 올바르지 않습니다.');
  }
}

async function serveStatic(res, requestPath, userId = '') {
  const asset = resolvePublicAsset(PUBLIC_DIR, requestPath);
  if (!asset) return sendText(res, 404, 'Not Found');

  const { filePath, contentType } = asset;
  const stat = await fs.stat(filePath);
  if (contentType.startsWith('text/html') && userId) res.setHeader('X-Workspace-Identity', String(userId));
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': stat.size,
    'Cache-Control': 'no-store'
  });
  createReadStream(filePath).pipe(res);
}

function ensureSteamConfigured() {
  if (!steamClient) {
    const error = new Error('STEAM_PUBLISHER_KEY가 설정되지 않았습니다.');
    error.statusCode = 503;
    throw error;
  }
}

function clampInteger(rawValue, minimum, maximum, fallback) {
  const parsed = Number.parseInt(rawValue ?? '', 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

async function readAuditLogs({ limit, result, query }) {
  let stat;
  try {
    stat = await fs.stat(REFUND_AUDIT_LOG_PATH);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { logs: [], count: 0, matchedCount: 0, truncated: false, invalidLines: 0 };
    }
    throw error;
  }

  const start = Math.max(0, stat.size - MAX_AUDIT_READ_BYTES);
  const byteLength = stat.size - start;
  const buffer = Buffer.alloc(byteLength);
  const handle = await fs.open(REFUND_AUDIT_LOG_PATH, 'r');
  try {
    await handle.read(buffer, 0, byteLength, start);
  } finally {
    await handle.close();
  }

  let text = buffer.toString('utf8');
  if (start > 0) {
    const firstNewline = text.indexOf('\n');
    text = firstNewline >= 0 ? text.slice(firstNewline + 1) : '';
  }

  const normalizedQuery = query.toLowerCase();
  const logs = [];
  let matchedCount = 0;
  let invalidLines = 0;
  const lines = text.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index].trim();
    if (!line) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      invalidLines += 1;
      continue;
    }
    if (result && String(record.result || '').toLowerCase() !== result) continue;
    if (normalizedQuery && !auditRecordMatches(record, normalizedQuery)) continue;
    matchedCount += 1;
    if (logs.length < limit) logs.push(sanitizeAuditRecord(record));
  }

  return {
    logs,
    count: logs.length,
    matchedCount,
    truncated: start > 0 || matchedCount > logs.length,
    invalidLines
  };
}

function auditRecordMatches(record, query) {
  return [
    record.orderId,
    record.transactionId,
    record.steamId,
    record.reason,
    record.user,
    record.userId,
    record.userName,
    record.userEmail,
    record.result,
    record.detail,
    record.requestId
  ].some((value) => String(value ?? '').toLowerCase().includes(query));
}

function sanitizeAuditRecord(record) {
  return {
    timestamp: String(record.timestamp || ''),
    sandbox: Boolean(record.sandbox),
    appId: String(record.appId || ''),
    requestId: String(record.requestId || ''),
    user: String(record.user || ''),
    userId: String(record.userId || ''),
    userName: String(record.userName || ''),
    userEmail: String(record.userEmail || ''),
    ip: String(record.ip || ''),
    orderId: String(record.orderId || ''),
    transactionId: String(record.transactionId || ''),
    steamId: String(record.steamId || ''),
    reason: String(record.reason || ''),
    result: String(record.result || ''),
    detail: String(record.detail || '')
  };
}

async function appendRefundAudit(entry) {
  const { user, ...details } = entry;
  const record = {
    timestamp: new Date().toISOString(),
    sandbox: config.useSandbox,
    appId: config.appId,
    ...details,
    ...companyUserAuditFields(user)
  };
  await appendJsonLine(REFUND_AUDIT_LOG_PATH, record);
}

async function appendRefundAuditSafe(entry) {
  try {
    await appendRefundAudit(entry);
    return true;
  } catch (error) {
    console.error(
      `[audit] refund_write_failed requestId=${entry.requestId} result=${entry.result} type=${error?.name || 'Error'}`
    );
    return false;
  }
}

async function appendJsonLine(filePath, record) {
  await fs.appendFile(filePath, `${JSON.stringify(record)}\n`, {
    encoding: 'utf8',
    mode: 0o600
  });
}

function setSecurityHeaders(res, appConfig) {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; base-uri 'none'; connect-src 'self' https://company.example.com; form-action 'self'; frame-ancestors 'none'; img-src 'self' https://company.example.com; object-src 'none'; script-src 'self' https://company.example.com; style-src 'self' https://company.example.com"
  );
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (appConfig.secureCookies) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
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

function sendText(res, statusCode, body) {
  res.writeHead(statusCode, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

async function handleError(res, error, requestId) {
  const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
  const safeMessage = error instanceof ValidationError
    || error instanceof SteamApiError
    || error?.name === 'PlayFabLogSearchError'
    || statusCode < 500
    ? error.message
    : '서버 처리 중 오류가 발생했습니다.';

  if (!res.headersSent) {
    sendJson(res, statusCode, { error: safeMessage, requestId });
  } else {
    res.destroy();
  }

  if (statusCode >= 500) {
    console.error(
      `[error] requestId=${requestId} type=${error?.name || 'Error'} message=${safeMessage}`
    );
  }
}
