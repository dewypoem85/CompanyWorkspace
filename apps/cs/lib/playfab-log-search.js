import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { companyUserAuditFields } from './company-user.js';

const DEFAULT_CONTAINER = 'logs';
const DEFAULT_PREFIX = 'data';
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const MAX_QUERY_LENGTH = 300;
const MAX_EVENT_NAME_LENGTH = 160;
const MAX_EVENT_DATA_CHARS = 50_000;
const LONG_SEARCH_HOURS_WITH_UID = 24 * 7;
const LONG_SEARCH_HOURS_WITHOUT_UID = 24;
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_JOB_CONCURRENCY = 4;
const JOB_TTL_MS = 30 * 60 * 1000;
const MAX_RETAINED_JOBS = 12;
const JOB_POLL_INTERVAL_MS = 2_000;
const SEARCH_MODES = new Set(['all', 'any', 'exact']);
const SORT_MODES = new Set(['asc', 'desc']);
const UID_COLUMN = 'EntityLineage_master_player_account';
const COLUMNS = [
  'Timestamp',
  'EventId',
  'FullName_Name',
  'FullName_Namespace',
  'Entity_Id',
  'Entity_Type',
  UID_COLUMN,
  'EntityLineage_title_player_account',
  'EventData'
];

let hyparquetPromise = null;

