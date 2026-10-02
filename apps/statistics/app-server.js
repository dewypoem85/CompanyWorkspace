import http from 'node:http';
import crypto from 'node:crypto';
import { fork } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDemoOverview } from './lib/demo-data.js';
import { createAzureProcessedStore } from './lib/azure-processed-store.js';
import { BOSSES, CHARACTERS } from './lib/game-master-data.js';
import { parseOverviewProjection, projectOverview } from './lib/overview-projection.js';
import { createPlayFabAnalytics } from './lib/playfab-analytics.js';
import { createClickHouseClient } from './lib/clickhouse-client.js';
import { createClickHouseStatistics } from './lib/clickhouse-statistics.js';
import { PAGE_FILES } from './public/workspace-routes.js';
import { createRefreshBridge } from './lib/refresh-bridge.js';
import { respondToRefresh } from './lib/refresh-http.js';
import { refreshContext, respondToRefreshIntent } from './lib/refresh-request.js';
import { REFRESH_MEDIA_TYPE, REFRESH_PROTOCOL, validRefreshReceipt } from './public/refresh-contract.js';
import { publicationRevision } from './lib/publication-contract.js';
import { createEntityDetailsStore } from './lib/entity-details-store.js';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(rootDir, 'public');
const dataDir = String(process.env.STATISTICS_DATA_DIR || '').trim() || path.join(rootDir, 'data');
const host = process.env.HOST || '0.0.0.0';
const port = Number.parseInt(process.env.PORT || '3010', 10);
const clickHouseEnabled = ['1', 'true', 'yes', 'on'].includes(String(process.env.STATISTICS_CLICKHOUSE_ENABLED || '').toLowerCase());
const internalUsername = String(process.env.STATISTICS_INTERNAL_GATEWAY_USERNAME || '');
const internalPassword = String(process.env.STATISTICS_INTERNAL_GATEWAY_PASSWORD || '');
const processedStore = createAzureProcessedStore({
  storageAccount: process.env.AZURE_STATISTICS_STORAGE_ACCOUNT || process.env.AZURE_PLAYFAB_LOG_STORAGE_ACCOUNT,
  container: process.env.AZURE_STATISTICS_CONTAINER,
  sasToken: process.env.AZURE_STATISTICS_SAS_TOKEN,
  prefix: process.env.AZURE_STATISTICS_PREFIX,
  titleId: process.env.PLAYFAB_LIVE_TITLE_ID
});
const analytics = createPlayFabAnalytics({
  dataDir,
  storageAccount: process.env.AZURE_PLAYFAB_LOG_STORAGE_ACCOUNT,
  container: process.env.AZURE_PLAYFAB_LOG_CONTAINER,
  sasToken: process.env.AZURE_PLAYFAB_LOG_SAS_TOKEN,
  prefix: process.env.AZURE_PLAYFAB_LOG_PREFIX,
  liveTitleId: process.env.PLAYFAB_LIVE_TITLE_ID,
  concurrency: process.env.AZURE_PLAYFAB_LOG_CONCURRENCY,
  backfillConcurrency: process.env.AZURE_PLAYFAB_BACKFILL_CONCURRENCY,
  cacheMinutes: process.env.STATISTICS_CACHE_MINUTES,
  processedStore,
  aliases: {
    battleResult: parseAliases(process.env.STATISTICS_EVENT_BATTLE_RESULT),
    bossEncounter: parseAliases(process.env.STATISTICS_EVENT_BOSS_ENCOUNTER),
    bossKill: parseAliases(process.env.STATISTICS_EVENT_BOSS_KILL)
  }
});
const clickHouseClient = clickHouseEnabled ? createClickHouseClient() : null;
const clickHouseStatistics = clickHouseClient ? createClickHouseStatistics({ client: clickHouseClient }) : null;
const v2Cache = createResponseCache(500, 30_000);
let analyticsWorker = null;
let analyticsWorkerStopping = false;
let analyticsWorkerLastSeenAt = null;
let workerSyncState = analytics.getSyncState?.() || {};
let workerPublicationState = analytics.getPublicationState?.() || {};
let clickHouseWorkerAvailable = false;
let clickHouseWorkerPollTimer = null;
let clickHouseWorkerRequest = null;
const refreshBridge = createRefreshBridge({ getWorker: () => analyticsWorker, getPublication: () => workerPublicationState });
const entityDetailsStore = createEntityDetailsStore({ dataDir });

