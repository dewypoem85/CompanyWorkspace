import http from 'node:http';
import crypto from 'node:crypto';
import { createClickHouseClient } from './lib/clickhouse-client.js';
import { createClickHouseIngestor } from './lib/clickhouse-ingest.js';
import { ensureClickHouseSchema } from './lib/clickhouse-schema.js';
import { createPlayFabAzureSource } from './lib/playfab-azure-source.js';
import { createPlayFabParquetReaderPool } from './lib/playfab-parquet-reader-pool.js';
import { createLegacyIndexSource } from './lib/legacy-index-source.js';
import { REFRESH_PROTOCOL, isRefreshId, isPublicationRevision, publicationRevision } from './lib/publication-contract.js';

const host = process.env.STATISTICS_WORKER_HOST || '0.0.0.0';
const port = parsePort(process.env.STATISTICS_WORKER_PORT || '3120');
const token = String(process.env.STATISTICS_WORKER_TOKEN || process.env.COMPANY_SSO_SHARED_SECRET || '');
const hourKst = clampInteger(process.env.STATISTICS_DAILY_REFRESH_HOUR_KST, 0, 23, 6);
const cooldownMs = 60 * 60_000;
const retryMs = 15 * 60_000;
const maxAutomaticRetries = 3;
const client = createClickHouseClient();
const azureSource = createPlayFabAzureSource();
const readerPool = createPlayFabParquetReaderPool({
  size: clampInteger(process.env.AZURE_PLAYFAB_READER_THREADS, 1, 8, 4)
});
const source = { ...azureSource, readEvents: readerPool.readEvents };
const legacySource = await createLegacyIndexSource();
const ingestor = createClickHouseIngestor({
  client, source, legacySource,
  concurrency: clampInteger(process.env.AZURE_PLAYFAB_LOG_CONCURRENCY, 1, 8, 4)
});
let activeRefresh = null;
let scheduleTimer = null;
let nextRefreshAt = null;
let automaticRetryCount = 0;

await waitForClickHouse();
await ensureClickHouseSchema(client);
scheduleNextDaily();
const initial = await ingestor.publicationState();
if (initial.status !== 'ready') void requestRefresh({ full: initial.status === 'empty' });

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname === '/health') return send(res, 200, { ok: true, clickhouse: await client.ping(), publication: await currentPublication() });
    if (!authorized(req)) return send(res, 401, { error: '통계 워커 인증이 필요합니다.' });
    if (req.method === 'GET' && url.pathname === '/state') return send(res, 200, { publication: await currentPublication() });
    if (req.method === 'POST' && url.pathname === '/refresh') {
      const input = await readJson(req);
      if (input.protocol !== REFRESH_PROTOCOL || !isRefreshId(input.requestId)
          || !isPublicationRevision(input.expectedRevision) || typeof input.force !== 'boolean'
          || typeof input.enforceCooldown !== 'boolean') {
        return send(res, 422, { protocol: REFRESH_PROTOCOL, outcome: 'invalid', message: '갱신 요청 형식이 올바르지 않습니다.' });
      }
      const full = bool(url.searchParams.get('full'));
      const force = input.force;
      const state = await currentPublication();
      if (input.expectedRevision !== publicationRevision(state)) {
        return send(res, 409, { protocol: REFRESH_PROTOCOL, outcome: 'conflict', message: '집계 상태가 변경되었습니다. 최신 상태를 확인한 뒤 다시 요청해 주세요.' });
      }
      const completedAt = Date.parse(state.completedAt || '');
      if (input.enforceCooldown && !force && Number.isFinite(completedAt) && completedAt + cooldownMs > Date.now()) {
        return send(res, 429, { protocol: REFRESH_PROTOCOL, outcome: 'invalid', message: '마지막 갱신 후 1시간이 지나야 다시 갱신할 수 있습니다.', retryAt: new Date(completedAt + cooldownMs).toISOString() });
      }
      if (activeRefresh) return send(res, 409, { protocol: REFRESH_PROTOCOL, outcome: 'conflict', message: '이미 통계를 갱신 중입니다.' });
      const startedAt = new Date().toISOString();
      void requestRefresh({ full, runId: input.requestId });
      return send(res, 202, { protocol: REFRESH_PROTOCOL, acceptance: 'accepted', requestId: input.requestId,
        publication: { ...state, runId: input.requestId, status: 'running', inProgress: true, startedAt,
          currentProfile: '집계 준비 중', error: '' } });
    }
    return send(res, 404, { error: '워커 경로를 찾을 수 없습니다.' });
  } catch (error) {
    console.error(JSON.stringify({ level: 'error', component: 'statistics-worker', message: String(error?.message || error), stack: error?.stack || '' }));
    return send(res, Number(error?.statusCode) || 500, { error: Number(error?.statusCode) < 500 ? error.message : '통계 워커 요청에 실패했습니다.' });
  }
}).listen(port, host, () => console.log(JSON.stringify({ level: 'info', component: 'statistics-worker', message: 'listening', host, port })));

