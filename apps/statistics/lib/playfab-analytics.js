import crypto from 'node:crypto';
import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { getCollectionMeta } from './collection-data.js';
import { getArtifactMeta, getArtifactMetaByName, getBossMeta, getCharacterMeta, getPetMeta, getSkillMeta, getSkillMetaByName, getWeaponMeta, MASTER_DATA_COUNTS } from './game-master-data.js';
import { getNodeMeta } from './node-data.js';
import { getNormalRuneOptionMeta, getRuneColorMeta, getUniqueRuneMeta, RUNE_MASTER_COUNTS } from './rune-data.js';
import { describeSinPoints } from './sin-data.js';
import { createIndexedFactStore } from './indexed-fact-store.js';
import { OVERVIEW_PROJECTION_REVISION, projectOverview, projectionCacheKey, standardOverviewProjections } from './overview-projection.js';
import { isRefreshId, isPublicationRevision, publicationRevision } from './publication-contract.js';
import { readGzipLines } from './read-gzip-lines.js';

const DEFAULT_CONTAINER = 'logs';
const DEFAULT_PREFIX = 'data';
const CURRENT_SCHEMA_VERSION = 2;
const STRUCTURED_LOG_VERSION = '0.772.0';
const MAX_RANGE_DAYS = 90;
const MAX_LISTED_BLOBS = 1_000_000;
const EVENT_CACHE_REVISION = 6;
const FACT_CACHE_REVISION = 7;
const QUERY_CACHE_REVISION = 1;
const SNAPSHOT_FORMAT_REVISION = 15;
const STALE_SNAPSHOT_MIN_REVISION = 11;
const LEGACY_SNAPSHOT_CACHE_REVISIONS = [5, 4];
const COMPATIBLE_EVENT_CACHE_REVISIONS = new Set([EVENT_CACHE_REVISION]);
// 새 통합 저장소의 최초 백필 동안에만 기존 완료본을 읽기 위해 키 규격을
// 유지한다. 새 완료본은 필터별 snapshot으로 쓰지 않는다.
const SNAPSHOT_REVISION = 1;
const TARGETED_SNAPSHOT_LIMIT = 4;
const SYNC_CHUNK_MULTIPLIER = 2;
const MANUAL_REFRESH_COOLDOWN_MS = 60 * 60_000;
const AUTOMATIC_REFRESH_RETRY_MS = 15 * 60_000;
const AUTOMATIC_REFRESH_MAX_RETRIES = 3;
const BUILD_COMBINATION_SOFT_LIMIT = 5_000;
const BOSS_COMBINATION_SOFT_LIMIT = 1_000;
const DISTRIBUTION_SAMPLE_LIMIT = 4_096;
const RONIN_CHARACTER_ID = 7;
const RONIN_SUB_WEAPON_ID = 900;
const RONIN_SUB_WEAPON_NAME = '도검';
const UID_COLUMN = 'EntityLineage_master_player_account';
const COLUMNS = ['Timestamp', 'EventId', 'FullName_Name', UID_COLUMN, 'Entity_Id', 'EventData'];
const EVENT_TYPES = ['battleResult', 'bossEncounter', 'bossKill'];
const DEFAULT_ALIASES = { battleResult: ['battle_result', 'run_end'], bossEncounter: ['boss_encounter'], bossKill: ['boss_kill'] };
const KST_DAY_FORMATTER = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' });
let hyparquetPromise;