export function createPlayFabLogSearchApi({
  dataDir,
  storageAccount,
  container = DEFAULT_CONTAINER,
  sasToken,
  prefix = DEFAULT_PREFIX,
  liveTitleId,
  concurrency = DEFAULT_CONCURRENCY,
  jobConcurrency = DEFAULT_JOB_CONCURRENCY,
  fetchImpl = globalThis.fetch,
  parquetReader = null,
  now = () => Date.now()
}) {
  const normalizedAccount = validateStorageAccount(storageAccount);
  const normalizedContainer = validateContainer(container);
  const normalizedSas = normalizeSasToken(sasToken);
  const normalizedPrefix = normalizePrefix(prefix);
  const normalizedLiveTitleId = String(liveTitleId || '').trim();
  const safeConcurrency = clampInteger(concurrency, 1, 8, DEFAULT_CONCURRENCY);
  const safeJobConcurrency = clampInteger(jobConcurrency, 1, 8, DEFAULT_JOB_CONCURRENCY);
  const auditPath = path.join(dataDir, 'playfab-log-search-audit.jsonl');
  const storageConfigured = Boolean(normalizedAccount && normalizedContainer && normalizedSas);
  const configured = Boolean(storageConfigured && normalizedLiveTitleId);
  const jobs = new Map();
  const jobByFingerprint = new Map();
  const pendingJobIds = [];
  const runningJobIds = new Set();
  let schedulerRunning = false;

  async function handle({ path: requestPath, body, authenticatedUser, requestId, ip }) {
    if (requestPath === '/api/playfab/log-search/config') {
      return response(200, {
        configured,
        storageConfigured,
        titleConfigured: Boolean(normalizedLiveTitleId),
        titleId: normalizedLiveTitleId,
        source: 'live',
        limits: {
          maxResults: MAX_LIMIT,
          maxRangeHours: null
        },
        longSearchConfirmation: {
          withoutUidHours: LONG_SEARCH_HOURS_WITHOUT_UID,
          withUidHours: LONG_SEARCH_HOURS_WITH_UID
        },
        asynchronous: true,
        cancellable: true,
        fairQueue: false,
        parallelJobs: true,
        maxConcurrentJobs: safeJobConcurrency,
        pollIntervalMs: JOB_POLL_INTERVAL_MS
      });
    }

    if (requestPath === '/api/playfab/log-search/search') {
      ensureConfigured();
      const input = validateSearchRequest(body, now());
      const longSearch = describeLongSearch(input);
      if (longSearch.required && body?.confirmLongRange !== true) {
        return response(409, {
          error: `장기 검색 확인이 필요합니다. ${longSearch.message}`,
          confirmationRequired: true,
          rangeHours: longSearch.rangeHours,
          partitions: countHourPartitions(input.from, input.to)
        });
      }
      const ownerKey = jobOwnerKey(authenticatedUser);
      cleanupJobs();
      const fingerprint = searchFingerprint(ownerKey, input);
      const existingId = jobByFingerprint.get(fingerprint);
      const existing = existingId ? jobs.get(existingId) : null;
      if (existing && !['failed', 'cancelled'].includes(existing.status)) {
        return response(202, { job: snapshotJob(existing), reused: true });
      }

      const createdMs = now();
      const job = {
        id: crypto.randomUUID(),
        ownerKey,
        fingerprint,
        status: 'queued',
        createdMs,
        startedMs: null,
        completedMs: null,
        input,
        iterator: null,
        cancelRequested: false,
        authenticatedUser: authenticatedUser || '',
        requestId: requestId || '',
        ip: ip || '',
        progress: {
          stage: 'queued',
          partitions: countHourPartitions(input.from, input.to),
          partitionsScanned: 0,
          blobsListed: 0,
          blobsScanned: 0,
          blobsSkippedByUid: 0,
          rowsScanned: 0,
          blobErrors: 0,
          resultCount: 0
        },
        result: null,
        error: ''
      };
      jobs.set(job.id, job);
      jobByFingerprint.set(fingerprint, job.id);
      pendingJobIds.push(job.id);
      queueMicrotask(processJobQueue);
      return response(202, { job: snapshotJob(job), reused: false });
    }

    if (requestPath === '/api/playfab/log-search/status') {
      cleanupJobs();
      const jobId = String(body?.jobId || '').trim();
      if (!/^[0-9a-f-]{36}$/i.test(jobId)) throw httpError(400, '검색 작업 ID가 올바르지 않습니다.');
      const job = jobs.get(jobId);
      if (!job || job.ownerKey !== jobOwnerKey(authenticatedUser)) {
        throw httpError(404, '검색 작업을 찾을 수 없습니다. 다시 검색해 주세요.');
      }
      return response(200, { job: snapshotJob(job) });
    }

    if (requestPath === '/api/playfab/log-search/cancel') {
      cleanupJobs();
      const jobId = String(body?.jobId || '').trim();
      if (!/^[0-9a-f-]{36}$/i.test(jobId)) throw httpError(400, '검색 작업 ID가 올바르지 않습니다.');
      const job = jobs.get(jobId);
      if (!job || job.ownerKey !== jobOwnerKey(authenticatedUser)) {
        throw httpError(404, '검색 작업을 찾을 수 없습니다. 다시 검색해 주세요.');
      }
      if (['completed', 'failed', 'cancelled'].includes(job.status)) {
        return response(200, { job: snapshotJob(job) });
      }
      job.cancelRequested = true;
      job.progress = { ...job.progress, stage: 'cancelling' };
      queueMicrotask(processJobQueue);
      return response(202, { job: snapshotJob(job) });
    }

    return response(404, { error: 'PlayFab 로그 검색 API 경로를 찾을 수 없습니다.' });
  }

  async function processJobQueue() {
    if (schedulerRunning) return;
    schedulerRunning = true;
    try {
      while (pendingJobIds.length && runningJobIds.size < safeJobConcurrency) {
        const jobId = pendingJobIds.shift();
        const job = jobs.get(jobId);
        if (!job || job.status !== 'queued') continue;

        if (job.cancelRequested) {
          await finishCancelledJob(job);
          continue;
        }

        runningJobIds.add(job.id);
        void runJob(job).finally(() => {
          runningJobIds.delete(job.id);
          cleanupJobs();
          queueMicrotask(processJobQueue);
        });
      }
    } finally {
      schedulerRunning = false;
      if (pendingJobIds.length && runningJobIds.size < safeJobConcurrency) queueMicrotask(processJobQueue);
    }
  }

  async function runJob(job) {
    job.startedMs = now();
    job.status = 'running';
    job.progress = { ...job.progress, stage: 'starting' };
    job.iterator = searchLogPartitions(job);

    try {
      while (true) {
        const step = await job.iterator.next();
        if (step.done) {
          await finishCompletedJob(job, step.value);
          return;
        }
        if (job.cancelRequested) {
          await finishCancelledJob(job);
          return;
        }
        await new Promise((resolve) => setImmediate(resolve));
      }
    } catch (error) {
      if (error?.name === 'PlayFabLogSearchCancelledError') {
        await finishCancelledJob(job);
      } else {
        finishFailedJob(job, error);
      }
    }
  }

  async function* searchLogPartitions(job) {
    const { input } = job;
    const partitionPlan = createHourPartitionPlan(
      input.from,
      input.to,
      normalizedPrefix,
      normalizedLiveTitleId,
      input.sort
    );
    const results = [];
    const stats = {
      partitions: partitionPlan.count,
      partitionsScanned: 0,
      blobsListed: 0,
      blobsScanned: 0,
      blobsSkippedByUid: 0,
      rowsScanned: 0,
      blobErrors: 0
    };
    reportProgress('starting');

    while (partitionPlan.hasNext()) {
      ensureNotCancelled();
      const partition = partitionPlan.next();
      const partitionMatches = [];
      reportProgress('listing');
      await scanPartition(partition, input, stats, partitionMatches, job, results.length);
      ensureNotCancelled();

      stats.partitionsScanned += 1;
      results.push(...partitionMatches);
      reportProgress('yielding');

      // 진행 상태를 갱신하고 이벤트 루프에 제어권을 돌려준다. 다른 직원의 작업은 별도 실행 흐름에서 병렬 처리된다.
      yield job.progress;

      // 현재 시간 파티션을 모두 검사했으므로 다음 시간대는 상위 N건에 영향을 주지 않는다.
      if (results.length >= input.limit) break;
    }

    return {
      titleId: normalizedLiveTitleId,
      source: 'live',
      from: input.from.toISOString(),
      to: input.to.toISOString(),
      query: input.query,
      mode: input.mode,
      playFabId: input.playFabId,
      eventName: input.eventName,
      limit: input.limit,
      sort: input.sort,
      results: results.slice(0, input.limit),
      stats
    };

    function reportProgress(stage) {
      job.progress = {
        stage: job.cancelRequested ? 'cancelling' : stage,
        ...stats,
        resultCount: Math.min(results.length, input.limit)
      };
    }

    function ensureNotCancelled() {
      if (job.cancelRequested) throw cancelledError();
    }
  }

  async function scanPartition(partition, input, stats, partitionMatches, job, previousResultCount) {
    let marker = '';
    do {
      if (job.cancelRequested) throw cancelledError();
      const page = await listParquetBlobPage(partition, marker);
      marker = page.nextMarker;
      stats.blobsListed += page.blobs.length;
      job.progress = { ...job.progress, stage: 'scanning', ...stats };

      await forEachWithConcurrency(
        page.blobs,
        safeConcurrency,
        async (blob) => {
          const item = await searchBlob({
            blob,
            input,
            onMatch: (match) => addBoundedMatch(partitionMatches, match, input.limit, input.sort)
          });
          stats.blobsScanned += item.blobsScanned;
          stats.blobsSkippedByUid += item.blobsSkippedByUid;
          stats.rowsScanned += item.rowsScanned;
          stats.blobErrors += item.blobErrors;
          job.progress = {
            ...job.progress,
            stage: job.cancelRequested ? 'cancelling' : 'scanning',
            ...stats,
            resultCount: Math.min(previousResultCount + partitionMatches.length, input.limit)
          };
        },
        () => job.cancelRequested
      );
    } while (marker && !job.cancelRequested);

    if (job.cancelRequested) throw cancelledError();
  }

  async function finishCompletedJob(job, result) {
    job.completedMs = now();
    result.durationMs = Math.max(0, job.completedMs - job.startedMs);
    job.result = result;
    job.progress = { ...job.progress, stage: 'completed', resultCount: result.results.length };
    await appendJobAudit(job, result, 'completed');
    job.status = 'completed';
    releaseJob(job);
  }

  async function finishCancelledJob(job) {
    job.completedMs = now();
    job.progress = { ...job.progress, stage: 'cancelled' };
    job.error = '사용자가 로그 검색을 취소했습니다.';
    await appendJobAudit(job, null, 'cancelled');
    job.status = 'cancelled';
    releaseJob(job);
  }

  function finishFailedJob(job, error) {
    job.completedMs = now();
    job.status = 'failed';
    job.progress = { ...job.progress, stage: 'failed' };
    job.error = Number(error?.statusCode || 500) < 500
      ? String(error?.message || '로그 검색에 실패했습니다.')
      : '로그 검색 처리 중 오류가 발생했습니다.';
    console.error(`[playfab-log-search] job_failed id=${job.id} type=${error?.name || 'Error'} message=${redactSensitive(error?.message || '')}`);
    releaseJob(job);
  }

  async function appendJobAudit(job, result, outcome) {
    const stats = result?.stats || job.progress;
    const durationMs = Math.max(0, job.completedMs - (job.startedMs ?? job.createdMs));
    await appendAuditSafe({
      timestamp: new Date(job.completedMs).toISOString(),
      user: job.authenticatedUser,
      ip: job.ip,
      requestId: job.requestId,
      outcome,
      titleId: normalizedLiveTitleId,
      from: job.input.from.toISOString(),
      to: job.input.to.toISOString(),
      playFabId: job.input.playFabId || '',
      eventName: job.input.eventName || '',
      queryHash: sha256(job.input.query),
      mode: job.input.mode,
      sort: job.input.sort,
      resultCount: result?.results?.length || 0,
      partitionsScanned: stats.partitionsScanned || 0,
      blobsListed: stats.blobsListed || 0,
      blobsScanned: stats.blobsScanned || 0,
      blobsSkippedByUid: stats.blobsSkippedByUid || 0,
      rowsScanned: stats.rowsScanned || 0,
      durationMs
    });
  }

  function releaseJob(job) {
    job.authenticatedUser = null;
    job.iterator = null;
  }

  function snapshotJob(job) {
    const durationMs = job.startedMs === null
      ? 0
      : Math.max(0, (job.completedMs ?? now()) - job.startedMs);
    const snapshot = {
      id: job.id,
      status: job.status,
      createdAt: new Date(job.createdMs).toISOString(),
      startedAt: job.startedMs === null ? null : new Date(job.startedMs).toISOString(),
      completedAt: job.completedMs === null ? null : new Date(job.completedMs).toISOString(),
      durationMs,
      cancelRequested: job.cancelRequested,
      progress: { ...job.progress }
    };
    if (job.status === 'completed') snapshot.result = job.result;
    if (job.status === 'failed') snapshot.error = job.error;
    return snapshot;
  }

  function cleanupJobs() {
    const cutoff = now() - JOB_TTL_MS;
    for (const [jobId, job] of jobs) {
      if (!['completed', 'failed', 'cancelled'].includes(job.status) || (job.completedMs ?? job.createdMs) >= cutoff) continue;
      jobs.delete(jobId);
      if (jobByFingerprint.get(job.fingerprint) === jobId) jobByFingerprint.delete(job.fingerprint);
    }
    const finished = [...jobs.values()]
      .filter((job) => ['completed', 'failed', 'cancelled'].includes(job.status))
      .sort((left, right) => (right.completedMs ?? 0) - (left.completedMs ?? 0));
    for (const job of finished.slice(MAX_RETAINED_JOBS)) {
      jobs.delete(job.id);
      if (jobByFingerprint.get(job.fingerprint) === job.id) jobByFingerprint.delete(job.fingerprint);
    }
  }

  async function searchBlob({ blob, input, onMatch }) {
    const empty = {
      blobsScanned: 0,
      blobsSkippedByUid: 0,
      rowsScanned: 0,
      blobErrors: 0
    };

    try {
      if (input.playFabId) {
        const uidRows = await readParquet(blob, [UID_COLUMN]);
        const wanted = input.playFabId.toLowerCase();
        const containsUid = uidRows.some((row) => String(row[UID_COLUMN] || '').toLowerCase() === wanted);
        if (!containsUid) return { ...empty, blobsSkippedByUid: 1 };
      }

      const rows = await readParquet(blob, COLUMNS);
      for (const row of rows) {
        const normalized = normalizeRow(row);
        if (!normalized.timestamp) continue;
        if (normalized.timestamp < input.from.getTime() || normalized.timestamp >= input.to.getTime()) continue;
        if (input.playFabId && normalized.playFabId.toLowerCase() !== input.playFabId.toLowerCase()) continue;
        if (input.eventName && !normalized.eventName.toLowerCase().includes(input.eventName.toLowerCase())) continue;
        if (!matchesQuery(normalized.eventData, input.query, input.mode)) continue;

        const truncated = normalized.eventData.length > MAX_EVENT_DATA_CHARS;
        onMatch({
          timestamp: new Date(normalized.timestamp).toISOString(),
          titleId: normalizedLiveTitleId,
          playFabId: normalized.playFabId,
          eventName: normalized.eventName,
          namespace: normalized.namespace,
          eventId: normalized.eventId,
          entityId: normalized.entityId,
          entityType: normalized.entityType,
          snippet: createSnippet(normalized.eventData, input.query, input.mode),
          eventData: truncated ? normalized.eventData.slice(0, MAX_EVENT_DATA_CHARS) : normalized.eventData,
          eventDataTruncated: truncated,
          sourceBlob: blob.name
        });
      }

      return {
        blobsScanned: 1,
        blobsSkippedByUid: 0,
        rowsScanned: rows.length,
        blobErrors: 0
      };
    } catch (error) {
      if (isAuthorizationLikeError(error)) {
        throw httpError(
          424,
          'Azure Parquet 파일 읽기가 거부되었습니다. SAS Token의 Read(r) 권한, 만료/시작 시간, Storage 네트워크 제한을 확인해 주세요.'
        );
      }
      console.error(`[playfab-log-search] blob_failed name=${blob.name} type=${error?.name || 'Error'}`);
      return { ...empty, blobErrors: 1 };
    }
  }

  async function listParquetBlobPage(partitionPrefix, marker) {
    const url = buildListUrl({
      account: normalizedAccount,
      container: normalizedContainer,
      sasToken: normalizedSas,
      prefix: partitionPrefix,
      marker
    });
    const listResponse = await fetchImpl(url, { method: 'GET', headers: { Accept: 'application/xml' } });
    const text = await listResponse.text();
    if (!listResponse.ok) throw azureListError(listResponse.status, text);

    const parsed = parseBlobListXml(text);
    return {
      blobs: parsed.blobs.filter((blob) => blob.name.toLowerCase().endsWith('.parquet')),
      nextMarker: parsed.nextMarker
    };
  }

  async function readParquet(blob, columns) {
    const url = buildBlobUrl({
      account: normalizedAccount,
      container: normalizedContainer,
      sasToken: normalizedSas,
      blobName: blob.name
    });
    if (parquetReader) return parquetReader({ url, byteLength: blob.byteLength, columns, blob });
    return defaultParquetReader({ url, byteLength: blob.byteLength, columns });
  }

  async function appendAuditSafe(entry) {
    try {
      const { user, ...details } = entry;
      const record = { ...details, ...companyUserAuditFields(user) };
      await fs.appendFile(auditPath, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 });
      return true;
    } catch (error) {
      console.error(`[audit] playfab_log_search_write_failed requestId=${entry.requestId || '-'} type=${error?.name || 'Error'}`);
      return false;
    }
  }

  function ensureConfigured() {
    if (!storageConfigured) {
      throw httpError(503, 'Azure PlayFab 로그 Storage Account / Container / SAS Token 설정이 필요합니다.');
    }
    if (!normalizedLiveTitleId) {
      throw httpError(503, 'PLAYFAB_LIVE_TITLE_ID가 설정되지 않았습니다. 로그 검색은 라이브 Title만 조회합니다.');
    }
  }

  return { configured, storageConfigured, handle };
}