function requestRefresh({ full = false, runId = crypto.randomUUID() } = {}) {
  if (activeRefresh) return activeRefresh;
  clearTimeout(scheduleTimer);
  nextRefreshAt = null;
  let failed = false;
  activeRefresh = ingestor.refresh({
    full, runId,
    onProgress: progress => console.log(JSON.stringify({ level: 'info', component: 'statistics-worker', event: 'refresh_progress', ...progress }))
  }).catch(error => {
    failed = true;
    console.error(JSON.stringify({ level: 'error', component: 'statistics-worker', event: 'refresh_failed', message: String(error?.message || error), stack: String(error?.stack || '') }));
    return ingestor.publicationState();
  }).finally(() => {
    activeRefresh = null;
    if (failed && automaticRetryCount < maxAutomaticRetries) scheduleRetry();
    else scheduleNextDaily();
  });
  return activeRefresh;
}

function scheduleNextDaily() {
  clearTimeout(scheduleTimer);
  automaticRetryCount = 0;
  const delay = nextKstHour(hourKst) - Date.now();
  nextRefreshAt = new Date(Date.now() + Math.max(1_000, delay)).toISOString();
  scheduleTimer = setTimeout(() => void requestRefresh({ full: false }), Math.max(1_000, delay));
  scheduleTimer.unref?.();
}

function scheduleRetry() {
  clearTimeout(scheduleTimer);
  automaticRetryCount += 1;
  nextRefreshAt = new Date(Date.now() + retryMs).toISOString();
  console.warn(JSON.stringify({ level: 'warn', component: 'statistics-worker', event: 'refresh_retry_scheduled', attempt: automaticRetryCount, nextAt: nextRefreshAt }));
  scheduleTimer = setTimeout(() => void requestRefresh({ full: false }), retryMs);
  scheduleTimer.unref?.();
}

async function currentPublication() {
  const state = await ingestor.publicationState();
  const completedAt = Date.parse(state.completedAt || '');
  const count = Number(state.processedBlobs || 0);
  return { ...state, status: state.status === 'empty' ? 'idle' : state.status,
    runId: state.runId || null, refreshAllowedAt: Number.isFinite(completedAt) ? new Date(completedAt + cooldownMs).toISOString() : null,
    nextAt: nextRefreshAt, totalProfiles: count, publishedProfiles: count };
}

async function readJson(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > 8192) throw Object.assign(new Error('요청이 너무 큽니다.'), { statusCode: 413 }); chunks.push(chunk); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw Object.assign(new Error('요청 JSON을 해석하지 못했습니다.'), { statusCode: 400 }); }
}

async function waitForClickHouse() {
  let lastError;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { if (await client.ping()) return; } catch (error) { lastError = error; }
    await new Promise(resolve => setTimeout(resolve, 2_000));
  }
  throw lastError || new Error('ClickHouse가 준비되지 않았습니다.');
}

function authorized(req) {
  if (!token) return process.env.NODE_ENV !== 'production';
  const provided = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const left = Buffer.from(provided), right = Buffer.from(token);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
function nextKstHour(hour) { const now = new Date(); const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now); const values = Object.fromEntries(parts.map(part => [part.type, part.value])); let target = Date.parse(`${values.year}-${values.month}-${values.day}T${String(hour).padStart(2, '0')}:00:00+09:00`); if (target <= now.getTime()) target += 86_400_000; return target; }
function parsePort(value) { const port = Number.parseInt(String(value), 10); if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('STATISTICS_WORKER_PORT가 올바르지 않습니다.'); return port; }
function clampInteger(value, min, max, fallback) { const number = Number.parseInt(String(value ?? ''), 10); return Number.isInteger(number) ? Math.max(min, Math.min(max, number)) : fallback; }
function bool(value) { return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase()); }
function send(res, status, payload) { const body = JSON.stringify(payload); res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store' }); res.end(body); }