export function createPlayFabAnalytics({
  dataDir, storageAccount, container = DEFAULT_CONTAINER, sasToken, prefix = DEFAULT_PREFIX,
  liveTitleId, concurrency = 4, backfillConcurrency = 16, cacheMinutes = 10, aliases = {},
  fetchImpl = globalThis.fetch, parquetReader = null, processedStore = null, now = () => Date.now()
}) {
  const account = validateStorageAccount(storageAccount);
  const safeContainer = validateContainer(container);
  const safeSas = normalizeSasToken(sasToken);
  const safePrefix = normalizePrefix(prefix);
  const titleId = String(liveTitleId || '').trim();
  const safeConcurrency = clampInteger(concurrency, 1, 8, 4);
  const safeBackfillConcurrency = clampInteger(backfillConcurrency, 1, 16, 16);
  const cacheMs = clampInteger(cacheMinutes, 1, 1440, 10) * 60_000;
  const eventAliases = normalizeAliases(aliases);
  const cacheDir = path.join(dataDir, `analytics-events-v${EVENT_CACHE_REVISION}`);
  const factDir = path.join(dataDir, `analytics-facts-v${FACT_CACHE_REVISION}`);
  const queryDir = path.join(dataDir, `analytics-query-v${QUERY_CACHE_REVISION}`);
  const cacheBootstrapFile = path.join(cacheDir, 'source-bootstrap.json');
  const indexedStore = createIndexedFactStore({ dataDir, now });
  const durableStore = processedStore?.configured ? processedStore : null;
  const storageConfigured = Boolean(account && safeContainer && safeSas);
  const configured = Boolean(storageConfigured && titleId);
  let requestedWindow = null;
  let requestedConcurrency = safeConcurrency;
  let syncPromise = null;
  let lastCompletedAt = 0;
  let lastCompletedWindow = null;
  const factBuilds = new Map();
  const queryBuilds = new Map();
  const snapshotBuilds = new Map();
  const syncState = {
    status: 'idle', startedAt: null, updatedAt: null, completedAt: null,
    from: null, to: null, currentDate: null, totalBlobs: 0,
    processedBlobs: 0, cachedEvents: 0, blobErrors: 0, error: '',
    persistence: durableStore ? 'azure' : 'local'
  };
  const publicationState = {
    status: 'idle', runId: null, startedAt: null, completedAt: null, nextAt: null,
    dataThrough: null, totalProfiles: 0, publishedProfiles: 0, currentProfile: '', error: ''
  };
  const publicationFile = path.join(dataDir, 'statistics-publication-state.json');
  let publicationPromise = null;
  let publicationTimer = null;
  let publisherReadyPromise = Promise.resolve();
  let publicationDays = [7, 30, 90];
  let publicationSyncDays = 2;
  let publicationHourKst = 6;
  let automaticRefreshRetryCount = 0;

  async function overview(searchParams, { dataThrough = null, projection = null } = {}) {
    ensureConfigured();
    const requestedInput = validateOverviewRequest(searchParams, now());
    const input = capOverviewInputToDataThrough(
      requestedInput,
      dataThrough || publicationState.dataThrough || publicationState.completedAt
    );
    if (!titleId) throw httpError(503, '라이브 PlayFab Title ID가 설정되지 않았습니다.');
    const dateKeys = buildDayPartitions(input.from, input.to, safePrefix, titleId).map(partitionDateKey);
    let result;
    result = await readReadySnapshot(input, { allowStale: false, projection });
    if (!result) {
      if (indexedStore.hasCoverage(dateKeys)) {
        if (indexedStore.state().rows < 100_000 && await hasQueryWindow(input)) {
          await publishSnapshot(input);
          result = await readReadySnapshot(input, { allowStale: false, projection });
        }
        else queueSnapshotBuild(input);
      }
      if (!result) throw httpError(425, '선택 조건의 통계를 백그라운드에서 계산 중입니다. 완료되면 자동으로 표시됩니다.');
    }
    result = structuredClone(result);
    result.stats.snapshot = true;
    result.stats.snapshotPending = snapshotBuilds.has(snapshotKey(input));
    result.stats.indexedStore = true;
    result.stats.queryCache = true;
    result.stats.filterFallback = false;
    result.sync = snapshotSyncState();
    result.publication = snapshotPublicationState();
    result.stats.factStore = true;
    result.stats.requestedTo = requestedInput.to.toISOString();
    result.stats.dataThrough = input.to.toISOString();
    result.stats.cacheRevision = EVENT_CACHE_REVISION;
    result.stats.indexedStoreState = indexedStore.state();
    return result;
  }

  async function readReadySnapshot(input, { allowStale = true, projection = null } = {}) {
    let result = await readSnapshot(input, projection);
    if (!result) return null;
    // 구형 snapshot 키는 기간의 길이만 포함했다. 같은 7일 요청이라는 이유로
    // 전혀 다른 날짜의 완료본을 반환하지 않도록 실제 집계 범위를 확인한다.
    if (!snapshotMatchesInputRange(result, input)) return null;
    hydrateSnapshotWeaponMeta(result);
    hydrateSnapshotNodeMeta(result);
    if (isCurrentSnapshotFormat(result)) return result;
    if (!allowStale || !canServeStaleSnapshot(result)) return null;
    if (!result.stats || typeof result.stats !== 'object') result.stats = {};
    result.stats.snapshotStale = true;
    return result;
  }

  function startWarmup(days = 7) {
    return startPublisher({ days: [clampInteger(days, 1, MAX_RANGE_DAYS, 7)] });
  }

  async function syncNow(searchParams = new URLSearchParams()) {
    const input = validateOverviewRequest(searchParams, now());
    scheduleSync(input, true);
    if (syncPromise) await syncPromise;
    assertSyncSucceeded();
    await ensureIndexedWindow(input);
    await ensureQueryWindow(input);
    await publishSnapshot(input);
    return snapshotSyncState();
  }

  function startPublisher({ hourKst = 6, days = [7, 30, 90], syncLookbackDays = 2, recoverEmptyIndex = false } = {}) {
    if (publicationTimer) return snapshotPublicationState();
    publicationDays = [...new Set(days.map(value => clampInteger(value, 1, MAX_RANGE_DAYS, 7)))].sort((left, right) => left - right);
    publicationSyncDays = clampInteger(syncLookbackDays, 1, 7, 2);
    publicationHourKst = clampInteger(hourKst, 0, 23, 6);
    publisherReadyPromise = loadPublicationState()
      .then(async () => {
        // 컨테이너 재생성 직후 통합 색인이 비어 있으면 다음 오전 6시까지
        // 구형 스냅샷을 노출하지 않고 서버 시작 작업으로 즉시 복구한다.
        if (recoverEmptyIndex && indexedStore.state().days === 0) await queuePublishedRefresh({ force: true });
      })
      .finally(scheduleNextDailyPublisher);
    return snapshotPublicationState();
  }

  async function requestPublishedRefresh(options = {}) {
    // 서버 재시작 직후 요청도 디스크에 저장된 마지막 완료 시각을 읽은 뒤
    // 1시간 제한을 판정해야 제한을 우회하는 짧은 경합 구간이 생기지 않는다.
    await publisherReadyPromise;
    void queuePublishedRefresh(options);
    return snapshotPublicationState();
  }

  function scheduleNextDailyPublisher() {
    if (publicationTimer) clearTimeout(publicationTimer);
    automaticRefreshRetryCount = 0;
    const nextAt = nextKstSchedule(now(), publicationHourKst);
    publicationState.nextAt = nextAt.toISOString();
    publicationTimer = setTimeout(() => {
      publicationTimer = null;
      void queuePublishedRefresh().finally(scheduleAfterAutomaticRefresh);
    }, Math.max(1_000, nextAt.getTime() - now()));
    publicationTimer.unref?.();
  }

  function scheduleAfterAutomaticRefresh() {
    if (publicationState.status !== 'error' || automaticRefreshRetryCount >= AUTOMATIC_REFRESH_MAX_RETRIES) {
      scheduleNextDailyPublisher();
      return;
    }
    automaticRefreshRetryCount += 1;
    const retryAt = new Date(now() + AUTOMATIC_REFRESH_RETRY_MS);
    publicationState.nextAt = retryAt.toISOString();
    console.warn(`[analytics] automatic_refresh_retry_scheduled attempt=${automaticRefreshRetryCount} next_at=${publicationState.nextAt}`);
    publicationTimer = setTimeout(() => {
      publicationTimer = null;
      void queuePublishedRefresh({ force: true }).finally(scheduleAfterAutomaticRefresh);
    }, AUTOMATIC_REFRESH_RETRY_MS);
    publicationTimer.unref?.();
  }

  function queuePublishedRefresh({ force = false, enforceCooldown = false, requestId, expectedRevision, rejectIfRunning = false } = {}) {
    if (requestId !== undefined && !isRefreshId(requestId)) throw httpError(422, '갱신 요청 번호가 올바르지 않습니다.');
    if (expectedRevision !== undefined && (!isPublicationRevision(expectedRevision) || expectedRevision !== publicationRevision(publicationState))) {
      throw httpError(409, '집계 상태가 변경되었습니다. 최신 상태를 확인한 뒤 다시 요청해 주세요.');
    }
    if (publicationPromise && rejectIfRunning) throw httpError(409, '이미 통계를 집계 중입니다. 완료 후 다시 요청해 주세요.');
    if (publicationPromise) return publicationPromise;
    const completedAt = Date.parse(publicationState.completedAt || '');
    const retryAt = Number.isFinite(completedAt) ? completedAt + MANUAL_REFRESH_COOLDOWN_MS : 0;
    if (enforceCooldown && !force && retryAt > now()) {
      const error = httpError(429, `통계는 ${new Date(retryAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} 이후 다시 갱신할 수 있습니다.`);
      error.retryAt = new Date(retryAt).toISOString();
      throw error;
    }
    publicationState.runId = requestId || crypto.randomUUID();
    publicationPromise = runPublishedRefresh().finally(() => {
      publicationPromise = null;
    });
    return publicationPromise;
  }

  async function runPublishedRefresh() {
    publicationState.status = 'running';
    publicationState.startedAt = new Date(now()).toISOString();
    publicationState.error = '';
    publicationState.currentProfile = '원본 로그 동기화';
    publicationState.totalProfiles = 0;
    publicationState.publishedProfiles = 0;
    const sourceInput = publicationInput({ days: Math.max(...publicationDays) });
    const incrementalSyncInput = publicationInput({ days: publicationSyncDays });
    try {
      if (indexedStore.state().days === 0) {
        publicationState.currentProfile = '최근 로컬 캐시 우선 복구';
        const recoveryInput = publicationInput({ days: Math.min(...publicationDays) });
        const recoveryKeys = buildDayPartitions(recoveryInput.from, recoveryInput.to, safePrefix, titleId).map(partitionDateKey);
        const localDaysReady = (await Promise.all(recoveryKeys.map(dayEventSignature))).every(Boolean);
        if (localDaysReady) {
          await ensureIndexedWindow(recoveryInput);
          console.log(`[analytics] local_recovery_completed indexed_days=${indexedStore.state().days} indexed_rows=${indexedStore.state().rows}`);
        }
      }
      const bootstrapRequired = !await isSourceBootstrapComplete();
      const syncInput = bootstrapRequired ? sourceInput : incrementalSyncInput;
      publicationState.currentProfile = bootstrapRequired ? '원본 로그 최초 전체 동기화' : '원본 로그 동기화';
      scheduleSync(syncInput, true, bootstrapRequired ? safeBackfillConcurrency : safeConcurrency);
      if (syncPromise) await syncPromise;
      assertSyncSucceeded();
      publicationState.currentProfile = '일별 통계 팩트 갱신';
      const sourceFacts = await ensureIndexedWindow(sourceInput);
      if (sourceFacts.sourceDays === 0) throw httpError(425, '통계 원본 캐시에서 집계 가능한 로그를 찾지 못했습니다.');
      if (bootstrapRequired) await markSourceBootstrapComplete(syncInput);
      publicationState.currentProfile = '빠른 조회 데이터 갱신';
      const defaultInput = publicationInput({ days: Math.min(...publicationDays), afterFirstMiddleBoss: true });
      await ensureQueryWindow(defaultInput);
      publicationState.currentProfile = '기본 7일 통계 계산';
      await publishSnapshot(defaultInput);
      publicationState.currentProfile = '';
      publicationState.status = 'ready';
      publicationState.dataThrough = sourceInput.to.toISOString();
      publicationState.completedAt = new Date(now()).toISOString();
      publicationState.currentProfile = '';
      await persistPublicationState();
      console.log(`[analytics] publication_completed indexed_days=${indexedStore.state().days} indexed_rows=${indexedStore.state().rows}`);
    } catch (error) {
      publicationState.status = 'error';
      publicationState.error = publicSyncError(error);
      publicationState.currentProfile = '';
      console.error(`[analytics] publication_failed type=${error?.name || 'Error'} message=${error?.message || error}`);
    }
    return snapshotPublicationState();
  }

  async function loadPublicationState() {
    try {
      const saved = JSON.parse(await fs.readFile(publicationFile, 'utf8'));
      if (saved?.completedAt && Number.isFinite(Date.parse(saved.completedAt))) publicationState.completedAt = saved.completedAt;
      if (saved?.dataThrough && Number.isFinite(Date.parse(saved.dataThrough))) publicationState.dataThrough = saved.dataThrough;
      else if (publicationState.completedAt) publicationState.dataThrough = publicationState.completedAt;
    } catch { /* 최초 실행에는 완료 시각 파일이 없다. */ }
  }

  async function persistPublicationState() {
    await fs.mkdir(dataDir, { recursive: true });
    const temp = `${publicationFile}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temp, JSON.stringify({ completedAt: publicationState.completedAt, dataThrough: publicationState.dataThrough }), { encoding: 'utf8', mode: 0o600 });
    await replaceFile(temp, publicationFile);
  }

  function assertSyncSucceeded() {
    if (syncState.status !== 'error') return;
    throw httpError(424, syncState.error || 'PlayFab 원본 로그 동기화에 실패했습니다.');
  }

  async function isSourceBootstrapComplete() {
    try {
      const value = JSON.parse(await fs.readFile(cacheBootstrapFile, 'utf8'));
      return Number(value?.eventCacheRevision) === EVENT_CACHE_REVISION
        && Number(value?.factCacheRevision) === FACT_CACHE_REVISION
        && Number.isFinite(Date.parse(value?.completedAt || ''));
    } catch { return false; }
  }

  async function markSourceBootstrapComplete(input) {
    await fs.mkdir(cacheDir, { recursive: true });
    const temp = `${cacheBootstrapFile}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temp, JSON.stringify({
      eventCacheRevision: EVENT_CACHE_REVISION,
      factCacheRevision: FACT_CACHE_REVISION,
      from: new Date(input.from).toISOString(),
      to: new Date(input.to).toISOString(),
      completedAt: new Date(now()).toISOString()
    }), { encoding: 'utf8', mode: 0o600 });
    await replaceFile(temp, cacheBootstrapFile);
  }

  function publicationInput(profile) {
    const normalized = normalizePublicationProfile(profile);
    const to = new Date(now());
    const from = kstPeriodStart(to, normalized.days);
    return {
      from, to, environment: 'live', profileDays: normalized.days,
      version: normalized.version, platform: normalized.platform, mode: normalized.mode,
      minModeLevel: normalized.minModeLevel, includeNodes: normalized.includeNodes,
      afterFirstMiddleBoss: normalized.afterFirstMiddleBoss
    };
  }

  function normalizePublicationProfile(profile) {
    return {
      days: clampInteger(profile?.days, 1, MAX_RANGE_DAYS, 7),
      version: String(profile?.version || '').trim(), platform: String(profile?.platform || ''), mode: String(profile?.mode || ''),
      minModeLevel: profile?.minModeLevel === null || profile?.minModeLevel === undefined ? null : clampInteger(profile.minModeLevel, 0, 999, 0),
      includeNodes: Boolean(profile?.includeNodes), afterFirstMiddleBoss: Boolean(profile?.afterFirstMiddleBoss)
    };
  }

  function scheduleSync(input, force = false, workerConcurrency = safeConcurrency) {
    const window = { from: new Date(input.from), to: new Date(input.to) };
    if (!force && syncPromise && syncState.from && coversPartitionWindow({ from: syncState.from, to: syncState.to }, window)) return;
    if (!force && !syncPromise && lastCompletedWindow && now() - lastCompletedAt < cacheMs && coversPartitionWindow(lastCompletedWindow, window)) return;
    requestedWindow = mergeWindows(requestedWindow, window);
    requestedConcurrency = Math.max(requestedConcurrency, workerConcurrency);
    if (syncPromise) return;
    syncState.status = 'queued';
    syncState.from = requestedWindow.from.toISOString();
    syncState.to = requestedWindow.to.toISOString();
    syncState.updatedAt = new Date(now()).toISOString();
    syncPromise = runSyncQueue().finally(() => { syncPromise = null; });
  }

  async function runSyncQueue() {
    while (requestedWindow) {
      const window = requestedWindow;
      const workerConcurrency = requestedConcurrency;
      requestedWindow = null;
      requestedConcurrency = safeConcurrency;
      try {
        await syncWindow(window, workerConcurrency);
        lastCompletedAt = now();
        lastCompletedWindow = mergeWindows(lastCompletedWindow, window);
        syncState.status = 'ready';
        syncState.completedAt = new Date(lastCompletedAt).toISOString();
        syncState.error = '';
      } catch (error) {
        syncState.status = 'error';
        syncState.error = publicSyncError(error);
        console.error(`[analytics] sync_failed type=${error?.name || 'Error'} message=${error?.message || error}`);
      } finally {
        syncState.currentDate = null;
        syncState.updatedAt = new Date(now()).toISOString();
      }
    }
  }

  async function syncWindow(window, workerConcurrency) {
    await fs.mkdir(cacheDir, { recursive: true });
    const partitions = buildDayPartitions(window.from, window.to, safePrefix, titleId).reverse();
    let listed = 0;
    syncState.status = 'running';
    syncState.startedAt = new Date(now()).toISOString();
    syncState.from = window.from.toISOString();
    syncState.to = window.to.toISOString();
    syncState.totalBlobs = 0;
    syncState.processedBlobs = 0;
    syncState.cachedEvents = 0;
    syncState.blobErrors = 0;
    syncState.error = '';

    for (const partition of partitions) {
      const dateKey = partitionDateKey(partition);
      syncState.currentDate = dateKey;
      syncState.updatedAt = new Date(now()).toISOString();
      const blobs = await listParquetBlobs(partition);
      listed += blobs.length;
      if (listed > MAX_LISTED_BLOBS) throw httpError(413, `통계 대상 Parquet 파일이 너무 많습니다. 기간을 줄여 주세요. (${MAX_LISTED_BLOBS}개 초과)`);
      const manifest = await readDayManifest(dateKey);
      const missing = blobs.filter(blob => manifest.processed[blob.name] !== blob.byteLength);
      syncState.totalBlobs += missing.length;
      const chunkSize = Math.max(1, workerConcurrency * SYNC_CHUNK_MULTIPLIER);
      let currentManifest = manifest;
      for (let offset = 0; offset < missing.length; offset += chunkSize) {
        const chunk = missing.slice(offset, offset + chunkSize);
        const results = await mapWithConcurrency(chunk, workerConcurrency, scanBlobForCache);
        const successful = results.filter(result => result.ok);
        const events = successful.flatMap(result => result.events);
        const eventBody = await serializeEvents(events);
        const chunkName = eventBody ? createChunkName(successful, eventBody) : '';
        const nextManifest = {
          ...currentManifest,
          revision: EVENT_CACHE_REVISION,
          date: dateKey,
          processed: { ...currentManifest.processed },
          chunks: [...new Set([...(currentManifest.chunks || []), ...(chunkName ? [chunkName] : [])])],
          updatedAt: new Date(now()).toISOString()
        };
        for (const result of successful) nextManifest.processed[result.blob.name] = result.blob.byteLength;
        if (durableStore) {
          if (eventBody) await durableStore.writeDayChunk(dateKey, chunkName, eventBody);
          await durableStore.writeDayManifest(dateKey, nextManifest);
        }
        if (eventBody) await appendDayEventBody(dateKey, eventBody);
        await writeLocalDayManifest(dateKey, nextManifest);
        currentManifest = nextManifest;
        syncState.processedBlobs += successful.length;
        syncState.cachedEvents += events.length;
        syncState.blobErrors += results.length - successful.length;
        syncState.updatedAt = new Date(now()).toISOString();
      }
    }
    if (syncState.blobErrors > 0) {
      throw httpError(424, `PlayFab 원본 로그 ${syncState.blobErrors}개를 읽지 못해 기존 완료본을 유지합니다.`);
    }
  }

  async function scanBlobForCache(blob) {
    try {
      const rows = await readParquet(blob);
      const events = [];
      for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
        const row = rows[rowIndex];
        const event = normalizeAnalyticsEvent(row, eventAliases, { sourceBlob: blob.name, rowIndex });
        if (event) events.push(compactCachedEvent(event));
        if ((rowIndex + 1) % 1_000 === 0) await yieldToEventLoop();
      }
      return { ok: true, blob, events };
    } catch (error) {
      if (isAuthorizationLikeError(error)) throw httpError(424, 'Azure Parquet 읽기가 거부되었습니다. SAS Token의 List(l)·Read(r) 권한과 만료 시간을 확인해 주세요.');
      console.error(`[analytics] blob_failed name=${blob.name} type=${error?.name || 'Error'}`);
      return { ok: false, blob, events: [] };
    }
  }

  async function listParquetBlobs(partitionPrefix) {
    const result = [];
    let marker = '';
    do {
      const url = buildListUrl({ account, container: safeContainer, sasToken: safeSas, prefix: partitionPrefix, marker });
      const response = await fetchImpl(url, { method: 'GET', headers: { Accept: 'application/xml' } });
      const text = await response.text();
      if (!response.ok) throw azureListError(response.status, text);
      const parsed = parseBlobListXml(text);
      result.push(...parsed.blobs.filter(blob => blob.name.toLowerCase().endsWith('.parquet')));
      marker = parsed.nextMarker;
    } while (marker);
    return result;
  }

  async function readParquet(blob) {
    const url = buildBlobUrl({ account, container: safeContainer, sasToken: safeSas, blobName: blob.name });
    if (parquetReader) return parquetReader({ url, byteLength: blob.byteLength, columns: COLUMNS, blob });
    if (!hyparquetPromise) hyparquetPromise = import('hyparquet');
    const { asyncBufferFromUrl, parquetReadObjects } = await hyparquetPromise;
    const file = await asyncBufferFromUrl({ url, byteLength: blob.byteLength > 0 ? blob.byteLength : undefined, requestInit: { cache: 'no-store' } });
    return parquetReadObjects({ file, columns: COLUMNS });
  }

  async function readSnapshot(input, projection = null) {
    const key = snapshotKey(input);
    const projectionKey = projectionCacheKey(projection);
    if (projectionKey) {
      const cached = await readProjectionSnapshot(input, projectionKey);
      if (cached) return cached;
    }
    const candidates = [];
    try {
      const result = JSON.parse(await fs.readFile(snapshotFile(input), 'utf8'));
      candidates.push({ result, source: 'current-local' });
    } catch { /* Azure 복제본을 확인한다. */ }
    if (durableStore && !candidates.length) {
      const result = await durableStore.readSnapshot(key);
      if (result) candidates.push({ result, source: 'durable' });
    }
    for (const revision of LEGACY_SNAPSHOT_CACHE_REVISIONS) {
      try {
        const file = path.join(dataDir, `analytics-events-v${revision}`, 'snapshots', `${key}.json`);
        candidates.push({ result: JSON.parse(await fs.readFile(file, 'utf8')), source: `legacy-v${revision}` });
      } catch { /* 해당 규격에 같은 필터 완료본이 없을 수 있다. */ }
    }
    if (!candidates.length) return null;
    candidates.sort((left, right) => snapshotCandidateScore(right.result) - snapshotCandidateScore(left.result));
    const selected = candidates[0];
    const result = projectOverview(selected.result, projection);
    if (projectionKey && selected.source === 'current-local') await writeProjectionSnapshot(input, projectionKey, result);
    return result;
  }

  function snapshotFile(input) {
    return path.join(cacheDir, 'snapshots', `${snapshotKey(input)}.json`);
  }

  function projectionSnapshotFile(input, projectionKey) {
    return path.join(cacheDir, 'snapshots', `${snapshotKey(input)}.view-${projectionKey}.json`);
  }

  async function readProjectionSnapshot(input, projectionKey) {
    const source = snapshotFile(input);
    const file = projectionSnapshotFile(input, projectionKey);
    try {
      const [sourceStat, projectionStat] = await Promise.all([fs.stat(source), fs.stat(file)]);
      if (projectionStat.mtimeMs < sourceStat.mtimeMs) return null;
      return JSON.parse(await fs.readFile(file, 'utf8'));
    } catch { return null; }
  }

  async function writeProjectionSnapshot(input, projectionKey, result) {
    const file = projectionSnapshotFile(input, projectionKey);
    const temp = `${file}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temp, JSON.stringify(result), { encoding: 'utf8', mode: 0o600 });
    await replaceFile(temp, file);
  }

  async function readDayManifest(dateKey) {
    let local = await readLocalDayManifest(dateKey);
    if (!durableStore) return local;
    const remote = normalizeDayManifest(await durableStore.readDayManifest(dateKey), dateKey);
    const localHasEvents = await hasLocalDayEvents(dateKey);

    if (!remote) {
      if (Object.keys(local.processed).length === 0) return local;
      const localEventBody = await readLocalDayEvents(dateKey);
      return bootstrapDurableDay(dateKey, local, localEventBody || '');
    }

    if (processedMapsEqual(remote.processed, local.processed) && localHasEvents) {
      await writeLocalDayManifest(dateKey, remote);
      return remote;
    }

    // 원격 manifest는 청크와 함께 먼저 저장된 뒤 로컬 파일이 갱신된다.
    // 두 manifest가 갈리면 원격을 기준으로 복원하고, 로컬에만 있던 블롭은
    // 이어지는 missing 계산에서 다시 읽는다. 대형 날짜 파일을 메모리에서
    // 병합하면 V8 문자열 한도를 넘을 수 있으므로 전체 문자열 병합은 피한다.
    await hydrateRemoteDay(dateKey, remote);
    return remote;
  }

  async function readLocalDayManifest(dateKey) {
    try {
      const value = JSON.parse(await fs.readFile(path.join(cacheDir, `${dateKey}.manifest.json`), 'utf8'));
      const manifest = normalizeDayManifest(value, dateKey);
      if (manifest) return manifest;
    } catch { /* 새 날짜는 빈 manifest에서 시작한다. */ }
    return emptyDayManifest(dateKey);
  }

  async function writeLocalDayManifest(dateKey, manifest) {
    const file = path.join(cacheDir, `${dateKey}.manifest.json`);
    const temp = `${file}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temp, JSON.stringify(manifest), { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temp, file);
  }

  async function bootstrapDurableDay(dateKey, manifest, body) {
    const chunkName = body.trim() ? `bootstrap-${crypto.createHash('sha256').update(body).digest('hex').slice(0, 32)}.ndjson` : '';
    const value = {
      revision: EVENT_CACHE_REVISION,
      date: dateKey,
      processed: { ...manifest.processed },
      chunks: chunkName ? [chunkName] : [],
      updatedAt: new Date(now()).toISOString()
    };
    if (chunkName) await durableStore.writeDayChunk(dateKey, chunkName, body);
    await durableStore.writeDayManifest(dateKey, value);
    await writeLocalDayEvents(dateKey, body);
    await writeLocalDayManifest(dateKey, value);
    return value;
  }

  async function hydrateRemoteDay(dateKey, manifest) {
    const file = path.join(cacheDir, `${dateKey}.events.ndjson`);
    const temp = `${file}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temp, '', { encoding: 'utf8', mode: 0o600 });
    try {
      for (const chunkName of manifest.chunks || []) {
        const body = await durableStore.readDayChunk(dateKey, chunkName);
        if (body === null) throw httpError(424, `Azure 통계 이벤트 청크가 없습니다: ${dateKey}/${chunkName}`);
        if (body.trim()) await fs.appendFile(temp, body.endsWith('\n') ? body : `${body}\n`, 'utf8');
      }
      await replaceFile(temp, file);
    } finally {
      await fs.rm(temp, { force: true }).catch(() => {});
    }
    await writeLocalDayManifest(dateKey, manifest);
  }

  async function hasLocalDayEvents(dateKey) {
    try { await fs.access(path.join(cacheDir, `${dateKey}.events.ndjson`)); return true; }
    catch { return false; }
  }

  async function readLocalDayEvents(dateKey) {
    try { return await fs.readFile(path.join(cacheDir, `${dateKey}.events.ndjson`), 'utf8'); } catch { return null; }
  }

  async function writeLocalDayEvents(dateKey, body) {
    const file = path.join(cacheDir, `${dateKey}.events.ndjson`);
    const temp = `${file}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temp, body, { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temp, file);
  }

  async function appendDayEventBody(dateKey, body) {
    await fs.appendFile(path.join(cacheDir, `${dateKey}.events.ndjson`), body, { encoding: 'utf8', mode: 0o600 });
  }

  async function currentFactFile(dateKey, ignoreBuild = false) {
    const signature = await dayEventSignature(dateKey);
    if (!signature) return '';
    if (!ignoreBuild && factBuilds.has(dateKey)) return null;
    try {
      const meta = JSON.parse(await fs.readFile(path.join(factDir, `${dateKey}.meta.json`), 'utf8'));
      if (meta.revision !== FACT_CACHE_REVISION || meta.sourceSignature !== signature) return null;
      const file = path.join(factDir, `${dateKey}.facts.ndjson`);
      await fs.access(file);
      return file;
    } catch { return null; }
  }

  async function isDayFactCurrent(dateKey) {
    const signature = await dayEventSignature(dateKey);
    if (!signature) return true;
    try {
      const meta = JSON.parse(await fs.readFile(path.join(factDir, `${dateKey}.meta.json`), 'utf8'));
      if (meta.revision !== FACT_CACHE_REVISION || meta.sourceSignature !== signature) return false;
      await fs.access(path.join(factDir, `${dateKey}.facts.ndjson`));
      return true;
    } catch { return false; }
  }

  async function ensureFactWindow(input) {
    await fs.mkdir(factDir, { recursive: true });
    const dateKeys = buildDayPartitions(input.from, input.to, safePrefix, titleId).map(partitionDateKey);
    await mapWithConcurrency(dateKeys, Math.min(2, safeConcurrency), ensureDayFacts);
    let sourceDays = 0;
    for (const dateKey of dateKeys) if (await currentFactFile(dateKey, true)) sourceDays += 1;
    return { dateKeys, sourceDays };
  }

  async function ensureIndexedWindow(input) {
    const factWindow = await ensureFactWindow(input);
    publicationState.currentProfile = '통합 통계 저장소 갱신';
    if (publicationState.status === 'running') {
      publicationState.totalProfiles = factWindow.dateKeys.length;
      publicationState.publishedProfiles = 0;
    }
    for (const dateKey of factWindow.dateKeys) {
      const sourceSignature = await dayEventSignature(dateKey);
      const factFile = await currentFactFile(dateKey, true);
      await indexedStore.replaceDay(dateKey, sourceSignature, factFile || '');
      if (publicationState.status === 'running') publicationState.publishedProfiles += 1;
    }
    return factWindow;
  }

  function ensureDayFacts(dateKey) {
    if (factBuilds.has(dateKey)) return factBuilds.get(dateKey);
    const task = (async () => {
      // 이벤트 캐시 규격이 바뀐 직후에도 과거 Azure 청크를 다시 Parquet에서
      // 내려받지 않고 새 로컬 캐시로 복원해 장기(30·90일) 통계를 유지한다.
      if (!(await dayEventSignature(dateKey)) && durableStore) await readDayManifest(dateKey);
      if (await isDayFactCurrent(dateKey)) return;
      const signature = await dayEventSignature(dateKey);
      if (!signature) return;
      const source = path.join(cacheDir, `${dateKey}.events.ndjson`);
      const target = path.join(factDir, `${dateKey}.facts.ndjson`);
      const temp = `${target}.${crypto.randomUUID()}.tmp`;
      let eventCount = 0;
      const batch = [];
      await fs.writeFile(temp, '', { encoding: 'utf8', mode: 0o600 });
      try {
        const lines = readline.createInterface({ input: createReadStream(source, { encoding: 'utf8' }), crlfDelay: Infinity });
        for await (const line of lines) {
          if (!line.trim()) continue;
          try {
            const fact = compactFactEvent(JSON.parse(line));
            if (!fact) continue;
            eventCount += 1;
            batch.push(JSON.stringify(fact));
            if (batch.length >= 1000) {
              await fs.appendFile(temp, `${batch.splice(0).join('\n')}\n`, 'utf8');
            }
          } catch { /* 손상된 단일 행은 건너뛴다. */ }
        }
        if (batch.length) await fs.appendFile(temp, `${batch.join('\n')}\n`, 'utf8');
        if (await dayEventSignature(dateKey) !== signature) throw new Error('통계 팩트 생성 중 원본 날짜 캐시가 변경되었습니다.');
        await replaceFile(temp, target);
        const meta = { revision: FACT_CACHE_REVISION, sourceSignature: signature, events: eventCount, updatedAt: new Date(now()).toISOString() };
        const metaFile = path.join(factDir, `${dateKey}.meta.json`);
        const metaTemp = `${metaFile}.${crypto.randomUUID()}.tmp`;
        await fs.writeFile(metaTemp, JSON.stringify(meta), { encoding: 'utf8', mode: 0o600 });
        await replaceFile(metaTemp, metaFile);
      } finally {
        await fs.rm(temp, { force: true }).catch(() => {});
      }
    })().catch(error => {
      console.error(`[analytics] fact_build_failed date=${dateKey} type=${error?.name || 'Error'} message=${error?.message || error}`);
      throw error;
    })
      .finally(() => factBuilds.delete(dateKey));
    factBuilds.set(dateKey, task);
    return task;
  }

  async function dayEventSignature(dateKey) {
    try {
      const stat = await fs.stat(path.join(cacheDir, `${dateKey}.events.ndjson`));
      return `${stat.size}:${Math.trunc(stat.mtimeMs)}`;
    } catch { return ''; }
  }

  async function aggregateIndexedWindow(input) {
    const accumulator = createAccumulator(input);
    let processed = 0;
    await indexedStore.scan(input, event => {
      accumulateEvent(accumulator, event);
      processed += 1;
      if (processed % 25_000 === 0) pruneHighCardinalityBuilds(accumulator);
      if (processed % 250_000 === 0) accumulator.seen.clear();
    });
    pruneHighCardinalityBuilds(accumulator);
    const result = finalizeAccumulator(accumulator);
    result.stats.indexedRowsScanned = processed;
    return result;
  }

  async function hasQueryWindow(input) {
    const dateKeys = buildDayPartitions(input.from, input.to, safePrefix, titleId).map(partitionDateKey);
    for (const dateKey of dateKeys) if (!await isQueryDayCurrent(dateKey)) return false;
    return true;
  }

  async function isQueryDayCurrent(dateKey) {
    const sourceSignature = await dayEventSignature(dateKey);
    if (!sourceSignature) return false;
    try {
      const meta = JSON.parse(await fs.readFile(path.join(queryDir, `${dateKey}.meta.json`), 'utf8'));
      if (meta.revision !== QUERY_CACHE_REVISION || meta.sourceSignature !== sourceSignature) return false;
      await fs.access(path.join(queryDir, `${dateKey}.facts.ndjson.gz`));
      return true;
    } catch { return false; }
  }

  async function ensureQueryWindow(input) {
    await fs.mkdir(queryDir, { recursive: true });
    const dateKeys = buildDayPartitions(input.from, input.to, safePrefix, titleId).map(partitionDateKey);
    for (const dateKey of dateKeys) await ensureQueryDay(dateKey);
  }

  function ensureQueryDay(dateKey) {
    if (queryBuilds.has(dateKey)) return queryBuilds.get(dateKey);
    const task = (async () => {
      if (await isQueryDayCurrent(dateKey)) return;
      const sourceSignature = await dayEventSignature(dateKey);
      const source = await currentFactFile(dateKey, true);
      if (!sourceSignature || !source) return;
      const target = path.join(queryDir, `${dateKey}.facts.ndjson.gz`);
      const temp = `${target}.${crypto.randomUUID()}.tmp`;
      try {
        await pipeline(createReadStream(source), createGzip({ level: 6 }), createWriteStream(temp, { mode: 0o600 }));
        if (await dayEventSignature(dateKey) !== sourceSignature) throw new Error('빠른 조회 데이터 생성 중 원본 날짜 캐시가 변경되었습니다.');
        await replaceFile(temp, target);
        const metaFile = path.join(queryDir, `${dateKey}.meta.json`);
        const metaTemp = `${metaFile}.${crypto.randomUUID()}.tmp`;
        await fs.writeFile(metaTemp, JSON.stringify({ revision: QUERY_CACHE_REVISION, sourceSignature, updatedAt: new Date(now()).toISOString() }), { encoding: 'utf8', mode: 0o600 });
        await replaceFile(metaTemp, metaFile);
      } finally {
        await fs.rm(temp, { force: true }).catch(() => {});
      }
    })().finally(() => queryBuilds.delete(dateKey));
    queryBuilds.set(dateKey, task);
    return task;
  }

  async function aggregateQueryWindow(input) {
    const accumulator = createAccumulator(input);
    let processed = 0;
    const dateKeys = buildDayPartitions(input.from, input.to, safePrefix, titleId).map(partitionDateKey);
    for (const dateKey of dateKeys) {
      // Days without source logs have no query file. A missing/corrupt query
      // file for an existing source day must fail publication, not look empty.
      if (!await dayEventSignature(dateKey)) continue;
      for await (const line of readGzipLines(path.join(queryDir, `${dateKey}.facts.ndjson.gz`))) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          if (eventMatchesInput(event, input)) accumulateEvent(accumulator, event);
          processed += 1;
          if (processed % 25_000 === 0) pruneHighCardinalityBuilds(accumulator);
          if (processed % 250_000 === 0) accumulator.seen.clear();
        } catch { /* 손상된 단일 행은 제외한다. */ }
      }
    }
    pruneHighCardinalityBuilds(accumulator);
    const result = finalizeAccumulator(accumulator);
    result.stats.indexedRowsScanned = processed;
    return result;
  }

  function queueSnapshotBuild(input) {
    const key = snapshotKey(input);
    if (snapshotBuilds.has(key) || snapshotBuilds.size >= TARGETED_SNAPSHOT_LIMIT) return;
    const snapshotInput = { ...input, from: new Date(input.from), to: new Date(input.to) };
    const task = ensureQueryWindow(snapshotInput)
      .then(() => publishSnapshot(snapshotInput))
      .catch(error => console.error(`[analytics] snapshot_build_failed key=${key} type=${error?.name || 'Error'} message=${error?.message || error}`))
      .finally(() => snapshotBuilds.delete(key));
    snapshotBuilds.set(key, task);
  }

  async function publishSnapshot(input) {
    const result = await aggregateQueryWindow(input);
    markCurrentSnapshotFormat(result, buildDayPartitions(input.from, input.to, safePrefix, titleId).length);
    result.publishedAt = publicationState.completedAt || new Date(now()).toISOString();
    await writeSnapshot(input, result);
    return result;
  }

  async function writeSnapshot(input, result) {
    const key = snapshotKey(input);
    const directory = path.join(cacheDir, 'snapshots');
    await fs.mkdir(directory, { recursive: true });
    const file = snapshotFile(input);
    const temp = `${file}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temp, JSON.stringify(result), { encoding: 'utf8', mode: 0o600 });
    await replaceFile(temp, file);
    for (const projection of standardOverviewProjections()) {
      await writeProjectionSnapshot(input, projectionCacheKey(projection), projectOverview(result, projection));
    }
    if (durableStore) await durableStore.writeSnapshot(key, result);
  }

  function ensureConfigured() {
    if (!storageConfigured) throw httpError(503, 'Azure PlayFab 로그 저장소 설정이 필요합니다.');
    if (!titleId) throw httpError(503, 'PLAYFAB_LIVE_TITLE_ID 설정이 필요합니다.');
  }

  function snapshotSyncState() {
    return { ...syncState, inProgress: ['queued', 'running'].includes(syncState.status) };
  }

  function snapshotPublicationState() {
    const completedAt = Date.parse(publicationState.completedAt || '');
    const result = {
      ...publicationState,
      refreshAllowedAt: Number.isFinite(completedAt) ? new Date(completedAt + MANUAL_REFRESH_COOLDOWN_MS).toISOString() : null,
      inProgress: publicationState.status === 'running'
    };
    if (result.inProgress && ['queued', 'running'].includes(syncState.status) && syncState.totalBlobs > 0) {
      result.totalProfiles = syncState.totalBlobs;
      result.publishedProfiles = syncState.processedBlobs;
    }
    return result;
  }

  return {
    configured, storageConfigured, processedStorageConfigured: Boolean(durableStore), titleId,
    overview, startWarmup, startPublisher, queuePublishedRefresh, requestPublishedRefresh, syncNow,
    getSyncState: snapshotSyncState, getPublicationState: snapshotPublicationState,
    close: () => indexedStore.close()
  };
}

export function validateOverviewRequest(searchParams, nowMs = Date.now()) {
  const get = name => typeof searchParams?.get === 'function' ? searchParams.get(name) : searchParams?.[name];
  const to = parseDate(get('to') || new Date(nowMs).toISOString(), '종료 시각');
  const from = parseDate(get('from') || new Date(to.getTime() - 7 * 86_400_000).toISOString(), '시작 시각');
  if (from >= to) throw httpError(400, '종료 시각은 시작 시각보다 뒤여야 합니다.');
  if ((to - from) / 86_400_000 > MAX_RANGE_DAYS + 0.01) throw httpError(400, `조회 기간은 최대 ${MAX_RANGE_DAYS}일입니다.`);
  if (to.getTime() > nowMs + 10 * 60_000) throw httpError(400, '종료 시각이 현재보다 너무 미래입니다.');
  const rawMinModeLevel = get('minModeLevel');
  const minModeLevel = rawMinModeLevel === null || rawMinModeLevel === undefined || rawMinModeLevel === '' ? null : Number(rawMinModeLevel);
  if (minModeLevel !== null && (!Number.isInteger(minModeLevel) || minModeLevel < 0 || minModeLevel > 999)) throw httpError(400, '최소 단계는 0~999 사이의 정수여야 합니다.');
  const includeNodes = ['1', 'true', 'yes'].includes(String(get('includeNodes') || '').toLowerCase());
  const afterFirstMiddleBoss = ['1', 'true', 'yes'].includes(String(get('afterFirstMiddleBoss') || '').toLowerCase());
  const version = normalizeVersionFilter(validateFilter(get('version'), '게임 버전'));
  if (version && !isSupportedVersionFilter(version)) throw httpError(400, '테스트 빌드 버전은 통계 대상이 아닙니다. 운영 버전은 숫자.숫자.숫자 또는 숫자.숫자.x 형식이어야 합니다.');
  return { from, to, environment: 'live', version, platform: validateFilter(get('platform'), '플랫폼'), mode: validateFilter(get('mode'), '게임 모드'), minModeLevel, includeNodes, afterFirstMiddleBoss };
}

export function capOverviewInputToDataThrough(input, dataThrough) {
  const cutoff = Date.parse(String(dataThrough || ''));
  if (!Number.isFinite(cutoff) || cutoff >= input.to.getTime()) return input;
  if (cutoff <= input.from.getTime()) {
    throw httpError(425, '선택한 기간은 아직 통계 집계가 완료되지 않았습니다.');
  }
  return { ...input, to: new Date(cutoff) };
}

export function normalizeAnalyticsEvent(row, aliases = normalizeAliases({}), source = {}) {
  const timestamp = normalizeTimestamp(row?.Timestamp);
  if (!Number.isFinite(timestamp)) return null;
  const rawText = normalizeEventData(row?.EventData);
  const data = parseEventData(rawText);
  const eventName = String(row?.FullName_Name || deepFind(data, ['eventname', 'eventtype']) || '');
  const type = classifyEvent(eventName, aliases);
  if (!type) return null;
  const masterPlayerId = String(row?.[UID_COLUMN] || '').trim();
  const playerId = masterPlayerId || String(row?.Entity_Id || '').trim();
  if (!playerId) return null;

  const version = stringValue(data, ['version', 'gameversion', 'clientversion']);
  const schemaVersion = integerValue(data, ['logschemaversion', 'schemaversion']);
  const runId = stringValue(data, ['runid']);
  const schemaEra = schemaVersion >= CURRENT_SCHEMA_VERSION ? (runId ? 'v2' : 'v2_incomplete') : (isVersionAtLeast(version, STRUCTURED_LOG_VERSION) ? 'v2_incomplete' : 'legacy');
  const eventId = String(row?.EventId || '').trim();
  const ingestionId = eventId || crypto.createHash('sha256').update([source.sourceBlob || '', source.rowIndex ?? '', timestamp, playerId, eventName, rawText].join('|')).digest('hex');
  const clientEventId = stringValue(data, ['clienteventid']);
  const nodeIdsValue = collectionValue(data, ['lv30nodeids']);
  const nodeNamesValue = collectionValue(data, ['lv30node']);
  const nodeNames = normalizeBuildNames(nodeNamesValue);
  // 일부 구버전 로그는 Lv30Node에 이름 대신 정수 ID를 문자열로 기록했다.
  // 전부 숫자인 경우에만 ID 배열로 승격해 캐릭터별 노드 마스터로 해석한다.
  const legacyNodeIds = nodeIdsValue === undefined && nodeNames.length > 0 && nodeNames.every(value => /^-?\d+$/.test(value))
    ? nodeNames.map(value => Number.parseInt(value, 10))
    : [];
  const collectionsValue = collectionValue(data, ['collections', 'activesynergyids']);
  const sinPointsValue = collectionValue(data, ['sinpoints']);
  const buildFields = extractBuildFields(data);
  const common = {
    id: clientEventId || ingestionId,
    ingestionId,
    clientEventId,
    sourceEventId: eventId,
    eventName,
    timestamp,
    type,
    playerId,
    accountLinked: Boolean(masterPlayerId),
    runId,
    schemaVersion,
    schemaEra,
    version,
    platform: stringValue(data, ['platform']),
    mode: stringValue(data, ['mode']),
    modeLevel: integerValue(data, ['modelevel']),
    chapter: integerValue(data, ['chapter']),
    characterId: integerValue(data, ['characterid']),
    characterName: stringValue(data, ['character']),
    characterLevel: integerValue(data, ['characterlevel']),
    skinId: identifierValue(data, ['skinid']),
    skinName: stringValue(data, ['skin', 'skinname']),
    weaponId: identifierValue(data, ['weaponid']),
    weaponName: stringValue(data, ['weapon']),
    subWeaponId: identifierValue(data, ['subweaponid']),
    subWeaponName: stringValue(data, ['subweapon']),
    petId: identifierValue(data, ['petid']),
    petName: stringValue(data, ['pet', 'petname']),
    hasNodeIds: nodeIdsValue !== undefined || legacyNodeIds.length > 0,
    nodeIds: nodeIdsValue !== undefined ? normalizeIntegerArray(nodeIdsValue) : legacyNodeIds,
    nodeNames: legacyNodeIds.length ? [] : nodeNames,
    collectionIds: normalizeIntegerArray(collectionsValue),
    hasSinPoints: sinPointsValue !== undefined,
    sinPoints: normalizeSinPoints(sinPointsValue),
    ...buildFields,
    rawPayload: data
  };

  if (type === 'battleResult') {
    const explicitResult = stringValue(data, ['resulttype']);
    const isClear = booleanValue(data, ['isclear']);
    const isDead = booleanValue(data, ['isdead']);
    const resultType = normalizeResultType(explicitResult, isClear, isDead);
    return {
      ...common,
      resultType,
      isClear: resultType === 'Clear',
      isDead: resultType === 'Dead' || isDead === true,
      playTimeMs: durationMs(data, ['playtimems'], ['playtime']),
      stage: stringValue(data, ['stage']),
      reachedFirstMiddleBoss: booleanValue(data, ['reachedfirstmiddleboss']),
    };
  }

  const bossId = stringValue(data, ['bossid']);
  const bossName = stringValue(data, ['boss', 'bossname']) || '알 수 없는 보스';
  return {
    ...common,
    encounterId: stringValue(data, ['encounterid']),
    bossId,
    bossKey: bossId ? `id:${bossId}` : `legacy-name:${slug(bossName)}`,
    bossName,
    bossRank: stringValue(data, ['bossrank']),
    fightDurationMs: type === 'bossKill' ? durationMs(data, ['fightdurationms'], ['fightduration']) : -1
  };
}

function extractBuildFields(data) {
  const skillIdsValue = collectionValue(data, ['equipskillids', 'equippedskills']);
  const skillNamesValue = collectionValue(data, ['equipskill', 'equippedskills']);
  const artifactKeysValue = collectionValue(data, ['equipartifactkeys', 'equippedartifacts']);
  const artifactNamesValue = collectionValue(data, ['equipartifact', 'equippedartifacts']);
  const equippedRunesValue = collectionValue(data, ['equippedrunes']);
  return {
    hasEquipSkillIds: skillIdsValue !== undefined,
    equipSkillIds: normalizeStructuredArray(skillIdsValue, ['skillid'], value => Number(value)).filter(value => Number.isInteger(value) && value >= 0),
    hasEquipSkillNames: skillNamesValue !== undefined,
    equipSkillNames: normalizeBuildNames(normalizeStructuredArray(skillNamesValue, ['name'], String)),
    hasEquipArtifactKeys: artifactKeysValue !== undefined,
    equipArtifactKeys: normalizeStructuredArray(artifactKeysValue, ['artifactkey'], String).map(value => value.trim()).filter(key => key && !/^\d+:-1$/.test(key)),
    hasEquipArtifactNames: artifactNamesValue !== undefined,
    equipArtifactNames: normalizeBuildNames(normalizeStructuredArray(artifactNamesValue, ['name'], String)),
    hasEquippedRunes: equippedRunesValue !== undefined,
    equippedRunes: normalizeEquippedRunes(equippedRunesValue)
  };
}

function normalizeEquippedRunes(value) {
  return normalizeArray(value).map(entry => {
    if (!entry || typeof entry !== 'object') return null;
    const rune = objectField(entry, ['rune']);
    if (!rune || typeof rune !== 'object') return null;
    const unique = objectField(rune, ['unique']);
    const option = slot => {
      const source = objectField(rune, [slot]);
      if (!source || typeof source !== 'object') return null;
      const optionId = objectInteger(source, ['optionid']);
      if (!Number.isInteger(optionId) || optionId <= 0) return null;
      return { optionId, step: objectInteger(source, ['step']) ?? 0 };
    };
    return {
      weaponId: objectInteger(entry, ['weaponid']),
      weaponSlot: objectString(entry, ['weaponslot']),
      runeSlot: objectString(entry, ['runeslot']),
      type: objectString(rune, ['type']).toLowerCase(),
      rank: objectInteger(rune, ['rank']) ?? 0,
      color: objectInteger(rune, ['color']) ?? 0,
      uniqueOptionId: objectInteger(rune, ['uniqueoptionid']) ?? objectInteger(unique, ['optionid']) ?? 0,
      uniqueKey: objectString(unique, ['uniquekey']),
      effectKey: objectString(unique, ['effectkey']),
      main: option('main'),
      sub1: option('sub1'),
      sub2: option('sub2')
    };
  }).filter(item => item && Number.isInteger(item.weaponId) && item.weaponId >= 0 && ['normal', 'unique'].includes(item.type));
}

function objectField(value, keys) {
  if (!value || typeof value !== 'object') return undefined;
  const wanted = new Set(keys.map(normalizeKey));
  for (const [key, child] of Object.entries(value)) if (wanted.has(normalizeKey(key))) return child;
  return undefined;
}
function objectString(value, keys) { const found = objectField(value, keys); return found === null || found === undefined ? '' : String(found).trim(); }
function objectInteger(value, keys) { const found = objectField(value, keys); if (found === '' || found === null || found === undefined) return null; const number = Number(found); return Number.isFinite(number) ? Math.trunc(number) : null; }

function normalizeStructuredArray(value, keys, converter) {
  return normalizeArray(value).map(item => {
    if (!item || typeof item !== 'object') return converter(item);
    const found = deepFind(item, keys);
    return found === undefined || found === null ? converter('') : converter(found);
  });
}

export function aggregateEvents(events, { from = new Date(0), to = new Date(), environment = 'live', version = '', platform = '', mode = '', minModeLevel = null, includeNodes = false, afterFirstMiddleBoss = false } = {}) {
  const input = { from, to, environment, version, platform, mode, minModeLevel, includeNodes, afterFirstMiddleBoss };
  const accumulator = createAccumulator(input);
  for (const event of events) if (eventMatchesInput(event, input)) accumulateEvent(accumulator, event);
  return finalizeAccumulator(accumulator);
}

function eventMatchesInput(event, input) {
  const fromMs = input.fromMs ?? (input.fromMs = new Date(input.from).getTime());
  const toMs = input.toMs ?? (input.toMs = new Date(input.to).getTime());
  if (!event || event.timestamp < fromMs || event.timestamp >= toMs) return false;
  if (event.version && !isProductionVersion(event.version)) return false;
  if (input.version && !versionMatchesFilter(event.version, input.version)) return false;
  if (input.platform && event.platform !== input.platform) return false;
  if (input.mode && event.mode !== input.mode) return false;
  if (input.minModeLevel !== null && (event.modeLevel === null || event.modeLevel < input.minModeLevel)) return false;
  if (input.afterFirstMiddleBoss && event.type === 'battleResult' && event.reachedFirstMiddleBoss !== true && !reachedFirstMiddleBoss(event.stage)) return false;
  return true;
}

function reachedFirstMiddleBoss(stage) {
  const value = String(stage || '').trim().toLocaleLowerCase('ko-KR').replace(/[_–—]/g, '-').replace(/\s+/g, ' ');
  if (!value) return false;
  if (/middle\s*-?\s*boss|중간\s*보스/.test(value)) return true;
  if (/(?:^|[-\s])boss$|보스$/.test(value)) return true;
  if (/독성\s*늪지|toxic\s*swamp|니플헤임|niflheim|철혈의\s*요새|fortress|붉은\s*태양의\s*사막|red\s*sun|고대\s*도시\s*그랑펠|granfel/.test(value)) return true;
  const progression = value.match(/(\d+)\s*-\s*(\d+)\s*$/);
  return Boolean(progression && Number(progression[1]) > 1);
}

function createAccumulator(input) {
  return {
    input, seen: new Set(), activePlayers: new Set(), runCount: 0,
    outcomes: { Clear: 0, Dead: 0, Fail: 0, Unknown: 0 }, clearRunKeys: new Set(),
    playTimes: [], bossEncounters: 0, bossKills: 0, days: new Map(), bosses: new Map(), versions: new Map(),
    dimensions: { platforms: new Map(), modes: new Map() },
    builds: {
      characterRuns: 0, skinRuns: 0, weaponRuns: 0, petRuns: 0, nodeRuns: 0, nodeCombinationRuns: 0, skillRuns: 0, artifactRuns: 0, sinPointRuns: 0, combinationRuns: 0,
      nodeCombinationRunsByCharacter: new Map(),
      characters: new Map(), skins: new Map(), weapons: new Map(), pets: new Map(), nodes: new Map(), nodeCombinations: new Map(), skills: new Map(), artifacts: new Map(), sinPoints: new Map(), combinations: new Map()
    },
    schema: { totalEvents: 0, v2Events: 0, legacyEvents: 0, incompleteV2Events: 0, missingRunId: 0, linkedBossKills: 0 },
    stats: { partitions: 0, blobsListed: 0, blobsScanned: 0, rowsScanned: 0, blobErrors: 0, invalidEvents: 0 }
  };
}

function accumulateEvent(acc, event) {
  if (!event || !event.id || acc.seen.has(event.id)) return;
  acc.seen.add(event.id);
  acc.activePlayers.add(event.playerId);
  acc.schema.totalEvents += 1;
  if (event.schemaEra === 'v2') acc.schema.v2Events += 1;
  else if (event.schemaEra === 'v2_incomplete') acc.schema.incompleteV2Events += 1;
  else acc.schema.legacyEvents += 1;
  if (!event.runId) acc.schema.missingRunId += 1;

  const dayKey = formatDayKey(event.timestamp);
  if (!acc.days.has(dayKey)) acc.days.set(dayKey, { players: new Set(), runs: 0, clears: 0, deaths: 0, fails: 0 });
  const day = acc.days.get(dayKey);
  day.players.add(event.playerId);
  const versionKey = event.version || '버전 미기록';
  if (!acc.versions.has(versionKey)) acc.versions.set(versionKey, { version: versionKey, players: new Set(), runs: 0, clears: 0, deaths: 0, fails: 0, playTimes: [] });
  const version = acc.versions.get(versionKey);
  version.players.add(event.playerId);

  if (event.type === 'battleResult') {
    acc.runCount += 1;
    day.runs += 1;
    version.runs += 1;
    const result = ['Clear', 'Dead', 'Fail'].includes(event.resultType) ? event.resultType : 'Unknown';
    acc.outcomes[result] += 1;
    if (result === 'Clear') {
      day.clears += 1;
      version.clears += 1;
      if (event.runId) acc.clearRunKeys.add(`${event.playerId}:${event.runId}`);
    }
    if (result === 'Dead') { day.deaths += 1; version.deaths += 1; }
    if (result === 'Fail') { day.fails += 1; version.fails += 1; }
    if (event.playTimeMs >= 0) {
      addDistributionValue(acc.playTimes, event.playTimeMs, event);
      addDistributionValue(version.playTimes, event.playTimeMs, event);
    }
    accumulateResultDimension(acc.dimensions.platforms, event.platform || '플랫폼 미기록', event, result);
    accumulateResultDimension(acc.dimensions.modes, event.mode || '모드 미기록', event, result);
    accumulateBuilds(acc, event, result === 'Clear');
    return;
  }

  const bossMeta = getBossMeta(event.bossId, event.bossName, event.bossRank);
  const bossKey = event.bossId ? event.bossKey : bossMeta ? `legacy-master:${bossMeta.code}` : event.bossKey;
  if (!acc.bosses.has(bossKey)) acc.bosses.set(bossKey, {
    id: event.bossId, masterId: bossMeta?.id ?? null, code: bossMeta?.code || '', imageCode: bossMeta?.imageCode || '',
    key: bossKey, name: event.bossName, rank: event.bossRank || bossMeta?.rank || '',
    killCount: 0, players: new Set(), encounterPlayers: new Set(), runKeys: new Set(),
    encounterIds: new Set(), killAttempts: new Set(), matchedKillAttempts: new Set(), pendingKillEvents: new Map(),
    buildTargets: createBossBuildTargets(), trustedDurations: [], legacyDurations: [], legacy: !event.bossId
  });
  const boss = acc.bosses.get(bossKey);
  const attemptKey = bossAttemptKey(event);
  if (event.type === 'bossEncounter') {
    acc.bossEncounters += 1;
    boss.encounterIds.add(attemptKey);
    boss.encounterPlayers.add(event.playerId);
    accumulateBossBuild(boss, event, 'encounter', false, acc.input.includeNodes);
    const pendingKill = boss.pendingKillEvents.get(attemptKey);
    if (pendingKill) {
      boss.matchedKillAttempts.add(attemptKey);
      markBossBuildMatched(boss, pendingKill, acc.input.includeNodes);
      boss.pendingKillEvents.delete(attemptKey);
    }
    return;
  }

  acc.bossKills += 1;
  if (event.runId) acc.schema.linkedBossKills += 1;
  boss.killCount += 1;
  boss.players.add(event.playerId);
  const firstKillForAttempt = !boss.killAttempts.has(attemptKey);
  boss.killAttempts.add(attemptKey);
  const matched = Boolean(event.encounterId && boss.encounterIds.has(attemptKey));
  if (matched) boss.matchedKillAttempts.add(attemptKey);
  if (firstKillForAttempt) {
    accumulateBossBuild(boss, event, 'kill', matched, acc.input.includeNodes);
    if (!matched && event.encounterId) boss.pendingKillEvents.set(attemptKey, event);
  }
  if (event.runId) boss.runKeys.add(`${event.playerId}:${event.runId}`);
  if (event.fightDurationMs >= 0) {
    if (event.schemaEra === 'v2' && event.runId) addDistributionValue(boss.trustedDurations, event.fightDurationMs, event);
    else addDistributionValue(boss.legacyDurations, event.fightDurationMs, event);
  }
}

function bossAttemptKey(event) {
  return event.encounterId
    ? `encounter:${event.playerId}:${event.encounterId}`
    : `event:${event.id}`;
}

function finalizeAccumulator(acc) {
  const clears = acc.outcomes.Clear;
  const deaths = acc.outcomes.Dead;
  const runs = acc.runCount;
  const bosses = [...acc.bosses.values()].map(boss => {
    let linkedClears = 0;
    for (const runKey of boss.runKeys) if (acc.clearRunKeys.has(runKey)) linkedClears += 1;
    // Azure 내보내기 행 순서는 보장되지 않는다. 조우/처치 로그가 어느 순서로
    // 들어와도 동일한 결과가 나오도록 최종 집합의 교집합으로 다시 확정한다.
    const matchedKills = [...boss.killAttempts].reduce((count, key) => count + (boss.encounterIds.has(key) ? 1 : 0), 0);
    return {
      id: boss.id, masterId: boss.masterId, code: boss.code, imageCode: boss.imageCode,
      key: boss.key, name: boss.name, rank: boss.rank,
      encounterCount: boss.encounterIds.size, encounterPlayers: boss.encounterPlayers.size,
      killCount: boss.killCount, matchedKills, encounterKillCount: matchedKills, uniquePlayers: boss.players.size,
      fightDuration: distribution(boss.trustedDurations), legacyFightDuration: distribution(boss.legacyDurations),
      durationQuality: boss.trustedDurations.length ? 'trusted' : boss.legacyDurations.length ? 'legacy_unreliable' : 'missing',
      linkedRuns: boss.runKeys.size, linkedClearRate: percent(linkedClears, boss.runKeys.size),
      encounterClearRate: boss.encounterIds.size ? percent(matchedKills, boss.encounterIds.size) : null,
      buildStats: finalizeBossBuildStats(boss),
      legacy: boss.legacy
    };
  }).sort((left, right) => right.killCount - left.killCount || left.name.localeCompare(right.name, 'ko'));
  const outcomes = [
    { key: 'Clear', label: '클리어', count: clears, rate: percent(clears, runs) },
    { key: 'Dead', label: '사망', count: deaths, rate: percent(deaths, runs) },
    { key: 'Fail', label: '실패·중단', count: acc.outcomes.Fail, rate: percent(acc.outcomes.Fail, runs) },
    { key: 'Unknown', label: '레거시 미분류', count: acc.outcomes.Unknown, rate: percent(acc.outcomes.Unknown, runs) }
  ];
  const totalEvents = acc.schema.totalEvents;
  const builds = finalizeBuilds(acc.builds);
  return {
    mode: 'live', environment: acc.input.environment, generatedAt: new Date().toISOString(),
    from: new Date(acc.input.from).toISOString(), to: new Date(acc.input.to).toISOString(), schemaCutoverVersion: STRUCTURED_LOG_VERSION,
    summary: {
      activePlayers: acc.activePlayers.size, totalRuns: runs, gameCompletions: clears,
      completionRate: percent(clears, runs), deathRate: percent(deaths, runs), bossEncounters: acc.bossEncounters, bossKills: acc.bossKills,
      playTime: distribution(acc.playTimes),
      deltas: { activePlayers: null, totalRuns: null, completionRate: null, bossKills: null }
    },
    trend: [...acc.days.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([date, value]) => ({ date: date.slice(5).replace('-', '.'), players: value.players.size, runs: value.runs, clears: value.clears, deaths: value.deaths, fails: value.fails })),
    outcomes,
    bosses,
    versions: [...acc.versions.values()].map(value => ({
      version: value.version, players: value.players.size, runs: value.runs, clears: value.clears,
      deaths: value.deaths, fails: value.fails, clearRate: percent(value.clears, value.runs),
      deathRate: percent(value.deaths, value.runs), playTime: distribution(value.playTimes)
    })).sort((left, right) => compareVersions(right.version, left.version)),
    dimensions: {
      platforms: finalizeResultDimensions(acc.dimensions.platforms),
      modes: finalizeResultDimensions(acc.dimensions.modes)
    },
    builds,
    schema: { ...acc.schema, structuredRate: percent(acc.schema.v2Events, totalEvents), bossLinkRate: percent(acc.schema.linkedBossKills, acc.bossKills) },
    stats: acc.stats
  };
}

function describeBossBuild(event, includeNodes) {
  const characterMeta = getCharacterMeta(event.characterId, event.characterName);
  const characterId = characterMeta?.id ?? (Number.isInteger(event.characterId) ? event.characterId : null);
  const characterName = event.characterName || characterMeta?.name || (characterId !== null ? `캐릭터 ${characterId}` : '캐릭터 미기록');
  const character = {
    id: characterId,
    key: characterId !== null ? `id:${characterId}` : `name:${slug(characterName)}`,
    name: characterName
  };
  const ownerKey = characterId !== null ? `character:${characterId}` : `character-name:${slug(characterName)}`;
  const skin = describeSkin(event, characterId, characterName, ownerKey);
  const weaponLoadout = describeWeaponLoadout(event, characterId, ownerKey);
  const equippedRunes = filterRunesForWeaponLoadout(weaponLoadout, describeEquippedRunes(event, characterId));
  const weaponRuneVariant = weaponLoadout
    ? createWeaponRuneVariant(weaponLoadout, event, equippedRunes)
    : null;
  const weapons = weaponLoadout?.parts || [];
  const skills = [];
  if (event.hasEquipSkillIds) {
    for (const id of event.equipSkillIds || []) {
      const meta = getSkillMeta(id);
      skills.push({ id, key: `id:${id}`, name: meta?.name || `스킬 ${id}`, known: Boolean(meta) });
    }
  } else {
    for (const name of event.equipSkillNames || []) {
      const meta = getSkillMetaByName(name);
      skills.push({ id: meta?.id ?? null, key: meta ? `id:${meta.id}` : `name:${slug(name)}`, name, known: Boolean(meta) });
    }
  }
  const artifacts = describeArtifacts(event);
  const pet = describePet(event);
  const includeCompleteNodes = includeNodes && hasCompleteNodeBuild(event);
  const nodes = includeCompleteNodes ? describeNodes(event, characterId, characterName).map(node => ({
    ...node,
    key: `${character.key}|node:${node.key}`
  })) : [];
  const uniqueWeapons = uniqueDescriptors(weapons);
  const uniqueSkills = uniqueDescriptors(skills);
  const uniqueArtifacts = uniqueDescriptors(artifacts);
  const uniqueNodes = uniqueDescriptors(nodes);
  const combinationKey = [character.key, skin?.key, ...uniqueWeapons.map(item => item.key), pet?.key, ...uniqueSkills.map(item => item.key).sort(), ...uniqueArtifacts.map(item => item.aggregateKey).sort(), ...uniqueNodes.map(item => item.key).sort()].filter(Boolean).join('|');
  const combination = {
    key: combinationKey,
    name: [character.name, skin?.name, ...uniqueWeapons.map(item => item.name), pet?.name, ...uniqueSkills.map(item => item.name), ...uniqueArtifacts.map(item => item.name), ...uniqueNodes.map(item => item.name)].filter(Boolean).join(' · '),
    character,
    skin,
    weapons: uniqueWeapons,
    pet,
    skills: uniqueSkills,
    artifacts: uniqueArtifacts,
    nodes: uniqueNodes,
    includesNodes: Boolean(includeCompleteNodes)
  };
  const sinPoints = event.hasSinPoints ? describeSinPoints(event.sinPoints, character) : [];
  return { characters: [character], skins: skin ? [skin] : [], weapons: weaponRuneVariant ? [weaponRuneVariant] : [], pets: pet ? [pet] : [], skills: uniqueSkills, artifacts: uniqueArtifacts, sinPoints, nodes: uniqueNodes, combinations: combinationKey ? [combination] : [] };
}

function describeSkin(event, characterId, characterName, ownerKey) {
  if (!hasIdentifier(event.skinId) && !event.skinName) return null;
  const id = hasIdentifier(event.skinId) ? event.skinId : null;
  const name = event.skinName || (id !== null ? `스킨 ${id}` : '스킨 미기록');
  const localKey = id !== null ? `id:${id}` : `name:${slug(name)}`;
  return { id, characterId, characterName, key: `${ownerKey}|skin:${localKey}`, name };
}

function describeNodes(event, characterId, characterName) {
  if (event.hasNodeIds) {
    const ids = event.nodeIds || [];
    // 30레벨 미만에서는 노드를 장착할 수 없다. 기존 로그는 빈 슬롯을 0으로
    // 기록하므로 첫 슬롯의 0만 실제 000 노드로 간주하고, 이후 0은 제외한다.
    // 신규 로그의 -1 빈 슬롯은 위치와 관계없이 제외한다.
    if (Number.isFinite(event.characterLevel) && event.characterLevel < 30) return [];
    return ids.map((id, index) => ({ id, index })).filter(item => item.id >= 0 && (item.id !== 0 || item.index === 0)).map(({ id, index }) => {
    const meta = getNodeMeta(characterId, id);
    return {
      id,
      key: `id:${id}`,
      name: meta?.name || event.nodeNames?.[index] || `노드 ${id}`,
      characterId,
      characterName,
      known: Boolean(meta)
    };
    });
  }
  return (event.nodeNames || []).map(name => ({
    id: null,
    key: `name:${slug(name)}`,
    name,
    characterId,
    characterName,
    known: false
  }));
}

function describeWeaponLoadout(event, characterId, ownerKey) {
  const main = describeWeaponPart(characterId, ownerKey, '주무기', event.weaponId, event.weaponName);
  if (characterId !== RONIN_CHARACTER_ID) return main ? createWeaponLoadout(characterId, ownerKey, [main]) : null;

  // 낭인은 게임 구조상 도검을 항상 보조무기로 착용한다.
  // SubWeaponId 900이 슬롯 ID처럼 기록되더라도 이름에 실제 무기가 있으면 이름을 우선해
  // 실제 무기 ID로 역매칭한다. 이름이 없는 구버전 로그만 마스터 ID 900(도검)으로 보정한다.
  const namedSub = event.subWeaponName ? getWeaponMeta(characterId, null, event.subWeaponName) : null;
  const sub = describeWeaponPart(
    characterId,
    ownerKey,
    '보조무기',
    namedSub?.id ?? (hasIdentifier(event.subWeaponId) ? event.subWeaponId : RONIN_SUB_WEAPON_ID),
    namedSub?.name || event.subWeaponName || RONIN_SUB_WEAPON_NAME,
    RONIN_SUB_WEAPON_NAME
  );
  const parts = [main, sub].filter(Boolean);
  return parts.length ? createWeaponLoadout(characterId, ownerKey, parts) : null;
}

function describeWeaponPart(characterId, ownerKey, slot, sourceId, sourceName, fallbackName = '') {
  const meta = getWeaponMeta(characterId, sourceId, sourceName || fallbackName);
  const id = meta?.id ?? sourceId;
  const name = sourceName || meta?.name || fallbackName || (hasIdentifier(id) ? `무기 ${id}` : '');
  if (!name && !hasIdentifier(id)) return null;
  const localKey = hasIdentifier(id) ? `id:${id}` : `name:${slug(name)}`;
  const slotKey = slot === '보조무기' ? 'sub' : 'main';
  return { id, characterId, key: `${ownerKey}|${slotKey}:${localKey}`, name, slot };
}

function createWeaponLoadout(characterId, ownerKey, parts) {
  const uniqueParts = uniqueDescriptors(parts);
  const key = `${ownerKey}|loadout:${uniqueParts.map(part => part.key.split('|').at(-1)).join('+')}`;
  return {
    id: uniqueParts[0]?.id ?? null,
    characterId,
    key,
    name: uniqueParts.map(part => part.name).join(' / '),
    slot: uniqueParts.length > 1 ? '주무기/보조무기' : '주무기',
    parts: uniqueParts
  };
}

function createWeaponRuneVariant(weaponLoadout, event, runes) {
  const uniqueRunes = uniqueDescriptors((runes || []).filter(rune => rune.type === 'unique')).sort(compareRuneDescriptors);
  const uniqueRuneState = !event.hasEquippedRunes ? 'unrecorded' : uniqueRunes.length ? 'equipped' : 'none';
  const uniqueRuneSignature = uniqueRuneState === 'equipped'
    ? uniqueRunes.map(rune => rune.key).join('+')
    : uniqueRuneState;
  return {
    ...weaponLoadout,
    baseKey: weaponLoadout.key,
    key: `${weaponLoadout.key}|unique-runes:${uniqueRuneSignature}`,
    uniqueRuneState,
    uniqueRunes
  };
}

export function filterRunesForWeaponLoadout(weaponLoadout, runes) {
  if (!weaponLoadout?.parts?.length) return [];
  const equippedBySlot = new Map(weaponLoadout.parts.map(part => [String(part.slot || ''), Number(part.id)]));
  return (runes || []).filter(rune => {
    const equippedWeaponId = equippedBySlot.get(String(rune.weaponSlot || ''));
    return Number.isInteger(equippedWeaponId) && equippedWeaponId === Number(rune.weaponId);
  });
}

function describeEquippedRunes(event, characterId) {
  if (!event.hasEquippedRunes) return [];
  return uniqueDescriptors((event.equippedRunes || []).map(snapshot => describeRune(snapshot, characterId)).filter(Boolean));
}

function describeRune(snapshot, characterId) {
  const weaponId = snapshot.weaponId;
  const weaponSlot = /^sub/i.test(snapshot.weaponSlot) ? '보조무기' : '주무기';
  const runeSlot = /^unique$/i.test(snapshot.runeSlot) || snapshot.type === 'unique' ? '고유룬' : '일반룬';
  if (snapshot.type === 'unique') {
    const meta = getUniqueRuneMeta(snapshot.uniqueOptionId);
    const id = snapshot.uniqueOptionId;
    if (!Number.isInteger(id) || id <= 0) return null;
    return {
      id,
      key: `weapon:${weaponId}|unique:${id}`,
      type: 'unique',
      name: meta?.name || `고유룬 ${id}`,
      characterId,
      weaponId,
      weaponSlot,
      runeSlot,
      rank: snapshot.rank,
      color: snapshot.color,
      colorName: '고유룬',
      colorKey: 'unique',
      uniqueKey: meta?.uniqueKey || snapshot.uniqueKey || '',
      effectKey: meta?.effectKey || snapshot.effectKey || '',
      effectDescription: meta?.effectDescription || '',
      known: Boolean(meta),
      options: []
    };
  }

  const color = getRuneColorMeta(snapshot.color);
  const options = [snapshot.main, snapshot.sub1, snapshot.sub2].filter(Boolean).map((option, index) => {
    const meta = getNormalRuneOptionMeta(option.optionId);
    return {
      optionId: option.optionId,
      step: option.step,
      slot: index === 0 ? '주 옵션' : `보조 옵션 ${index}`,
      name: meta?.name || `옵션 ${option.optionId}`,
      category: meta?.category || '',
      known: Boolean(meta)
    };
  });
  if (!options.length) return null;
  const optionKey = options.map(option => `${option.optionId}:${option.step}`).join('+');
  return {
    id: null,
    key: `weapon:${weaponId}|normal:${snapshot.rank}:${snapshot.color}:${optionKey}`,
    type: 'normal',
    name: `${color.name} ${snapshot.rank || '?'}등급 · ${options[0].name}`,
    characterId,
    weaponId,
    weaponSlot,
    runeSlot,
    rank: snapshot.rank,
    color: color.id,
    colorName: color.name,
    colorKey: color.key,
    effectDescription: options.map(option => option.name).join(' · '),
    known: options.every(option => option.known),
    options
  };
}

function describePet(event) {
  const numericId = Number(event.petId);
  if (Number.isInteger(numericId) && numericId < 0) return null;
  const meta = getPetMeta(event.petId);
  if (meta) return { id: meta.id, key: `id:${meta.id}`, name: meta.name, known: true };
  if (hasIdentifier(event.petId)) return { id: event.petId, key: `id:${event.petId}`, name: event.petName || `펫 ${event.petId}`, known: false };
  return event.petName ? { id: null, key: `name:${slug(event.petName)}`, name: event.petName, known: false } : null;
}

function describeArtifacts(event) {
  if (!event.hasEquipArtifactKeys) return (event.equipArtifactNames || []).map(name => {
    const meta = getArtifactMetaByName(name);
    const aggregateKey = meta ? `id:${meta.key}` : `name:${slug(name)}`;
    return { key: meta?.key || aggregateKey, aggregateKey, sourceKey: meta?.key || '', name, rank: meta?.rank || '구버전 이름', cursed: meta?.cursed || false, known: Boolean(meta) };
  });

  const keys = event.equipArtifactKeys || [];
  const oneBasedTypes = keys.some(key => /^2:/.test(key)) || (!keys.some(key => /^0:/.test(key)) && event.schemaEra === 'v2');
  return keys.map((logKey, index) => {
    const logName = event.equipArtifactNames?.[index] || '';
    const namedMeta = getArtifactMetaByName(logName);
    const normalizedKey = oneBasedTypes ? shiftArtifactType(logKey) : logKey;
    const meta = namedMeta || getArtifactMeta(normalizedKey) || getArtifactMeta(logKey);
    const sourceKey = meta?.key || normalizedKey;
    const name = meta?.name || logName || `이름 미정 유물 ${sourceKey}`;
    return {
      key: sourceKey,
      aggregateKey: `id:${sourceKey}`,
      sourceKey,
      logKey: logKey === sourceKey ? undefined : logKey,
      name,
      rank: meta?.rank || (logName ? '로그 이름' : '미등록'),
      cursed: meta?.cursed || false,
      known: Boolean(meta?.name || logName)
    };
  });
}

function shiftArtifactType(key) {
  const match = String(key || '').match(/^(\d+):(\-?\d+)$/);
  if (!match) return String(key || '');
  const type = Number(match[1]);
  return type > 0 ? `${type - 1}:${match[2]}` : String(key);
}

function createBossBuildTargets() {
  return Object.fromEntries(['characters', 'skins', 'weapons', 'pets', 'skills', 'artifacts', 'sinPoints', 'nodes', 'combinations'].map(type => [type, new Map()]));
}

function pruneHighCardinalityBuilds(accumulator) {
  pruneMapByScore(accumulator.builds.combinations, BUILD_COMBINATION_SOFT_LIMIT, item => item.runs);
  pruneMapByScore(accumulator.builds.nodeCombinations, BUILD_COMBINATION_SOFT_LIMIT, item => item.runs);
  for (const boss of accumulator.bosses.values()) {
    pruneMapByScore(boss.buildTargets.combinations, BOSS_COMBINATION_SOFT_LIMIT, item => item.encounters + item.kills);
  }
}

function pruneMapByScore(target, limit, score) {
  if (target.size <= limit * 2) return;
  const keep = new Set([...target.entries()]
    .sort((left, right) => score(right[1]) - score(left[1]))
    .slice(0, limit)
    .map(([key]) => key));
  for (const key of target.keys()) if (!keep.has(key)) target.delete(key);
}

function accumulateBossBuild(boss, event, kind, matched, includeNodes) {
  const build = describeBossBuild(event, includeNodes);
  for (const [type, descriptors] of Object.entries(build)) {
    for (const descriptor of descriptors) {
      const key = descriptor.aggregateKey || descriptor.key;
      const target = boss.buildTargets[type];
      if (!target.has(key)) target.set(key, { ...descriptor, encounters: 0, kills: 0, matchedKills: 0, players: new Set() });
      const item = target.get(key);
      item.players.add(event.playerId);
      if (kind === 'encounter') item.encounters += 1;
      else {
        item.kills += 1;
        if (matched) item.matchedKills += 1;
      }
    }
  }
}

function markBossBuildMatched(boss, event, includeNodes) {
  const build = describeBossBuild(event, includeNodes);
  for (const [type, descriptors] of Object.entries(build)) {
    for (const descriptor of descriptors) {
      const key = descriptor.aggregateKey || descriptor.key;
      const item = boss.buildTargets[type].get(key);
      if (item) item.matchedKills += 1;
    }
  }
}

function finalizeBossBuildStats(boss) {
  const finalize = values => [...values.values()].map(item => {
    const { players, ...metadata } = item;
    return {
      ...metadata,
      uniquePlayers: players.size,
      encounterAdoptionRate: boss.encounterIds.size ? percent(item.encounters, boss.encounterIds.size) : null,
      clearRate: item.encounters ? percent(item.matchedKills, item.encounters) : null
    };
  }).sort((left, right) => right.kills - left.kills || right.encounters - left.encounters || (right.clearRate ?? -1) - (left.clearRate ?? -1) || left.name.localeCompare(right.name, 'ko'));
  const limits = { characters: 64, skins: 256, weapons: 128, pets: 128, skills: 256, artifacts: 512, sinPoints: 147, nodes: 256, combinations: 100 };
  return Object.fromEntries(Object.entries(boss.buildTargets).map(([type, values]) => [type, finalize(values).slice(0, limits[type])]));
}

function accumulateBuilds(acc, event, cleared) {
  const characterMeta = getCharacterMeta(event.characterId, event.characterName);
  const characterId = characterMeta?.id ?? (Number.isInteger(event.characterId) ? event.characterId : null);
  const characterName = event.characterName || characterMeta?.name || (characterId !== null ? `캐릭터 ${characterId}` : '');
  const characterKey = characterId !== null ? `id:${characterId}` : characterName ? `name:${slug(characterName)}` : '';
  if (characterKey) {
    acc.builds.characterRuns += 1;
    incrementBuildItem(acc.builds.characters, characterKey, { id: characterId, key: characterKey, name: characterName }, event, cleared, event.characterId !== null ? 'id' : 'name');
  }
  const weaponOwnerKey = characterId !== null ? `character:${characterId}` : event.characterName ? `character-name:${slug(event.characterName)}` : '';
  const skin = describeSkin(event, characterId, characterName, weaponOwnerKey || 'character:unknown');
  if (skin) {
    acc.builds.skinRuns += 1;
    incrementBuildItem(acc.builds.skins, skin.key, skin, event, cleared, hasIdentifier(event.skinId) ? 'id' : 'name');
  }
  const weaponLoadout = describeWeaponLoadout(event, characterId, weaponOwnerKey || 'character:unknown');
  const weapons = weaponLoadout?.parts || [];
  const equippedRunes = filterRunesForWeaponLoadout(weaponLoadout, describeEquippedRunes(event, characterId));
  const weaponRuneVariant = weaponLoadout ? createWeaponRuneVariant(weaponLoadout, event, equippedRunes) : null;
  if (weaponRuneVariant) {
    acc.builds.weaponRuns += 1;
    incrementBuildItem(acc.builds.weapons, weaponRuneVariant.key, weaponRuneVariant, event, cleared, hasIdentifier(event.weaponId) ? 'id' : 'name');
    incrementWeaponRuneStats(acc.builds.weapons.get(weaponRuneVariant.key), equippedRunes, event, cleared);
  }
  const skills = [];
  if (event.hasEquipSkillIds) {
    acc.builds.skillRuns += 1;
    for (const id of event.equipSkillIds) {
      const meta = getSkillMeta(id);
      skills.push({ id, key: `id:${id}`, name: meta?.name || `스킬 ${id}` });
    }
    for (const item of uniqueDescriptors(skills)) {
      const { id, key, name } = item;
      const meta = getSkillMeta(id);
      incrementBuildItem(acc.builds.skills, `id:${id}`, { id, key: `id:${id}`, name: meta?.name || `스킬 ${id}`, known: Boolean(meta) }, event, cleared, 'id');
    }
  } else if (event.hasEquipSkillNames) {
    acc.builds.skillRuns += 1;
    for (const name of event.equipSkillNames) {
      const meta = getSkillMetaByName(name);
      const key = meta ? `id:${meta.id}` : `name:${slug(name)}`;
      skills.push({ id: meta?.id ?? null, key, name });
    }
    for (const item of uniqueDescriptors(skills)) {
      incrementBuildItem(acc.builds.skills, item.key, { ...item, known: item.id !== null }, event, cleared, 'name');
    }
  }
  const artifacts = describeArtifacts(event);
  if (event.hasEquipArtifactKeys) {
    acc.builds.artifactRuns += 1;
    for (const item of uniqueDescriptors(artifacts)) {
      incrementBuildItem(acc.builds.artifacts, item.aggregateKey, item, event, cleared, 'id');
    }
  } else if (event.hasEquipArtifactNames) {
    acc.builds.artifactRuns += 1;
    for (const item of uniqueDescriptors(artifacts)) {
      incrementBuildItem(acc.builds.artifacts, item.aggregateKey, item, event, cleared, 'name');
    }
  }
  const sinPoints = event.hasSinPoints ? describeSinPoints(event.sinPoints, { id: characterId, key: characterKey, name: characterName }) : [];
  if (characterKey && sinPoints.length === 7) {
    acc.builds.sinPointRuns += 1;
    for (const item of sinPoints) incrementBuildItem(acc.builds.sinPoints, item.key, item, event, cleared, 'id');
  }
  const pet = describePet(event);
  if (pet) {
    acc.builds.petRuns += 1;
    incrementBuildItem(acc.builds.pets, pet.key, pet, event, cleared, hasIdentifier(event.petId) ? 'id' : 'name');
  }
  const nodes = describeNodes(event, characterId, characterName);
  const scopedNodes = nodes.map(node => ({
    ...node,
    key: `${characterKey || 'character:unknown'}|node:${node.key}`,
    nodeKey: node.key,
  }));
  if (nodes.length) {
    acc.builds.nodeRuns += 1;
    for (const node of uniqueDescriptors(scopedNodes)) incrementBuildItem(acc.builds.nodes, node.key, node, event, cleared, node.id !== null ? 'id' : 'name');
  }
  const nodeSet = uniqueDescriptors(scopedNodes).sort(compareNodeDescriptors);
  if (characterKey && nodeSet.length) {
    const key = `${characterKey}|node-set:${nodeSet.map(item => item.nodeKey || item.key).sort().join('+')}`;
    acc.builds.nodeCombinationRuns += 1;
    acc.builds.nodeCombinationRunsByCharacter.set(characterKey, (acc.builds.nodeCombinationRunsByCharacter.get(characterKey) || 0) + 1);
    incrementBuildItem(acc.builds.nodeCombinations, key, {
      key,
      name: `${characterName} · ${nodeSet.map(item => item.name).join(' + ')}`,
      character: { id: characterId, key: characterKey, name: characterName },
      nodes: nodeSet
    }, event, cleared, nodeSet.every(item => item.id !== null) ? 'id' : 'name');
  }
  if (characterKey) incrementCharacterComponents(acc.builds.characters.get(characterKey), { skin, weapons: weaponRuneVariant ? [weaponRuneVariant] : [], pet, nodes: scopedNodes, skills, artifacts, sinPoints }, event, cleared);
  const includedNodes = acc.input.includeNodes ? nodes : [];
  const combinationNames = [characterName, skin?.name, ...weapons.map(item => item.name), pet?.name, ...skills.map(item => item.name), ...artifacts.map(item => item.name), ...includedNodes.map(item => item.name)].filter(Boolean);
  if (characterKey && combinationNames.length >= 2) {
    const key = [characterKey, skin?.key, ...weapons.map(item => item.key), pet?.key, ...skills.map(item => item.key).sort(), ...artifacts.map(item => item.aggregateKey).sort(), ...includedNodes.map(item => `node:${item.key}`).sort()].filter(Boolean).join('|');
    acc.builds.combinationRuns += 1;
    incrementBuildItem(acc.builds.combinations, key, {
      key, name: combinationNames.join(' · '), character: characterKey ? { id: characterId, key: characterKey, name: characterName } : null,
      skin, weapons, pet, skills, artifacts, nodes: includedNodes, includesNodes: Boolean(acc.input.includeNodes)
    }, event, cleared, event.schemaEra === 'legacy' ? 'name' : 'id', true);
  }
}

function uniqueDescriptors(items) { return [...new Map(items.map(item => [item.aggregateKey || item.key, item])).values()]; }
function compareNodeDescriptors(left, right) {
  const leftId = Number(left?.id);
  const rightId = Number(right?.id);
  if (Number.isInteger(leftId) && Number.isInteger(rightId)) {
    if (leftId === 999) return rightId === 999 ? 0 : 1;
    if (rightId === 999) return -1;
    return leftId - rightId;
  }
  return String(left?.name || '').localeCompare(String(right?.name || ''), 'ko');
}
function hasIdentifier(value) { return value !== null && value !== undefined && value !== ''; }

function incrementBuildItem(target, key, metadata, event, cleared, source, collectCollections = false) {
  if (!target.has(key)) target.set(key, { ...metadata, runs: 0, clears: 0, players: new Set(), playTimes: [], idRuns: 0, nameRuns: 0, versionStats: Object.create(null), collectionCounts: new Map(), componentCounts: null });
  const item = target.get(key);
  item.runs += 1;
  if (source === 'id') item.idRuns += 1;
  else item.nameRuns += 1;
  if (cleared) item.clears += 1;
  item.players.add(event.playerId);
  if (event.playTimeMs >= 0) addDistributionValue(item.playTimes, event.playTimeMs, event);
  const version = event.version || '버전 미기록';
  if (!item.versionStats[version]) item.versionStats[version] = { runs: 0, clears: 0 };
  item.versionStats[version].runs += 1;
  if (cleared) item.versionStats[version].clears += 1;
  if (collectCollections) for (const id of event.collectionIds || []) item.collectionCounts.set(id, (item.collectionCounts.get(id) || 0) + 1);
}

function incrementWeaponRuneStats(weapon, runes, event, cleared) {
  if (!weapon || !event.hasEquippedRunes) return;
  if (!weapon.runeCounts) weapon.runeCounts = new Map();
  if (!weapon.runeConfigurationCounts) weapon.runeConfigurationCounts = new Map();
  weapon.runeLoggedRuns = (weapon.runeLoggedRuns || 0) + 1;
  const uniqueRunes = uniqueDescriptors(runes || []).sort(compareRuneDescriptors);
  if (uniqueRunes.length) weapon.runeEquippedRuns = (weapon.runeEquippedRuns || 0) + 1;
  for (const rune of uniqueRunes) incrementRuneCounter(weapon.runeCounts, rune.key, rune, event, cleared);
  if (!uniqueRunes.length) return;
  const key = uniqueRunes.map(rune => rune.key).join('|');
  incrementRuneCounter(weapon.runeConfigurationCounts, key, { key, runes: uniqueRunes }, event, cleared);
}

function incrementRuneCounter(target, key, metadata, event, cleared) {
  if (!target.has(key)) target.set(key, { ...metadata, runs: 0, clears: 0, players: new Set() });
  const item = target.get(key);
  item.runs += 1;
  if (cleared) item.clears += 1;
  item.players.add(event.playerId);
}

function compareRuneDescriptors(left, right) {
  const leftWeapon = String(left.weaponSlot || '');
  const rightWeapon = String(right.weaponSlot || '');
  if (leftWeapon !== rightWeapon) return leftWeapon.localeCompare(rightWeapon, 'ko');
  if (left.type !== right.type) return left.type === 'normal' ? -1 : 1;
  return String(left.name || '').localeCompare(String(right.name || ''), 'ko');
}

function incrementCharacterComponents(character, components, event, cleared) {
  if (!character) return;
  if (!character.componentCounts) character.componentCounts = { skins: new Map(), weapons: new Map(), pets: new Map(), nodes: new Map(), skills: new Map(), artifacts: new Map(), sinPoints: new Map() };
  for (const [type, rawItems] of Object.entries({
    skins: components.skin ? [components.skin] : [],
    weapons: components.weapons,
    pets: components.pet ? [components.pet] : [],
    nodes: components.nodes,
    skills: components.skills,
    artifacts: components.artifacts,
    sinPoints: components.sinPoints
  })) {
    for (const descriptor of uniqueDescriptors(rawItems || [])) {
      const key = descriptor.aggregateKey || descriptor.key;
      const target = character.componentCounts[type];
      if (!target.has(key)) target.set(key, { ...descriptor, runs: 0, clears: 0, players: new Set() });
      const item = target.get(key);
      item.runs += 1;
      if (cleared) item.clears += 1;
      item.players.add(event.playerId);
    }
  }
}

function finalizeBuilds(builds) {
  const finalize = (items, denominator, includeCollections = false) => [...items.values()].map(item => {
    const { players, playTimes, versionStats, collectionCounts, componentCounts, runeCounts, runeConfigurationCounts, ...metadata } = item;
    const source = item.idRuns && item.nameRuns ? 'mixed' : item.idRuns ? 'id' : 'name';
    const versions = Object.entries(versionStats).map(([version, value]) => ({ version, runs: value.runs, clears: value.clears, clearRate: percent(value.clears, value.runs) })).sort((left, right) => compareVersions(right.version, left.version));
    const collections = includeCollections ? [...collectionCounts.entries()].map(([id, activations]) => {
      const meta = getCollectionMeta(id);
      return { id, name: meta?.name || `컬렉션 ${id}`, effect: meta?.effect || '', requirements: meta ? collectionRequirements(meta) : [], activations, activationRate: percent(activations, item.runs) };
    }).sort((left, right) => right.activations - left.activations || left.id - right.id) : null;
    const components = componentCounts ? Object.fromEntries(Object.entries(componentCounts).map(([type, values]) => [type, [...values.values()].map(value => {
      const { players: componentPlayers, ...component } = value;
      return { ...component, uniquePlayers: componentPlayers.size, adoptionRate: percent(component.runs, item.runs), clearRate: percent(component.clears, component.runs) };
    }).sort((left, right) => right.runs - left.runs || right.clearRate - left.clearRate)])) : undefined;
    const runeLoggedRuns = Number(item.runeLoggedRuns || 0);
    const finalizeRunes = values => values ? [...values.values()].map(value => {
      const { players: runePlayers, ...rune } = value;
      return { ...rune, uniquePlayers: runePlayers.size, adoptionRate: percent(rune.runs, runeLoggedRuns), clearRate: percent(rune.clears, rune.runs) };
    }).sort((left, right) => right.runs - left.runs || right.clearRate - left.clearRate || String(left.name || left.key).localeCompare(String(right.name || right.key), 'ko')) : [];
    const runes = finalizeRunes(runeCounts);
    const runeConfigurations = finalizeRunes(runeConfigurationCounts);
    const runeStats = runeCounts ? { runeLoggedRuns, runeEquippedRuns: Number(item.runeEquippedRuns || 0), runes, runeConfigurations } : {};
    return { ...metadata, ...runeStats, source, versions, ...(collections ? { collections, synergies: collections.filter(entry => /시너지/.test(entry.effect)) } : {}), ...(components ? { components } : {}), uniquePlayers: players.size, selectionRate: percent(item.runs, denominator), clearRate: percent(item.clears, item.runs), playTime: distribution(playTimes) };
  }).sort((left, right) => right.runs - left.runs || right.clearRate - left.clearRate || left.name.localeCompare(right.name, 'ko'));
  const combinations = finalize(builds.combinations, builds.combinationRuns, true);
  const nodeCombinations = finalize(builds.nodeCombinations, builds.nodeCombinationRuns).map(item => {
    const characterRuns = builds.nodeCombinationRunsByCharacter.get(item.character?.key) || 0;
    const characterSelectionRate = percent(item.runs, characterRuns);
    return { ...item, globalSelectionRate: item.selectionRate, characterSelectionRate, selectionRate: characterSelectionRate };
  });
  const weapons = finalize(builds.weapons, builds.weaponRuns).map(weapon => ({
    ...weapon,
    runeLoggedRuns: Number(weapon.runeLoggedRuns || 0),
    runeEquippedRuns: Number(weapon.runeEquippedRuns || 0),
    runes: Array.isArray(weapon.runes) ? weapon.runes : [],
    runeConfigurations: Array.isArray(weapon.runeConfigurations) ? weapon.runeConfigurations : []
  }));
  const weaponsByKey = new Map(weapons.map(weapon => [weapon.key, weapon]));
  const characters = finalize(builds.characters, builds.characterRuns).map(character => {
    const components = {
      ...character.components,
      weapons: (character.components?.weapons || []).map(component => {
        const weapon = weaponsByKey.get(component.key);
        if (!weapon) return component;
        return {
          ...component,
          runeLoggedRuns: weapon.runeLoggedRuns,
          runeEquippedRuns: weapon.runeEquippedRuns,
          runes: weapon.runes,
          runeConfigurations: weapon.runeConfigurations
        };
      })
    };
    return {
      ...character,
      components,
      topCombinations: combinations.filter(item => item.character?.key === character.key).slice(0, 12).map(item => ({ ...item, characterAdoptionRate: percent(item.runs, character.runs) })),
      topNodeCombinations: nodeCombinations.filter(item => item.character?.key === character.key).slice(0, 12)
    };
  });
  return {
    sourceRuns: { characters: builds.characterRuns, skins: builds.skinRuns, weapons: builds.weaponRuns, pets: builds.petRuns, nodes: builds.nodeRuns, nodeCombinations: builds.nodeCombinationRuns, skills: builds.skillRuns, artifacts: builds.artifactRuns, sinPoints: builds.sinPointRuns, combinations: builds.combinationRuns },
    masterData: { ...MASTER_DATA_COUNTS, runes: RUNE_MASTER_COUNTS.normalOptions + RUNE_MASTER_COUNTS.uniqueOptions },
    characters,
    skins: finalize(builds.skins, builds.skinRuns),
    weapons,
    pets: finalize(builds.pets, builds.petRuns),
    nodes: finalize(builds.nodes, builds.nodeRuns),
    nodeCombinations: nodeCombinations.slice(0, 500),
    skills: finalize(builds.skills, builds.skillRuns),
    artifacts: finalize(builds.artifacts, builds.artifactRuns),
    sinPoints: finalize(builds.sinPoints, builds.sinPointRuns),
    combinations: combinations.slice(0, 500)
  };
}

function collectionRequirements(meta) {
  const result = [];
  if (meta.artifacts.length) result.push(`유물 ${meta.artifacts.map(id => collectionArtifactLabel(0, id)).join(', ')}`);
  if (meta.skills.length) result.push(`스킬 ${meta.skills.map(collectionSkillLabel).join(', ')}`);
  if (meta.skillMods.length) result.push(`특수 개조 ${meta.skillMods.map(collectionSkillLabel).join(', ')}`);
  if (meta.cursedArtifacts.length) result.push(`저주 유물 ${meta.cursedArtifacts.map(id => collectionArtifactLabel(1, id)).join(', ')}`);
  if (meta.weapon) result.push(`무기 ${meta.weapon}`);
  if (meta.character) result.push(`캐릭터 ${meta.character}`);
  return result;
}
function collectionArtifactLabel(type, id) { const meta = getArtifactMeta(`${type}:${id}`); return meta?.name ? `${meta.name}(${id})` : String(id); }
function collectionSkillLabel(id) { const meta = getSkillMeta(Number(id)); return meta?.name ? `${meta.name}(${id})` : String(id); }

function accumulateResultDimension(target, key, event, result) {
  if (!target.has(key)) target.set(key, { key, players: new Set(), runs: 0, clears: 0, deaths: 0, fails: 0, playTimes: [] });
  const item = target.get(key);
  item.players.add(event.playerId);
  item.runs += 1;
  if (result === 'Clear') item.clears += 1;
  else if (result === 'Dead') item.deaths += 1;
  else if (result === 'Fail') item.fails += 1;
  if (event.playTimeMs >= 0) addDistributionValue(item.playTimes, event.playTimeMs, event);
}

function finalizeResultDimensions(target) {
  return [...target.values()].map(item => ({
    key: item.key, players: item.players.size, runs: item.runs, clears: item.clears, deaths: item.deaths, fails: item.fails,
    clearRate: percent(item.clears, item.runs), deathRate: percent(item.deaths, item.runs), playTime: distribution(item.playTimes)
  })).sort((left, right) => right.runs - left.runs || left.key.localeCompare(right.key, 'ko'));
}

function classifyEvent(eventName, aliases) { const candidate = normalizeToken(eventName); for (const type of EVENT_TYPES) if (aliases[type].some(alias => candidate === alias || candidate.endsWith(`_${alias}`))) return type; return ''; }
function normalizeAliases(overrides) { const result = {}; for (const type of EVENT_TYPES) { const values = [...DEFAULT_ALIASES[type], ...(Array.isArray(overrides[type]) ? overrides[type] : [])]; result[type] = [...new Set(values.map(normalizeToken).filter(Boolean))]; } return result; }
function normalizeResultType(explicit, isClear, isDead) { if (isClear === true) return 'Clear'; if (isDead === true) return 'Dead'; if (isClear === false || isDead === false) return 'Fail'; const normalized = String(explicit || '').trim().toLowerCase(); if (normalized === 'clear') return 'Clear'; if (normalized === 'dead') return 'Dead'; if (normalized === 'fail') return 'Fail'; return 'Unknown'; }
function durationMs(data, millisecondKeys, secondKeys) { const milliseconds = numberValue(data, millisecondKeys); if (milliseconds !== null) return milliseconds >= 0 ? Math.round(milliseconds) : -1; const seconds = numberValue(data, secondKeys); return seconds !== null && seconds >= 0 ? Math.round(seconds * 1000) : -1; }
function addDistributionValue(values, value, event) {
  if (!Number.isFinite(value) || value < 0) return;
  const totalCount = (Number(values.totalCount) || 0) + 1;
  values.totalCount = totalCount;
  if (values.length < DISTRIBUTION_SAMPLE_LIMIT) {
    values.push(value);
    return;
  }
  const hash = event?._distributionHash ?? fastStringHash(event?.id || `${event?.playerId || ''}:${event?.timestamp || totalCount}`);
  if (event && event._distributionHash === undefined) event._distributionHash = hash;
  const candidate = hash % totalCount;
  if (candidate < DISTRIBUTION_SAMPLE_LIMIT) values[hash % DISTRIBUTION_SAMPLE_LIMIT] = value;
}
function fastStringHash(value) {
  let hash = 2166136261;
  const text = String(value || '');
  for (let index = 0; index < text.length; index += 1) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619);
  return hash >>> 0;
}
function distribution(values) {
  const sorted = values.filter(value => Number.isFinite(value) && value >= 0).sort((left, right) => left - right);
  const sampleSize = Math.max(sorted.length, Number(values.totalCount) || 0);
  if (!sorted.length) return { sampleSize: 0, averageMs: null, medianMs: null, p90Ms: null };
  const result = { sampleSize, averageMs: Math.round(sorted.reduce((sum, value) => sum + value, 0) / sorted.length), medianMs: percentile(sorted, .5), p90Ms: percentile(sorted, .9) };
  if (sampleSize > sorted.length) Object.assign(result, { estimated: true, calculationSamples: sorted.length });
  return result;
}
function percentile(sorted, value) { if (sorted.length === 1) return sorted[0]; const index = (sorted.length - 1) * value; const lower = Math.floor(index); const upper = Math.ceil(index); return Math.round(sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower)); }
function stringValue(data, keys) { const value = deepFind(data, keys); return value === null || value === undefined ? '' : String(value).trim(); }
function integerValue(data, keys) { const value = numberValue(data, keys); return value === null ? null : Math.trunc(value); }
function identifierValue(data, keys) { const value = deepFind(data, keys); if (value === '' || value === null || value === undefined) return null; const number = Number(value); if (Number.isInteger(number)) return number >= 0 ? number : null; return String(value).trim(); }
function numberValue(data, keys) { const value = deepFind(data, keys); if (value === '' || value === null || value === undefined) return null; const number = Number(value); return Number.isFinite(number) ? number : null; }
function booleanValue(data, keys) { const value = deepFind(data, keys); if (typeof value === 'boolean') return value; if (value === 1 || String(value).toLowerCase() === 'true') return true; if (value === 0 || String(value).toLowerCase() === 'false') return false; return null; }
function collectionValue(data, keys, depth = 0) { if (!data || typeof data !== 'object' || depth > 8) return undefined; const wanted = new Set(keys.map(normalizeKey)); for (const [key, child] of Object.entries(data)) if (wanted.has(normalizeKey(key))) return child; for (const child of Object.values(data)) { if (child && typeof child === 'object') { const found = collectionValue(child, keys, depth + 1); if (found !== undefined) return found; } } return undefined; }
function normalizeIntegerArray(value) { return normalizeArray(value).map(item => Number(item)).filter(item => Number.isInteger(item) && item >= 0); }
function normalizeStringArray(value) { return normalizeArray(value).map(item => String(item).trim()).filter(Boolean); }
function normalizeBuildNames(value) { return normalizeStringArray(value).filter(name => !['빈칸', 'null', 'none', '-1'].includes(name.toLowerCase())); }
function normalizeArray(value) { if (Array.isArray(value)) return value; if (typeof value !== 'string' || !value.trim()) return []; try { const parsed = JSON.parse(value); if (Array.isArray(parsed)) return parsed; } catch {} return value.split(',').map(item => item.trim()); }
function parseEventData(value) { if (value && typeof value === 'object') return value; try { return JSON.parse(String(value || '{}')); } catch { return {}; } }
function deepFind(value, wantedKeys, depth = 0) { if (!value || typeof value !== 'object' || depth > 8) return undefined; const wanted = new Set(wantedKeys.map(normalizeKey)); for (const [key, child] of Object.entries(value)) if (wanted.has(normalizeKey(key)) && child !== null && typeof child !== 'object') return child; for (const child of Object.values(value)) { if (child && typeof child === 'object') { const found = deepFind(child, wantedKeys, depth + 1); if (found !== undefined) return found; } } return undefined; }
function normalizeKey(value) { return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
function normalizeToken(value) { return String(value || '').toLowerCase().replace(/[^a-z0-9가-힣]+/g, '_').replace(/^_+|_+$/g, ''); }
function slug(value) { return normalizeToken(value) || 'unknown'; }
function percent(numerator, denominator) { return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : 0; }
function formatDayKey(timestamp) { return KST_DAY_FORMATTER.format(timestamp); }
function isProductionVersion(version) { return /^\d+\.\d+\.\d+$/.test(String(version || '').trim()); }
function isVersionFamilyFilter(version) { return /^\d+\.\d+\.x$/i.test(String(version || '').trim()); }
function isSupportedVersionFilter(version) { return isProductionVersion(version) || isVersionFamilyFilter(version); }
function normalizeVersionFilter(version) { return isVersionFamilyFilter(version) ? String(version).trim().toLowerCase() : String(version || '').trim(); }
function versionMatchesFilter(version, filter) {
  const normalizedFilter = normalizeVersionFilter(filter);
  if (!normalizedFilter) return true;
  if (!isVersionFamilyFilter(normalizedFilter)) return version === normalizedFilter;
  const [major, minor] = normalizedFilter.split('.');
  return String(version || '').startsWith(`${major}.${minor}.`);
}
function nextKstSchedule(nowMs, hour) {
  const current = new Date(nowMs);
  const shifted = new Date(current.getTime() + 9 * 60 * 60 * 1000);
  let scheduled = new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate(), hour) - 9 * 60 * 60 * 1000);
  if (scheduled.getTime() <= nowMs) scheduled = new Date(scheduled.getTime() + 86_400_000);
  return scheduled;
}
function kstPeriodStart(to, days) {
  const shifted = new Date(new Date(to).getTime() + 9 * 60 * 60 * 1000);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate() - (days - 1)) - 9 * 60 * 60 * 1000);
}

export function isVersionAtLeast(value, minimum) { const left = parseVersion(value); const right = parseVersion(minimum); if (!left || !right) return false; for (let index = 0; index < Math.max(left.length, right.length); index += 1) { const difference = (left[index] || 0) - (right[index] || 0); if (difference !== 0) return difference > 0; } return true; }
function compareVersions(left, right) { const leftVersion = parseVersion(left); const rightVersion = parseVersion(right); if (!leftVersion || !rightVersion) return left.localeCompare(right, 'ko'); for (let index = 0; index < Math.max(leftVersion.length, rightVersion.length); index += 1) { const difference = (leftVersion[index] || 0) - (rightVersion[index] || 0); if (difference !== 0) return difference; } return 0; }
function parseVersion(value) { const match = String(value || '').trim().match(/^(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?/); return match ? match.slice(1).map(part => Number.parseInt(part || '0', 10)) : null; }

export function buildDayPartitions(from, to, prefix, titleId) { const result = []; const cursor = new Date(from); cursor.setUTCHours(0, 0, 0, 0); while (cursor < to) { const date = `${cursor.getUTCFullYear()}${String(cursor.getUTCMonth() + 1).padStart(2, '0')}${String(cursor.getUTCDate()).padStart(2, '0')}`; result.push(`${normalizePrefix(prefix)}/title=${titleId}/date=${date}/`); cursor.setUTCDate(cursor.getUTCDate() + 1); } return result; }
export function parseBlobListXml(xml) { const source = String(xml || ''); const blobs = []; for (const match of source.matchAll(/<Blob>([\s\S]*?)<\/Blob>/g)) { const chunk = match[1]; const name = decodeXml(extractTag(chunk, 'Name')); const byteLength = Number.parseInt(extractTag(chunk, 'Content-Length') || '0', 10); if (name) blobs.push({ name, byteLength: Number.isFinite(byteLength) ? byteLength : 0 }); } return { blobs, nextMarker: decodeXml(extractTag(source, 'NextMarker')) }; }
function partitionDateKey(partition) { const value = String(partition).match(/(?:^|\/)date=(\d{8})(?:\/|$)/)?.[1]; if (!value) throw new Error('Azure 파티션 날짜를 확인할 수 없습니다.'); return value; }
function mergeWindows(left, right) { if (!left) return right ? { from: new Date(right.from), to: new Date(right.to) } : null; if (!right) return { from: new Date(left.from), to: new Date(left.to) }; return { from: new Date(Math.min(new Date(left.from).getTime(), new Date(right.from).getTime())), to: new Date(Math.max(new Date(left.to).getTime(), new Date(right.to).getTime())) }; }
function coversPartitionWindow(outer, inner) { return utcDayKey(outer.from) <= utcDayKey(inner.from) && utcDayKey(outer.to) >= utcDayKey(inner.to); }
function utcDayKey(value) { const date = new Date(value); return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(date.getUTCDate()).padStart(2, '0')}`; }
function hydrateSnapshotWeaponMeta(result) {
  const hydrate = item => {
    for (const part of item?.parts || []) hydrate(part);
    const meta = getWeaponMeta(item?.characterId, item?.id, item?.name);
    if (meta) {
      item.characterId = meta.characterId;
      item.id = meta.id;
    }
  };
  for (const item of result?.builds?.weapons || []) hydrate(item);
  for (const character of result?.builds?.characters || []) for (const item of character?.components?.weapons || []) hydrate(item);
  for (const boss of result?.bosses || []) for (const item of boss?.buildStats?.weapons || []) hydrate(item);
  return result;
}
function hydrateSnapshotNodeMeta(result) {
  const hydrate = (item, fallbackCharacterId = null, fallbackCharacterName = '') => {
    if (!item) return;
    const characterId = item.characterId ?? fallbackCharacterId;
    const meta = getNodeMeta(characterId, item.id);
    if (!meta) return;
    item.characterId = meta.characterId;
    item.characterName = item.characterName || fallbackCharacterName;
    item.name = meta.name;
    item.known = true;
  };
  const hydrateCombination = item => {
    const characterId = item?.character?.id ?? null;
    const characterName = item?.character?.name || '';
    for (const node of item?.nodes || []) hydrate(node, characterId, characterName);
    if (!item) return;
    item.name = [
      item.character?.name,
      item.skin?.name,
      ...(item.weapons || []).map(value => value.name),
      item.pet?.name,
      ...(item.skills || []).map(value => value.name),
      ...(item.artifacts || []).map(value => value.name),
      ...(item.nodes || []).map(value => value.name)
    ].filter(Boolean).join(' · ');
  };
  for (const item of result?.builds?.nodes || []) hydrate(item);
  for (const item of result?.builds?.nodeCombinations || []) hydrateCombination(item);
  for (const character of result?.builds?.characters || []) {
    for (const item of character?.components?.nodes || []) hydrate(item, character.id, character.name);
    for (const item of character?.topCombinations || []) hydrateCombination(item);
    for (const item of character?.topNodeCombinations || []) hydrateCombination(item);
  }
  for (const item of result?.builds?.combinations || []) hydrateCombination(item);
  for (const boss of result?.bosses || []) {
    for (const item of boss?.buildStats?.nodes || []) hydrate(item);
    for (const item of boss?.buildStats?.combinations || []) hydrateCombination(item);
  }
  return result;
}
function isCurrentSnapshotFormat(result) {
  const currentSource = Number(result?.stats?.snapshotFormatRevision) >= SNAPSHOT_FORMAT_REVISION && hasVerifiedFactSource(result);
  if (!currentSource) return false;
  if (Number(result?.stats?.projectionRevision) === OVERVIEW_PROJECTION_REVISION) return true;
  return hasBaseSnapshotShape(result) && hasWeaponRuneStats(result);
}