function jobOwnerKey(user) {
  if (user && typeof user === 'object') {
    return String(user.id || user.email || user.name || 'company-user');
  }
  return String(user || 'company-user');
}

function searchFingerprint(ownerKey, input) {
  return sha256(JSON.stringify({
    ownerKey,
    from: input.from.toISOString(),
    to: input.to.toISOString(),
    query: input.query,
    mode: input.mode,
    sort: input.sort,
    playFabId: input.playFabId,
    eventName: input.eventName,
    limit: input.limit
  }));
}

export function validateSearchRequest(body, nowMs = Date.now()) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw httpError(400, '검색 요청 형식이 올바르지 않습니다.');
  }

  const query = String(body.query || '').trim();
  if (!query) throw httpError(400, '로그 검색어를 입력해 주세요.');
  if (query.length > MAX_QUERY_LENGTH) throw httpError(400, `로그 검색어는 ${MAX_QUERY_LENGTH}자 이하로 입력해 주세요.`);

  const playFabId = String(body.playFabId || '').trim();
  if (playFabId && !/^[A-Za-z0-9_-]{1,64}$/.test(playFabId)) {
    throw httpError(400, 'PlayFab UID 형식이 올바르지 않습니다.');
  }

  const from = parseDate(body.from, '시작 시각');
  const to = parseDate(body.to, '종료 시각');
  if (from >= to) throw httpError(400, '종료 시각은 시작 시각보다 뒤여야 합니다.');
  if (to.getTime() > nowMs + 10 * 60 * 1000) {
    throw httpError(400, '종료 시각이 현재보다 너무 미래입니다.');
  }

  const mode = String(body.mode || 'all').trim().toLowerCase();
  if (!SEARCH_MODES.has(mode)) throw httpError(400, '검색 방식이 올바르지 않습니다.');

  const sort = String(body.sort || 'desc').trim().toLowerCase();
  if (!SORT_MODES.has(sort)) throw httpError(400, '정렬 방식이 올바르지 않습니다.');

  const eventName = String(body.eventName || '').trim();
  if (eventName.length > MAX_EVENT_NAME_LENGTH) {
    throw httpError(400, `이벤트 이름은 ${MAX_EVENT_NAME_LENGTH}자 이하로 입력해 주세요.`);
  }

  const limit = clampInteger(body.limit, 1, MAX_LIMIT, DEFAULT_LIMIT);
  return { from, to, query, mode, sort, playFabId, eventName, limit };
}