const files = new Map([
  ...PAGE_FILES.map(([route, value]) => [route, clickHouseEnabled ? ['dist/index.html', 'text/html; charset=utf-8'] : value]),
  ['/.well-known/assetlinks.json', ['.well-known/assetlinks.json', 'application/json; charset=utf-8']],
  ['/workspace-routes.js', ['workspace-routes.js', 'text/javascript; charset=utf-8']],
  ['/workspace-adapter.css', ['workspace-adapter.css', 'text/css; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/entity-images.css', ['entity-images.css', 'text/css; charset=utf-8']],
  ['/theme.css', ['theme.css', 'text/css; charset=utf-8']],
  ['/theme.js', ['theme.js', 'text/javascript; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/refresh.js', ['refresh.js', 'text/javascript; charset=utf-8']],
  ['/refresh-contract.js', ['refresh-contract.js', 'text/javascript; charset=utf-8']],
  ['/overview-contract.js', ['overview-contract.js', 'text/javascript; charset=utf-8']]
]);

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'GET' && url.pathname === '/health') {
      if (clickHouseEnabled) await readClickHouseWorkerState().catch(() => {});
      const database = clickHouseClient ? await clickHouseClient.ping().then(() => ({ ok: true })).catch(error => ({ ok: false, error: error.message })) : null;
      return sendJson(res, database?.ok === false ? 503 : 200, {
      ok: true,
      engine: clickHouseEnabled ? 'clickhouse' : 'legacy',
      database,
      sync: workerSyncState,
      publication: workerPublicationState,
      worker: { connected: clickHouseEnabled ? clickHouseWorkerAvailable : Boolean(analyticsWorker?.connected), lastSeenAt: analyticsWorkerLastSeenAt }
      });
    }
    if (!isAuthorizedInternalRequest(req)) return sendJson(res, 401, { error: '인증이 필요합니다.' });
    if (req.method === 'GET' && url.pathname === '/api/entity-details') {
      const snapshot = await entityDetailsStore.load();
      if (!snapshot) return sendJson(res, 404, { error: '갱신된 상세정보가 없습니다.' });
      return sendJson(res, 200, snapshot);
    }
    if (req.method === 'GET' && url.pathname === '/api/admin/entity-details/status') {
      const user = readCompanyUser(req);
      if (!user.isAdmin) return sendJson(res, 403, { error: '관리자만 상세정보 갱신 상태를 확인할 수 있습니다.' });
      return sendJson(res, 200, await entityDetailsStore.status());
    }
    if (req.method === 'POST' && url.pathname === '/api/admin/entity-details/refresh') {
      const user = readCompanyUser(req);
      if (!user.isAdmin) return sendJson(res, 403, { error: '관리자만 상세정보를 갱신할 수 있습니다.' });
      if (req.headers['x-statistics-intent'] !== 'entity-details-refresh-v1') return sendJson(res, 403, { error: '요청 출처를 확인하지 못했습니다.' });
      const input = await readJsonBody(req);
      if (!user.id || input.expectedUserId !== user.id || input.expectedRole !== user.role) {
        return sendJson(res, 403, { error: '회사 계정이나 권한이 변경되었습니다. 새로고침 후 다시 확인해 주세요.' });
      }
      const snapshot = await entityDetailsStore.refresh();
      return sendJson(res, 200, { updatedAt: snapshot.updatedAt, counts: snapshot.counts });
    }
    if (clickHouseStatistics && url.pathname.startsWith('/api/v2/statistics/')) {
      return await handleV2Statistics(req, res, url);
    }
    if (req.method === 'GET' && url.pathname === '/api/config') {
      return sendJson(res, 200, {
        mode: analytics.configured ? 'live' : 'demo',
        storageConfigured: analytics.storageConfigured,
        processedStorageConfigured: analytics.processedStorageConfigured,
        liveTitleConfigured: Boolean(analytics.titleId),
        masterData: {
          characters: CHARACTERS.map((item, id) => ({ id, name: item.name })),
          bosses: BOSSES.map(({ type, id, code, imageCode, rank, name }) => ({ type, id, code, imageCode, rank, name }))
        },
        sync: workerSyncState,
        publication: workerPublicationState,
        currentUser: readCompanyUser(req)
      });
    }
    if (req.method === 'GET' && url.pathname === '/api/analytics/publication') {
      return sendJson(res, 200, { publication: workerPublicationState });
    }
    if (req.method === 'GET' && url.pathname === '/api/analytics/refresh-context') {
      const user = readCompanyUser(req);
      if (!user.id || url.searchParams.get('expectedUserId') !== user.id) return sendJson(res, 403, { error: '회사 계정이 변경되었습니다.' });
      if (clickHouseEnabled) await readClickHouseWorkerState().catch(() => {});
      return sendJson(res, 200, refreshContext({ user, mode: analytics.configured || clickHouseEnabled ? 'live' : 'demo', titleId: analytics.titleId || '',
        publication: analytics.configured || clickHouseEnabled ? workerPublicationState : analytics.getPublicationState(),
        available: clickHouseEnabled ? clickHouseWorkerAvailable : analytics.configured ? Boolean(analyticsWorker?.connected) : true,
        pending: clickHouseEnabled ? Boolean(clickHouseWorkerRequest) : refreshBridge.pending }));
    }
    if (req.method === 'GET' && url.pathname === '/api/analytics/overview') {
      const projection = parseOverviewProjection(url.searchParams);
      const payload = analytics.configured
        ? await analytics.overview(url.searchParams, {
          dataThrough: workerPublicationState.dataThrough || workerPublicationState.completedAt,
          projection
        })
        : projectOverview(createDemoOverview({ from: url.searchParams.get('from'), to: url.searchParams.get('to') }), projection);
      payload.sync = workerSyncState;
      payload.publication = workerPublicationState;
      payload.publishedAt = workerPublicationState.completedAt || payload.publishedAt;
      return sendJson(res, 200, payload);
    }
    if (req.method === 'POST' && ['/api/analytics/refresh', '/api/admin/analytics/refresh'].includes(url.pathname)) {
      const user = readCompanyUser(req);
      if (String(req.headers.accept || '').includes(REFRESH_MEDIA_TYPE)) return await respondToRefreshIntent({ req, user,
        mode: analytics.configured || clickHouseEnabled ? 'live' : 'demo', titleId: analytics.titleId || '',
        requestRefresh: options => clickHouseEnabled ? requestClickHouseWorkerRefresh(options) : analytics.configured ? refreshBridge.request(options) : analytics.requestPublishedRefresh(options),
        respond: (status, payload, type) => sendJson(res, status, payload, type) });
      const force = ['1', 'true'].includes(String(url.searchParams.get('force') || '').toLowerCase());
      return await respondToRefresh({ user, force,
        requestRefresh: options => clickHouseEnabled ? requestClickHouseWorkerRefresh(options) : analytics.configured ? requestWorkerRefresh(options) : analytics.requestPublishedRefresh(options),
        respond: (status, payload) => sendJson(res, status, payload)
      });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: '지원하지 않는 요청입니다.' });
    if (url.pathname.startsWith('/dist/assets/')) return sendDistAsset(req, res, url.pathname);
    if (url.pathname.startsWith('/assets/entities/')) return sendEntityAsset(req, res, url.pathname);
    const target = files.get(url.pathname);
    if (!target) return sendJson(res, 404, { error: '페이지를 찾을 수 없습니다.' });
    const body = await fs.readFile(path.join(publicDir, target[0]));
    res.writeHead(200, securityHeaders({
      'Content-Type': target[1],
      'Content-Length': body.length,
      'Cache-Control': 'no-store, max-age=0, must-revalidate'
    }));
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (error) {
    const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
    if (status >= 500) console.error(`[statistics] ${error?.stack || error}`);
    if (!res.headersSent) sendJson(res, status, { error: status < 500 ? error.message : '통계 서버 처리 중 오류가 발생했습니다.' });
    else res.destroy();
  }
});