function normalizeSinPoints(value) {
  const points = normalizeArray(value).map(item => Number(item));
  if (points.length !== 7) return [];
  return points.every(point => Number.isInteger(point) && point >= 0 && point <= 20) ? points : [];
}

// 완성된 특성 트리는 12단계를 모두 장착하고 캐릭터별 마지막 선택지인
// 110~119번 노드를 반드시 포함한다. 999번은 별도 고정/보너스 노드이므로
// 단계 수에 포함하지 않고, 그 존재만으로 완성으로 보지 않는다.
export function hasCompleteNodeBuild(event) {
  if (!event?.hasNodeIds || !Array.isArray(event.nodeIds)) return false;
  const ids = [...new Set(event.nodeIds.map(Number).filter(id => Number.isInteger(id) && id >= 0 && id !== 999))];
  return ids.length >= 12 && ids.some(id => id >= 110 && id < 120);
}

// ClickHouse 수집기는 기존 통계와 완전히 같은 게임 키 보정 규칙을 사용한다.
// 화면 집계기를 다시 호출하지 않고 정규화 단계에서 출정 구성요소를 행으로 전개한다.
export function describeAnalyticsBuild(event, { includeNodes = true } = {}) {
  const withoutNodes = describeBossBuild(event, false);
  const completeNodes = includeNodes && hasCompleteNodeBuild(event);
  const withNodes = completeNodes ? describeBossBuild(event, true) : withoutNodes;
  const character = withoutNodes.characters[0] || null;
  const nodes = withNodes.nodes || [];
  const nodeCombination = character && nodes.length ? [{
    key: `${character.key}|node-set:${nodes.map(item => item.key).sort().join('+')}`,
    name: `${character.name} · ${nodes.map(item => item.name).join(' + ')}`,
    character,
    nodes,
    includesNodes: true
  }] : [];
  return {
    ...withoutNodes,
    nodes,
    nodeCombinations: nodeCombination,
    combinationsWithNodes: completeNodes ? (withNodes.combinations || []) : []
  };
}
function markCurrentSnapshotFormat(result, sourceDays = 0) {
  if (!result.stats || typeof result.stats !== 'object') result.stats = {};
  result.stats.snapshotFormatRevision = SNAPSHOT_FORMAT_REVISION;
  result.stats.factSourceDays = sourceDays;
  result.stats.factCacheRevision = FACT_CACHE_REVISION;
  return result;
}
function canServeStaleSnapshot(result) {
  return Number(result?.stats?.snapshotFormatRevision) >= STALE_SNAPSHOT_MIN_REVISION && hasBaseSnapshotShape(result);
}
function snapshotMatchesInputRange(result, input) {
  const resultFrom = Date.parse(String(result?.from || ''));
  const resultTo = Date.parse(String(result?.to || ''));
  if (!Number.isFinite(resultFrom) || !Number.isFinite(resultTo)) return false;
  return utcDateKey(resultFrom) === utcDateKey(input.from.getTime())
    && utcDateKey(resultTo) === utcDateKey(input.to.getTime());
}
function utcDateKey(timestamp) {
  return new Date(timestamp).toISOString().slice(0, 10);
}
function hasVerifiedFactSource(result) {
  return Number(result?.stats?.factSourceDays) > 0
    && Number(result?.stats?.factCacheRevision) === FACT_CACHE_REVISION;
}
function snapshotCandidateScore(result) {
  const trusted = hasVerifiedFactSource(result) ? 100_000 : 0;
  const populated = Number(result?.summary?.totalRuns) > 0 ? 10_000 : 0;
  const shape = hasBaseSnapshotShape(result) ? 1_000 : 0;
  const format = Math.max(0, Number(result?.stats?.snapshotFormatRevision) || 0);
  return trusted + populated + shape + format;
}
function hasBaseSnapshotShape(result) {
  return hasStructuredCombinations(result) && hasStructuredSkins(result) && hasGroupedWeaponLoadouts(result) && hasCanonicalPetNames(result) && hasCanonicalArtifactNames(result);
}
function hasWeaponRuneStats(result) {
  const valid = item => Object.hasOwn(item || {}, 'runeLoggedRuns') && Object.hasOwn(item || {}, 'runeEquippedRuns') && Array.isArray(item?.runes) && Array.isArray(item?.runeConfigurations);
  return (result?.builds?.weapons || []).every(valid)
    && (result?.builds?.characters || []).every(character => (character?.components?.weapons || []).every(valid));
}
function hasStructuredCombinations(result) {
  const builds = result?.builds;
  return Array.isArray(builds?.pets) && Array.isArray(builds?.nodes)
    && (builds?.characters || []).every(item => item.components && Array.isArray(item.components.weapons) && Array.isArray(item.components.pets) && Array.isArray(item.components.nodes) && Array.isArray(item.components.skills) && Array.isArray(item.components.artifacts) && Array.isArray(item.topCombinations))
    && (builds?.combinations || []).every(item => item?.character && Array.isArray(item.weapons) && Array.isArray(item.skills) && Array.isArray(item.artifacts) && Array.isArray(item.nodes) && Array.isArray(item.versions) && Array.isArray(item.collections));
}
function hasStructuredSkins(result) {
  return Array.isArray(result?.builds?.skins)
    && (result?.builds?.characters || []).every(item => Array.isArray(item?.components?.skins))
    && (result?.bosses || []).every(boss => Array.isArray(boss?.buildStats?.skins));
}
function hasGroupedWeaponLoadouts(result) {
  const grouped = item => Array.isArray(item?.parts) && item.parts.length > 0;
  return (result?.builds?.weapons || []).every(grouped)
    && (result?.builds?.characters || []).every(character => (character?.components?.weapons || []).every(grouped))
    && (result?.bosses || []).every(boss => (boss?.buildStats?.weapons || []).every(grouped));
}
function hasCanonicalPetNames(result) {
  const canonical = item => {
    if (!item) return true;
    const numericId = Number(item.id);
    if (Number.isInteger(numericId) && numericId < 0) return false;
    const meta = getPetMeta(item.id);
    return !meta || item.name === meta.name;
  };
  return (result?.builds?.pets || []).every(canonical)
    && (result?.builds?.characters || []).every(character => (character?.components?.pets || []).every(canonical) && (character?.topCombinations || []).every(item => canonical(item?.pet)))
    && (result?.builds?.combinations || []).every(item => canonical(item?.pet))
    && (result?.bosses || []).every(boss => (boss?.buildStats?.pets || []).every(canonical) && (boss?.buildStats?.combinations || []).every(item => canonical(item?.pet)));
}
function hasCanonicalArtifactNames(result) {
  const canonical = item => {
    if (!item) return true;
    const meta = getArtifactMeta(item.sourceKey || item.key);
    return meta?.name ? item.name === meta.name : !String(item.name || '').startsWith('이름 미정 유물');
  };
  const canonicalList = items => (items || []).every(canonical);
  return canonicalList(result?.builds?.artifacts)
    && (result?.builds?.characters || []).every(character => canonicalList(character?.components?.artifacts) && (character?.topCombinations || []).every(item => canonicalList(item?.artifacts)))
    && (result?.builds?.combinations || []).every(item => canonicalList(item?.artifacts))
    && (result?.bosses || []).every(boss => canonicalList(boss?.buildStats?.artifacts) && (boss?.buildStats?.combinations || []).every(item => canonicalList(item?.artifacts)));
}
function snapshotKey(input) { const from = new Date(input.from).toISOString().slice(0, 10).replaceAll('-', ''); const to = new Date(input.to).toISOString().slice(0, 10).replaceAll('-', ''); const filterInput = { version: input.version || '', platform: input.platform || '', mode: input.mode || '', includeNodes: Boolean(input.includeNodes), afterFirstMiddleBoss: Boolean(input.afterFirstMiddleBoss) }; if (input.minModeLevel !== null && input.minModeLevel !== undefined) filterInput.minModeLevel = input.minModeLevel; const filters = crypto.createHash('sha256').update(JSON.stringify(filterInput)).digest('hex').slice(0, 12); return `q${SNAPSHOT_REVISION}-${from}-${to}-${filters}`; }
function emptyDayManifest(dateKey) { return { revision: EVENT_CACHE_REVISION, date: dateKey, processed: {}, chunks: [], updatedAt: '' }; }
function normalizeDayManifest(value, dateKey) {
  const revision = Number(value?.revision);
  const compatibleRevision = COMPATIBLE_EVENT_CACHE_REVISIONS.has(revision);
  if (!value || !compatibleRevision || value.date !== dateKey || !value.processed || typeof value.processed !== 'object' || Array.isArray(value.processed)) return null;
  const processed = {};
  for (const [name, size] of Object.entries(value.processed)) {
    const byteLength = Number(size);
    if (name && Number.isFinite(byteLength) && byteLength >= 0) processed[name] = byteLength;
  }
  const chunks = Array.isArray(value.chunks) ? [...new Set(value.chunks.filter(name => /^(?:chunk|bootstrap)-[a-f0-9]{16,64}\.ndjson$/.test(String(name))))] : [];
  return { revision: EVENT_CACHE_REVISION, date: dateKey, processed, chunks, updatedAt: String(value.updatedAt || '') };
}
function processedMapsEqual(left, right) {
  const leftEntries = Object.entries(left || {});
  const rightEntries = Object.entries(right || {});
  return leftEntries.length === rightEntries.length && leftEntries.every(([name, size]) => right?.[name] === size);
}
async function serializeEvents(events) {
  if (!events.length) return '';
  const lines = new Array(events.length);
  for (let index = 0; index < events.length; index += 1) {
    lines[index] = JSON.stringify(events[index]);
    if ((index + 1) % 1_000 === 0) await yieldToEventLoop();
  }
  return `${lines.join('\n')}\n`;
}
function createChunkName(results, body) {
  const identity = results.map(result => `${result.blob.name}:${result.blob.byteLength}`).sort().join('\n');
  return `chunk-${crypto.createHash('sha256').update(identity).update('\n').update(body).digest('hex').slice(0, 32)}.ndjson`;
}
function compactCachedEvent(event) { const { rawPayload, ...cached } = event; return cached; }
function compactFactEvent(event) {
  if (!EVENT_TYPES.includes(event?.type)) return null;
  const common = {
    id: event.id, timestamp: event.timestamp, type: event.type, playerId: event.playerId, accountLinked: event.accountLinked === true, runId: event.runId,
    schemaEra: event.schemaEra, version: event.version, platform: event.platform, mode: event.mode, modeLevel: event.modeLevel, chapter: event.chapter,
    characterId: event.characterId, characterName: event.characterName, characterLevel: event.characterLevel,
    skinId: event.skinId, skinName: event.skinName,
    weaponId: event.weaponId, weaponName: event.weaponName, subWeaponId: event.subWeaponId, subWeaponName: event.subWeaponName,
    petId: event.petId, petName: event.petName,
    hasNodeIds: event.hasNodeIds, nodeIds: event.nodeIds, nodeNames: event.nodeNames, collectionIds: event.collectionIds,
    hasEquipSkillIds: event.hasEquipSkillIds, equipSkillIds: event.equipSkillIds,
    hasEquipSkillNames: event.hasEquipSkillNames, equipSkillNames: event.equipSkillNames,
    hasEquipArtifactKeys: event.hasEquipArtifactKeys, equipArtifactKeys: event.equipArtifactKeys,
    hasEquipArtifactNames: event.hasEquipArtifactNames, equipArtifactNames: event.equipArtifactNames,
    hasEquippedRunes: event.hasEquippedRunes, equippedRunes: event.equippedRunes,
    hasSinPoints: event.hasSinPoints, sinPoints: event.sinPoints
  };
  if (event.type === 'bossKill' || event.type === 'bossEncounter') return {
    ...common, bossId: event.bossId, bossKey: event.bossKey, bossName: event.bossName,
    bossRank: event.bossRank, encounterId: event.encounterId, fightDurationMs: event.fightDurationMs
  };
  return {
    ...common, resultType: event.resultType, playTimeMs: event.playTimeMs, stage: event.stage, reachedFirstMiddleBoss: event.reachedFirstMiddleBoss,
  };
}
async function replaceFile(source, target) {
  try { await fs.rename(source, target); }
  catch (error) {
    if (!['EEXIST', 'EPERM'].includes(error?.code)) throw error;
    await fs.rm(target, { force: true });
    await fs.rename(source, target);
  }
}
function publicSyncError(error) { if (Number(error?.statusCode) === 424) return error.message; if (Number(error?.statusCode) === 413) return error.message; return '원본 로그 증분 집계 중 오류가 발생했습니다. 잠시 후 다시 시도합니다.'; }
function buildListUrl({ account, container, sasToken, prefix, marker }) { const url = new URL(`https://${account}.blob.core.windows.net/${encodeURIComponent(container)}`); url.searchParams.set('restype', 'container'); url.searchParams.set('comp', 'list'); url.searchParams.set('prefix', prefix); url.searchParams.set('maxresults', '5000'); if (marker) url.searchParams.set('marker', marker); appendSas(url, sasToken); return url.toString(); }
function buildBlobUrl({ account, container, sasToken, blobName }) { const encodedBlob = String(blobName).split('/').map(encodeURIComponent).join('/'); const url = new URL(`https://${account}.blob.core.windows.net/${encodeURIComponent(container)}/${encodedBlob}`); appendSas(url, sasToken); return url.toString(); }
function appendSas(url, sasToken) { for (const [key, value] of new URLSearchParams(sasToken)) url.searchParams.append(key, value); }
function extractTag(source, tag) { return source.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`))?.[1] || ''; }
function decodeXml(value) { return String(value || '').replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&apos;', "'"); }
function normalizeEventData(value) { if (value === null || value === undefined) return ''; return typeof value === 'string' ? value : JSON.stringify(value); }
function normalizeTimestamp(value) { if (value instanceof Date) return value.getTime(); if (typeof value === 'bigint' || typeof value === 'number') { const numeric = Number(value); if (!Number.isFinite(numeric)) return null; const absolute = Math.abs(numeric); if (absolute >= 1e17) return Math.floor(numeric / 1e6); if (absolute >= 1e14) return Math.floor(numeric / 1e3); if (absolute >= 1e11) return Math.floor(numeric); return Math.floor(numeric * 1e3); } const parsed = Date.parse(String(value || '')); return Number.isFinite(parsed) ? parsed : null; }
function validateFilter(value, name) { const text = String(value || '').trim(); if (text.length > 100) throw httpError(400, `${name} 필터가 너무 깁니다.`); return text; }
function parseDate(value, name) { const date = new Date(value); if (Number.isNaN(date.getTime())) throw httpError(400, `${name} 형식이 올바르지 않습니다.`); return date; }
function validateStorageAccount(value) { const text = String(value || '').trim(); if (text && !/^[a-z0-9]{3,24}$/.test(text)) throw new Error('AZURE_PLAYFAB_LOG_STORAGE_ACCOUNT 형식이 올바르지 않습니다.'); return text; }
function validateContainer(value) { const text = String(value || DEFAULT_CONTAINER).trim(); if (!/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/.test(text)) throw new Error('AZURE_PLAYFAB_LOG_CONTAINER 형식이 올바르지 않습니다.'); return text; }
function normalizeSasToken(value) { return String(value || '').trim().replace(/^\?/, ''); }
function normalizePrefix(value) { return String(value || DEFAULT_PREFIX).trim().replace(/^\/+|\/+$/g, '') || DEFAULT_PREFIX; }
function azureListError(status, xml) { const code = decodeXml(extractTag(xml, 'Code')).trim(); return httpError(424, `Azure Blob 목록 조회에 실패했습니다${code ? `: ${code}` : ''} (HTTP ${status}).`); }
function isAuthorizationLikeError(error) { const message = String(error?.message || ''); const status = Number(error?.status || error?.statusCode || 0); return status === 401 || status === 403 || /(401|403|forbidden|authorization|authentication|permission)/i.test(message); }
function clampInteger(value, minimum, maximum, fallback) { const parsed = Number.parseInt(String(value ?? ''), 10); return Number.isInteger(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback; }
async function mapWithConcurrency(items, concurrency, worker) { const results = new Array(items.length); let next = 0; async function run() { while (next < items.length) { const index = next; next += 1; results[index] = await worker(items[index], index); await yieldToEventLoop(); } } await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run)); return results; }
function yieldToEventLoop() { return new Promise(resolve => setImmediate(resolve)); }
function httpError(statusCode, message) { const error = new Error(message); error.statusCode = statusCode; return error; }