function describeLongSearch(input) {
  const rangeHours = (input.to.getTime() - input.from.getTime()) / 3_600_000;
  const warningHours = input.playFabId ? LONG_SEARCH_HOURS_WITH_UID : LONG_SEARCH_HOURS_WITHOUT_UID;
  return {
    required: rangeHours > warningHours,
    rangeHours,
    message: input.playFabId
      ? '7일을 넘는 UID 검색은 많은 Azure 파일을 확인할 수 있으며 시간 파티션 단위로 순환 실행됩니다.'
      : '24시간을 넘는 전체 본문 검색은 해당 기간의 모든 Azure 파일을 읽을 수 있으며 오래 걸릴 수 있습니다.'
  };
}

export function countHourPartitions(from, to) {
  const firstHourMs = Math.floor(from.getTime() / 3_600_000) * 3_600_000;
  return Math.max(0, Math.ceil((to.getTime() - firstHourMs) / 3_600_000));
}

export function buildHourPartitions(from, to, prefix, titleId) {
  const plan = createHourPartitionPlan(from, to, prefix, titleId, 'asc');
  const result = [];
  while (plan.hasNext()) result.push(plan.next());
  return result;
}

function createHourPartitionPlan(from, to, prefix, titleId, sort) {
  const hourMs = 3_600_000;
  const firstHourMs = Math.floor(from.getTime() / hourMs) * hourMs;
  const count = countHourPartitions(from, to);
  let index = 0;
  return {
    count,
    hasNext: () => index < count,
    next: () => {
      if (index >= count) return null;
      const offset = sort === 'desc' ? count - index - 1 : index;
      index += 1;
      const cursor = new Date(firstHourMs + offset * hourMs);
      const year = cursor.getUTCFullYear();
      const month = String(cursor.getUTCMonth() + 1).padStart(2, '0');
      const day = String(cursor.getUTCDate()).padStart(2, '0');
      const hour = String(cursor.getUTCHours()).padStart(2, '0');
      return `${normalizePrefix(prefix)}/title=${titleId}/date=${year}${month}${day}/hour=${hour}/`;
    }
  };
}