async function sendEntityAsset(req, res, pathname) {
  if (!/^\/assets\/entities\/(?:(?:weapons|skins|nodes)\/\d+\/\d+|[a-z]+\/[A-Za-z0-9_-]+)\.png$/.test(pathname)) {
    return sendJson(res, 404, { error: '이미지를 찾을 수 없습니다.' });
  }
  try {
    const relativePath = pathname.slice('/assets/entities/'.length).split('/');
    const body = await fs.readFile(path.join(publicDir, 'assets', 'entities', ...relativePath));
    res.writeHead(200, securityHeaders({
      'Content-Type': 'image/png',
      'Content-Length': body.length,
      'Cache-Control': 'public, max-age=604800, immutable'
    }));
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (error) {
    if (error?.code === 'ENOENT') return sendJson(res, 404, { error: '이미지를 찾을 수 없습니다.' });
    throw error;
  }
}

server.listen(port, host, () => {
  console.log(`[statistics] listening on ${host}:${port}`);
  if (clickHouseEnabled) startClickHouseWorkerPolling();
  else if (analytics.configured) startAnalyticsWorker();
});

process.on('SIGUSR2', () => {
  if (!analytics.configured && !clickHouseEnabled) return;
  console.log('[statistics] maintenance_refresh_requested signal=SIGUSR2');
  void (clickHouseEnabled ? requestClickHouseWorkerRefresh({ force: true }) : requestWorkerRefresh({ force: true }))
    .catch(error => console.error(`[statistics] maintenance_refresh_rejected ${error?.message || error}`));
});

function startAnalyticsWorker() {
  if (analyticsWorker || analyticsWorkerStopping) return;
  analyticsWorker = fork(path.join(rootDir, 'analytics-worker.js'), [], {
    env: process.env,
    stdio: ['ignore', 'inherit', 'inherit', 'ipc']
  });
  const worker = analyticsWorker;
  analyticsWorker.on('message', message => {
    if (refreshBridge.receive(worker, message)) return;
    if (!message || message.type !== 'state') return;
    workerSyncState = message.sync || workerSyncState;
    workerPublicationState = message.publication || workerPublicationState;
    analyticsWorkerLastSeenAt = message.sentAt || new Date().toISOString();
  });
  analyticsWorker.on('error', error => console.error(`[statistics] analytics_worker_error type=${error?.name || 'Error'} message=${error?.message || error}`));
  analyticsWorker.on('disconnect', () => refreshBridge.disconnect(worker));
  analyticsWorker.on('exit', (code, signal) => {
    console.error(`[statistics] analytics_worker_exited code=${code ?? ''} signal=${signal || ''}`);
    analyticsWorker = null;
    if (analyticsWorkerStopping) return process.exit(0);
    setTimeout(startAnalyticsWorker, 5_000).unref?.();
  });
}

function requestWorkerRefresh({ force = false, enforceCooldown = false } = {}) {
  return refreshBridge.request({ force, enforceCooldown });
}

function startClickHouseWorkerPolling() {
  const poll = async () => {
    await readClickHouseWorkerState().catch(error => console.error(`[statistics] clickhouse_worker_state_failed ${error?.message || error}`));
    clickHouseWorkerPollTimer = setTimeout(poll, 5_000);
    clickHouseWorkerPollTimer.unref?.();
  };
  void poll();
}

async function readClickHouseWorkerState() {
  try {
    const response = await fetch(workerUrl('/state'), { headers: workerHeaders(), signal: AbortSignal.timeout(5_000) });
    const payload = await response.json();
    if (!response.ok || !payload?.publication) throw new Error(payload?.error || '통계 워커 상태 응답이 올바르지 않습니다.');
    workerPublicationState = payload.publication;
    clickHouseWorkerAvailable = true;
    analyticsWorkerLastSeenAt = new Date().toISOString();
    if (clickHouseWorkerRequest?.unknown && workerPublicationState.runId === clickHouseWorkerRequest.requestId) clickHouseWorkerRequest = null;
    return workerPublicationState;
  } catch (error) {
    clickHouseWorkerAvailable = false;
    throw error;
  }
}

async function requestClickHouseWorkerRefresh({ force = false, enforceCooldown = false, requestId = crypto.randomUUID(), expectedRevision } = {}) {
  if (clickHouseWorkerRequest) throw Object.assign(new Error('갱신 요청을 접수 중입니다. 집계 상태를 확인해 주세요.'), { statusCode: 409 });
  const current = await readClickHouseWorkerState();
  const revision = expectedRevision || publicationRevision(current);
  clickHouseWorkerRequest = { requestId, unknown: false };
  let sent = false;
  try {
    sent = true;
    const response = await fetch(workerUrl('/refresh'), {
      method: 'POST', headers: { ...workerHeaders(), 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({ protocol: REFRESH_PROTOCOL, requestId, expectedRevision: revision, force, enforceCooldown })
    });
    const payload = await response.json();
    if (!response.ok) throw Object.assign(new Error(payload?.message || payload?.error || '통계 워커가 갱신 요청을 거부했습니다.'), {
      statusCode: response.status, retryAt: payload?.retryAt, known: [409, 422, 429].includes(response.status)
    });
    if (payload.protocol !== REFRESH_PROTOCOL || payload.requestId !== requestId || !validRefreshReceipt(payload.publication, requestId)) {
      throw new Error('통계 워커의 접수 응답을 확인하지 못했습니다.');
    }
    workerPublicationState = payload.publication;
    clickHouseWorkerAvailable = true;
    clickHouseWorkerRequest = null;
    return workerPublicationState;
  } catch (error) {
    if (!sent || error?.known) clickHouseWorkerRequest = null;
    else clickHouseWorkerRequest = { requestId, unknown: true };
    if (!error.statusCode) Object.assign(error, { statusCode: 503, outcome: 'unknown' });
    throw error;
  }
}

function workerHeaders() {
  const token = String(process.env.STATISTICS_WORKER_TOKEN || process.env.COMPANY_SSO_SHARED_SECRET || '');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function sendDistAsset(req, res, pathname) {
  if (!/^\/dist\/assets\/[A-Za-z0-9_.-]+\.(?:js|css|woff2?)$/.test(pathname)) return sendJson(res, 404, { error: '정적 파일을 찾을 수 없습니다.' });
  try {
    const fileName = pathname.slice('/dist/assets/'.length);
    const body = await fs.readFile(path.join(publicDir, 'dist', 'assets', fileName));
    const extension = path.extname(fileName);
    const contentType = extension === '.css' ? 'text/css; charset=utf-8' : extension === '.js' ? 'text/javascript; charset=utf-8' : 'font/woff2';
    res.writeHead(200, securityHeaders({ 'Content-Type': contentType, 'Content-Length': body.length, 'Cache-Control': 'public, max-age=31536000, immutable' }));
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (error) {
    if (error?.code === 'ENOENT') return sendJson(res, 404, { error: '정적 파일을 찾을 수 없습니다.' });
    throw error;
  }
}

function stopAnalyticsWorker() {
  if (analyticsWorkerStopping) return;
  analyticsWorkerStopping = true;
  if (analyticsWorker?.connected) {
    analyticsWorker.send({ type: 'shutdown' });
    setTimeout(() => process.exit(0), 2_000).unref?.();
  } else process.exit(0);
}

process.once('SIGTERM', stopAnalyticsWorker);
process.once('SIGINT', stopAnalyticsWorker);

function readCompanyUser(req) {
  const role = String(req.headers['x-company-user-role'] || 'employee').trim().toLowerCase();
  return {
    id: String(req.headers['x-company-user-id'] || ''),
    name: decodeHeader(req.headers['x-company-user-name']),
    email: decodeHeader(req.headers['x-company-user-email']),
    role,
    isAdmin: role === 'admin' || role === 'master'
  };
}

function isAuthorizedInternalRequest(req) {
  if (!internalUsername || !internalPassword) return process.env.NODE_ENV !== 'production';
  const expected = `Basic ${Buffer.from(`${internalUsername}:${internalPassword}`).toString('base64')}`;
  return timingSafeStringEqual(req.headers.authorization, expected);
}

function timingSafeStringEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function parseAliases(value) {
  const aliases = String(value || '').split(',').map(item => item.trim()).filter(Boolean);
  return aliases.length ? aliases : undefined;
}

function parseIntegerList(value, fallback) {
  const values = String(value || '').split(',').map(item => Number.parseInt(item.trim(), 10)).filter(item => Number.isInteger(item) && item >= 1 && item <= 90);
  return values.length ? [...new Set(values)] : fallback;
}

function decodeHeader(value) {
  try { return decodeURIComponent(String(value || '')); } catch { return ''; }
}

function sendJson(res, statusCode, payload, mediaType = 'application/json') {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, securityHeaders({
    'Content-Type': `${mediaType}; charset=utf-8`,
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  }));
  res.end(body);
}

async function readJsonBody(req) {
  if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) throw httpRequestError(415, 'JSON 요청만 지원합니다.');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 4096) throw httpRequestError(413, '요청이 너무 큽니다.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw httpRequestError(400, '요청 JSON을 해석하지 못했습니다.'); }
}

function httpRequestError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

async function handleV2Statistics(req, res, url) {
  const startedAt = performance.now();
  const route = url.pathname.slice('/api/v2/statistics'.length) || '/';
  try {
    if (req.method !== 'GET') return sendJson(res, 405, { error: '지원하지 않는 통계 요청입니다.' });
    const cacheKey = `${route}?${url.searchParams.toString()}`;
    const cached = route === '/publication' || route === '/meta' ? null : v2Cache.get(cacheKey);
    if (cached) return sendV2Json(req, res, cached.payload, cached.etag, 'HIT');
    let payload;
    if (route === '/publication') payload = { publication: await clickHouseStatistics.publication() };
    else if (route === '/meta') payload = { ...(await clickHouseStatistics.meta()), currentUser: readCompanyUser(req) };
    else if (route === '/dashboard') payload = await clickHouseStatistics.dashboard(url.searchParams);
    else if (route === '/users') payload = await clickHouseStatistics.users(url.searchParams);
    else if (route === '/results') payload = await clickHouseStatistics.results(url.searchParams);
    else if (/^\/builds\/[^/]+\/[^/]+$/.test(route)) {
      const [, , type, key] = route.split('/'); payload = await clickHouseStatistics.buildDetail(type, decodeURIComponent(key), url.searchParams);
    }
    else if (/^\/builds\/[^/]+$/.test(route)) payload = await clickHouseStatistics.builds(route.split('/')[2], url.searchParams);
    else if (route === '/bosses') payload = await clickHouseStatistics.bosses(url.searchParams);
    else if (/^\/bosses\/[^/]+$/.test(route)) payload = await clickHouseStatistics.bossDetail(decodeURIComponent(route.split('/')[2]), url.searchParams);
    else return sendJson(res, 404, { error: '통계 API 경로를 찾을 수 없습니다.' });
    const publication = payload.publication || (route === '/publication' ? payload.publication : null);
    if (!['/publication', '/meta'].includes(route) && publication?.status !== 'ready' && !publication?.completedAt) {
      return sendJson(res, 503, { error: '통계 전체 이력을 준비하고 있습니다.', maintenance: true, publication });
    }
    const etag = createEtag(payload);
    if (route !== '/publication' && route !== '/meta') v2Cache.set(cacheKey, { payload, etag });
    return sendV2Json(req, res, payload, etag, 'MISS');
  } finally {
    console.log(JSON.stringify({
      level: 'info', component: 'statistics-api', route, method: req.method,
      durationMs: Math.round((performance.now() - startedAt) * 10) / 10
    }));
  }
}

function sendV2Json(req, res, payload, etag, cacheStatus) {
  if (String(req.headers['if-none-match'] || '') === etag) {
    res.writeHead(304, securityHeaders({ ETag: etag, 'Cache-Control': 'private, max-age=30, stale-while-revalidate=300', 'X-Statistics-Cache': cacheStatus }));
    return res.end();
  }
  const body = JSON.stringify(payload);
  res.writeHead(200, securityHeaders({
    'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'private, max-age=30, stale-while-revalidate=300', ETag: etag,
    'X-Statistics-Cache': cacheStatus
  }));
  res.end(body);
}

function createEtag(payload) {
  return `"${crypto.createHash('sha256').update(JSON.stringify(payload)).digest('base64url').slice(0, 24)}"`;
}

function workerUrl(pathname) {
  const base = new URL(process.env.STATISTICS_WORKER_URL || 'http://statistics-worker:3120');
  return new URL(pathname, base).toString();
}

function createResponseCache(limit, ttlMs) {
  const values = new Map();
  return {
    get(key) {
      const entry = values.get(key);
      if (!entry || entry.expiresAt <= Date.now()) { values.delete(key); return null; }
      values.delete(key); values.set(key, entry); return entry.value;
    },
    set(key, value) {
      values.delete(key); values.set(key, { value, expiresAt: Date.now() + ttlMs });
      while (values.size > limit) values.delete(values.keys().next().value);
    },
    clear() { values.clear(); }
  };
}

function securityHeaders(extra = {}) {
  return {
    'Content-Security-Policy': "default-src 'self'; script-src 'self' https://company.example.com; style-src 'self' https://company.example.com; img-src 'self' data: https://company.example.com; connect-src 'self' https://company.example.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    ...extra
  };
}