export function matchesQuery(text, query, mode = 'all') {
  const source = String(text || '').toLocaleLowerCase('ko-KR');
  const normalizedQuery = String(query || '').trim().toLocaleLowerCase('ko-KR');
  if (!normalizedQuery) return true;
  if (mode === 'exact') return source.includes(normalizedQuery);
  const terms = normalizedQuery.split(/\s+/).filter(Boolean);
  return mode === 'any'
    ? terms.some((term) => source.includes(term))
    : terms.every((term) => source.includes(term));
}

export function parseBlobListXml(xml) {
  const source = String(xml || '');
  const blobs = [];
  for (const match of source.matchAll(/<Blob>([\s\S]*?)<\/Blob>/g)) {
    const chunk = match[1];
    const name = decodeXml(extractTag(chunk, 'Name'));
    const rawLength = extractTag(chunk, 'Content-Length');
    const byteLength = Number.parseInt(rawLength || '0', 10);
    if (name) blobs.push({ name, byteLength: Number.isFinite(byteLength) ? byteLength : 0 });
  }
  return { blobs, nextMarker: decodeXml(extractTag(source, 'NextMarker')) };
}

function validateStorageAccount(value) {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  if (!/^[a-z0-9]{3,24}$/.test(normalized)) {
    throw new Error('AZURE_PLAYFAB_LOG_STORAGE_ACCOUNT 형식이 올바르지 않습니다.');
  }
  return normalized;
}

function validateContainer(value) {
  const normalized = String(value || DEFAULT_CONTAINER).trim();
  if (!/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/.test(normalized)) {
    throw new Error('AZURE_PLAYFAB_LOG_CONTAINER 형식이 올바르지 않습니다.');
  }
  return normalized;
}

function normalizeSasToken(value) {
  return String(value || '').trim().replace(/^\?/, '');
}

function normalizePrefix(value) {
  return String(value || DEFAULT_PREFIX).trim().replace(/^\/+|\/+$/g, '') || DEFAULT_PREFIX;
}

function buildListUrl({ account, container, sasToken, prefix, marker }) {
  const url = new URL(`https://${account}.blob.core.windows.net/${encodeURIComponent(container)}`);
  url.searchParams.set('restype', 'container');
  url.searchParams.set('comp', 'list');
  url.searchParams.set('prefix', prefix);
  url.searchParams.set('maxresults', '5000');
  if (marker) url.searchParams.set('marker', marker);
  appendSas(url, sasToken);
  return url.toString();
}

function buildBlobUrl({ account, container, sasToken, blobName }) {
  const encodedBlob = String(blobName).split('/').map(encodeURIComponent).join('/');
  const url = new URL(`https://${account}.blob.core.windows.net/${encodeURIComponent(container)}/${encodedBlob}`);
  appendSas(url, sasToken);
  return url.toString();
}

function appendSas(url, sasToken) {
  const params = new URLSearchParams(sasToken);
  for (const [key, value] of params) url.searchParams.append(key, value);
}

function azureListError(status, xml) {
  const code = decodeXml(extractTag(xml, 'Code')).trim();
  const rawMessage = decodeXml(extractTag(xml, 'Message')).replace(/\s+/g, ' ').trim();
  const safeMessage = redactSensitive(rawMessage).slice(0, 300);
  const detail = [code, safeMessage].filter(Boolean).join(': ');
  return httpError(
    424,
    `Azure Blob 목록 조회에 실패했습니다${detail ? `: ${detail}` : ''} (HTTP ${status}). `
      + 'SAS가 logs 컨테이너 범위인지, List(l) 권한이 있는지, 만료/시작 시간 및 Storage 네트워크 제한을 확인해 주세요.'
  );
}

function redactSensitive(value) {
  return String(value || '')
    .replace(/([?&](?:sig|skoid|sktid|skt|ske|sks|skv)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/\b(sig|token|secret)=\S+/gi, '$1=[REDACTED]');
}

function isAuthorizationLikeError(error) {
  const message = String(error?.message || '');
  const status = Number(error?.status || error?.statusCode || 0);
  return status === 401 || status === 403 || /(401|403|forbidden|authorization|authentication|permission)/i.test(message);
}

async function defaultParquetReader({ url, byteLength, columns }) {
  if (!hyparquetPromise) hyparquetPromise = import('hyparquet');
  const { asyncBufferFromUrl, parquetReadObjects } = await hyparquetPromise;
  const file = await asyncBufferFromUrl({
    url,
    byteLength: byteLength > 0 ? byteLength : undefined,
    requestInit: { cache: 'no-store' }
  });
  return parquetReadObjects({ file, columns });
}

function normalizeRow(row) {
  return {
    timestamp: normalizeTimestamp(row.Timestamp),
    eventId: String(row.EventId || ''),
    eventName: String(row.FullName_Name || ''),
    namespace: String(row.FullName_Namespace || ''),
    entityId: String(row.Entity_Id || ''),
    entityType: String(row.Entity_Type || ''),
    playFabId: String(row[UID_COLUMN] || row.Entity_Id || ''),
    eventData: normalizeEventData(row.EventData)
  };
}

function normalizeTimestamp(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'bigint' || typeof value === 'number') {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    const absolute = Math.abs(numeric);
    if (absolute >= 1e17) return Math.floor(numeric / 1e6);
    if (absolute >= 1e14) return Math.floor(numeric / 1e3);
    if (absolute >= 1e11) return Math.floor(numeric);
    return Math.floor(numeric * 1e3);
  }
  const parsed = Date.parse(String(value || ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeEventData(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (value instanceof Uint8Array) return new TextDecoder().decode(value);
  try {
    return JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item);
  } catch {
    return String(value);
  }
}

function createSnippet(text, query, mode) {
  const source = String(text || '').replace(/\s+/g, ' ').trim();
  if (!source) return '';
  const normalized = source.toLocaleLowerCase('ko-KR');
  const normalizedQuery = String(query || '').trim().toLocaleLowerCase('ko-KR');
  const terms = mode === 'exact' ? [normalizedQuery] : normalizedQuery.split(/\s+/).filter(Boolean);
  let index = -1;
  for (const term of terms) {
    const found = normalized.indexOf(term);
    if (found >= 0 && (index < 0 || found < index)) index = found;
  }
  if (index < 0) return source.slice(0, 500);
  const start = Math.max(0, index - 180);
  const end = Math.min(source.length, index + 500);
  return `${start > 0 ? '…' : ''}${source.slice(start, end)}${end < source.length ? '…' : ''}`;
}

function parseDate(value, label) {
  const date = new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) throw httpError(400, `${label}이 올바르지 않습니다.`);
  return date;
}

function extractTag(xml, tagName) {
  const escaped = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(xml || '').match(new RegExp(`<${escaped}>([\\s\\S]*?)<\\/${escaped}>`));
  return match ? match[1] : '';
}

function decodeXml(value) {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function clampInteger(value, minimum, maximum, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.name = 'PlayFabLogSearchError';
  error.statusCode = statusCode;
  return error;
}

function response(statusCode, payload) {
  return { statusCode, payload };
}

function cancelledError() {
  const error = new Error('로그 검색이 취소되었습니다.');
  error.name = 'PlayFabLogSearchCancelledError';
  return error;
}

function addBoundedMatch(matches, match, limit, sort) {
  let low = 0;
  let high = matches.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const comparison = sort === 'asc'
      ? match.timestamp.localeCompare(matches[middle].timestamp)
      : matches[middle].timestamp.localeCompare(match.timestamp);
    if (comparison < 0) high = middle;
    else low = middle + 1;
  }
  if (low >= limit && matches.length >= limit) return;
  matches.splice(low, 0, match);
  if (matches.length > limit) matches.length = limit;
}

async function forEachWithConcurrency(items, concurrency, worker, shouldStop = () => false) {
  if (!items.length) return;
  let nextIndex = 0;
  async function run() {
    while (nextIndex < items.length && !shouldStop()) {
      const index = nextIndex;
      nextIndex += 1;
      await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
}
