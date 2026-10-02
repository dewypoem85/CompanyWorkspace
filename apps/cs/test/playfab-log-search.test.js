import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { validateLogConfig, validateLogJob } from '../public/log-search-contract.js';
import {
  buildHourPartitions,
  countHourPartitions,
  createPlayFabLogSearchApi,
  matchesQuery,
  parseBlobListXml,
  validateSearchRequest
} from '../lib/playfab-log-search.js';

test('시간 범위를 라이브 Title UTC date/hour Blob prefix로 변환한다', () => {
  const from = new Date('2026-08-14T02:30:00Z');
  const to = new Date('2026-08-14T04:01:00Z');
  assert.deepEqual(buildHourPartitions(from, to, 'data', 'EF17D'), [
    'data/title=EF17D/date=20260814/hour=02/',
    'data/title=EF17D/date=20260814/hour=03/',
    'data/title=EF17D/date=20260814/hour=04/'
  ]);
  assert.equal(countHourPartitions(from, to), 3);
});

test('로그 본문 검색은 all/any/exact 방식을 지원한다', () => {
  const text = 'A 스킨을 구매하여 300개의 젬을 소모했다.';
  assert.equal(matchesQuery(text, '스킨 젬', 'all'), true);
  assert.equal(matchesQuery(text, '스킨 기도석', 'all'), false);
  assert.equal(matchesQuery(text, '기도석 젬', 'any'), true);
  assert.equal(matchesQuery(text, '300개의 젬', 'exact'), true);
});

test('Azure Blob List XML에서 Parquet 파일 메타데이터를 읽는다', () => {
  const xml = `<?xml version="1.0"?><EnumerationResults><Blobs>
    <Blob><Name>data/title=EF17D/date=20260814/hour=03/part-1.parquet</Name><Properties><Content-Length>223344</Content-Length></Properties></Blob>
  </Blobs><NextMarker></NextMarker></EnumerationResults>`;
  const parsed = parseBlobListXml(xml);
  assert.deepEqual(parsed.blobs, [{
    name: 'data/title=EF17D/date=20260814/hour=03/part-1.parquet',
    byteLength: 223344
  }]);
  assert.equal(parsed.nextMarker, '');
});

test('검색 요청은 기간, UID, 검색어를 검증하되 장기간 검색을 제한하지 않는다', () => {
  const now = Date.parse('2026-08-14T06:00:00Z');
  const parsed = validateSearchRequest({
    from: '2026-08-14T03:00:00Z',
    to: '2026-08-14T04:00:00Z',
    query: '스킨 젬',
    mode: 'all',
    sort: 'desc',
    playFabId: '25C2B21CDCE95200',
    eventName: 'custom_event',
    limit: 100
  }, now);
  assert.equal(parsed.playFabId, '25C2B21CDCE95200');
  assert.equal(parsed.query, '스킨 젬');

  assert.doesNotThrow(() => validateSearchRequest({
    from: '2026-05-01T00:00:00Z',
    to: '2026-08-14T00:00:00Z',
    query: '젬'
  }, now));

  assert.doesNotThrow(() => validateSearchRequest({
    from: '2025-08-14T00:00:00Z',
    to: '2026-08-14T00:00:00Z',
    query: '젬',
    playFabId: '25C2B21CDCE95200'
  }, now));
});

test('config는 로그 검색이 PLAYFAB_LIVE_TITLE_ID만 사용함을 노출한다', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cs-log-config-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const api = createPlayFabLogSearchApi({
    dataDir: dir,
    storageAccount: 'dungeonslasherlogs',
    container: 'logs',
    sasToken: 'sv=1&sp=rl&sig=fake',
    prefix: 'data',
    liveTitleId: 'EF17D'
  });
  const config = (await api.handle({
    path: '/api/playfab/log-search/config', body: {}, authenticatedUser: 'tester', requestId: '1', ip: '127.0.0.1'
  })).payload;
  assert.equal(config.configured, true);
  assert.equal(validateLogConfig(config), config);
  assert.equal(config.source, 'live');
  assert.equal(config.titleId, 'EF17D');
  assert.equal(config.environments, undefined);
  assert.equal(config.asynchronous, true);
  assert.equal(config.cancellable, true);
  assert.equal(config.fairQueue, false);
  assert.equal(config.parallelJobs, true);
  assert.equal(config.maxConcurrentJobs, 4);
  assert.equal(config.pollIntervalMs, 2_000);
  assert.equal(config.limits.maxRangeHours, null);
  assert.equal(config.limits.withoutUidHours, undefined);
  assert.equal(config.limits.withUidHours, undefined);
  assert.equal(config.longSearchConfirmation.withoutUidHours, 24);
  assert.equal(config.longSearchConfirmation.withUidHours, 168);
});

test('기간은 제한하지 않지만 장기 검색은 명시 확인 후 시작한다', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cs-log-long-confirm-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const api = createPlayFabLogSearchApi({
    dataDir: dir,
    storageAccount: 'dungeonslasherlogs',
    container: 'logs',
    sasToken: 'sv=1&sp=rl&sig=fake',
    prefix: 'data',
    liveTitleId: 'EF17D',
    fetchImpl: async () => new Response('<EnumerationResults><Blobs></Blobs><NextMarker></NextMarker></EnumerationResults>', { status: 200 }),
    now: () => Date.parse('2026-08-14T06:00:00Z')
  });
  const request = {
    from: '2026-08-12T00:00:00Z',
    to: '2026-08-14T00:00:00Z',
    query: '젬',
    sort: 'desc'
  };

  const confirmation = await api.handle({
    path: '/api/playfab/log-search/search', body: request,
    authenticatedUser: { id: '15' }, requestId: 'confirm', ip: '127.0.0.1'
  });
  assert.equal(confirmation.statusCode, 409);
  assert.equal(confirmation.payload.confirmationRequired, true);
  assert.equal(confirmation.payload.partitions, 48);

  const started = await api.handle({
    path: '/api/playfab/log-search/search', body: { ...request, confirmLongRange: true },
    authenticatedUser: { id: '15' }, requestId: 'confirmed', ip: '127.0.0.1'
  });
  assert.equal(started.statusCode, 202);
  assert.equal((await waitForJob(api, started.payload.job.id, { id: '15' })).status, 'completed');
});

test('UID로 파일을 선별한 뒤 EventData 본문을 검색하고 검색어 원문은 감사 로그에 남기지 않는다', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cs-log-search-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const blobName = 'data/title=EF17D/date=20260814/hour=03/part-1.parquet';
  const listXml = `<?xml version="1.0"?><EnumerationResults><Blobs>
    <Blob><Name>${blobName}</Name><Properties><Content-Length>1000</Content-Length></Properties></Blob>
  </Blobs><NextMarker></NextMarker></EnumerationResults>`;
  const readCalls = [];

  const api = createPlayFabLogSearchApi({
    dataDir: dir,
    storageAccount: 'dungeonslasherlogs',
    container: 'logs',
    sasToken: 'sv=1&sp=rl&sig=fake',
    prefix: 'data',
    liveTitleId: 'EF17D',
    fetchImpl: async () => new Response(listXml, { status: 200, headers: { 'content-type': 'application/xml' } }),
    parquetReader: async ({ columns }) => {
      readCalls.push(columns);
      if (columns.length === 1) {
        return [{ EntityLineage_master_player_account: '25C2B21CDCE95200' }];
      }
      return [{
        Timestamp: '2026-08-14T03:10:00Z',
        EventId: 'event-1',
        FullName_Name: 'custom_cs_log',
        FullName_Namespace: 'custom',
        Entity_Id: '25C2B21CDCE95200',
        Entity_Type: 'player',
        EntityLineage_master_player_account: '25C2B21CDCE95200',
        EntityLineage_title_player_account: 'TPA',
        EventData: JSON.stringify({ message: 'A 스킨을 구매하여 300개의 젬을 소모했다.' })
      }];
    },
    now: () => Date.parse('2026-08-14T04:00:00Z')
  });

  const searchRequest = {
    from: '2026-08-14T03:00:00Z',
    to: '2026-08-14T04:00:00Z',
    query: '스킨 젬',
    mode: 'all',
    sort: 'desc',
    playFabId: '25C2B21CDCE95200',
    limit: 100
  };
  const started = await api.handle({
    path: '/api/playfab/log-search/search',
    body: searchRequest,
    authenticatedUser: { id: '15', name: '홍길동', email: 'hong@example.com' },
    requestId: 'req-1',
    ip: '127.0.0.1'
  });
  assert.equal(started.statusCode, 202);
  assert.match(started.payload.job.id, /^[0-9a-f-]{36}$/);
  assert.ok(['queued', 'running'].includes(started.payload.job.status));

  const duplicate = await api.handle({
    path: '/api/playfab/log-search/search',
    body: searchRequest,
    authenticatedUser: { id: '15', name: '홍길동', email: 'hong@example.com' },
    requestId: 'req-duplicate',
    ip: '127.0.0.1'
  });
  assert.equal(duplicate.payload.reused, true);
  assert.equal(duplicate.payload.job.id, started.payload.job.id);

  const completed = await waitForJob(api, started.payload.job.id, {
    id: '15', name: '홍길동', email: 'hong@example.com'
  });
  assert.equal(completed.status, 'completed');
  const result = completed.result;

  assert.equal(result.source, 'live');
  assert.equal(result.titleId, 'EF17D');
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].playFabId, '25C2B21CDCE95200');
  assert.match(result.results[0].snippet, /스킨/);
  assert.equal(result.stats.blobsListed, 1);
  assert.equal(result.stats.blobsScanned, 1);
  assert.equal(readCalls.length, 2);

  const audit = await readFile(path.join(dir, 'playfab-log-search-audit.jsonl'), 'utf8');
  assert.doesNotMatch(audit, /스킨 젬/);
  assert.match(audit, /"queryHash":"[0-9a-f]{64}"/);
  assert.match(audit, /"userId":"15"/);
  assert.match(audit, /"userName":"홍길동"/);
  assert.match(audit, /"userEmail":"hong@example.com"/);
  assert.doesNotMatch(audit, /sig=fake/);
});

test('대량 일치 결과도 요청한 최대 건수만 메모리에 유지하고 정렬한다', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cs-log-bounded-results-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const blobName = 'data/title=EF17D/date=20260814/hour=03/part-many.parquet';
  const listXml = `<EnumerationResults><Blobs><Blob><Name>${blobName}</Name><Properties><Content-Length>1000</Content-Length></Properties></Blob></Blobs><NextMarker></NextMarker></EnumerationResults>`;
  const api = createPlayFabLogSearchApi({
    dataDir: dir,
    storageAccount: 'dungeonslasherlogs',
    container: 'logs',
    sasToken: 'sv=1&sp=rl&sig=fake',
    prefix: 'data',
    liveTitleId: 'EF17D',
    fetchImpl: async () => new Response(listXml, { status: 200 }),
    parquetReader: async () => Array.from({ length: 60 }, (_, minute) => ({
      Timestamp: `2026-08-14T03:${String(minute).padStart(2, '0')}:00Z`,
      EventId: `event-${minute}`,
      FullName_Name: 'bulk_event',
      Entity_Id: 'PLAYER',
      EntityLineage_master_player_account: 'PLAYER',
      EventData: '{"message":"match"}'
    })),
    now: () => Date.parse('2026-08-14T04:00:00Z')
  });
  const user = { id: '15' };
  const started = await api.handle({
    path: '/api/playfab/log-search/search',
    body: { from: '2026-08-14T03:00:00Z', to: '2026-08-14T04:00:00Z', query: 'match', sort: 'desc', limit: 50 },
    authenticatedUser: user, requestId: 'bounded', ip: '127.0.0.1'
  });
  const completed = await waitForJob(api, started.payload.job.id, user);
  assert.equal(completed.result.results.length, 50);
  assert.equal(completed.result.results[0].timestamp, '2026-08-14T03:59:00.000Z');
  assert.equal(completed.result.results.at(-1).timestamp, '2026-08-14T03:10:00.000Z');
});

test('여러 직원의 로그 검색은 서로 기다리지 않고 병렬 실행한다', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cs-log-queue-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let releaseFirstList;
  const firstListGate = new Promise((resolve) => { releaseFirstList = resolve; });
  t.after(() => releaseFirstList());
  let listCalls = 0;
  const emptyList = '<EnumerationResults><Blobs></Blobs><NextMarker></NextMarker></EnumerationResults>';
  const api = createPlayFabLogSearchApi({
    dataDir: dir,
    storageAccount: 'dungeonslasherlogs',
    container: 'logs',
    sasToken: 'sv=1&sp=rl&sig=fake',
    prefix: 'data',
    liveTitleId: 'EF17D',
    fetchImpl: async () => {
      listCalls += 1;
      if (listCalls === 1) await firstListGate;
      return new Response(emptyList, { status: 200 });
    }
  });
  const to = new Date();
  const from = new Date(to.getTime() - 3_600_000);
  const first = await api.handle({
    path: '/api/playfab/log-search/search',
    body: { from: from.toISOString(), to: to.toISOString(), query: '첫 검색' },
    authenticatedUser: { id: '15' }, requestId: 'first', ip: '127.0.0.1'
  });
  assert.equal(first.statusCode, 202);
  const second = await api.handle({
    path: '/api/playfab/log-search/search',
    body: { from: from.toISOString(), to: to.toISOString(), query: '두 번째 검색' },
    authenticatedUser: { id: '16' }, requestId: 'second', ip: '127.0.0.1'
  });
  assert.equal(second.statusCode, 202);

  await delay(5);
  const firstStatus = await api.handle({
    path: '/api/playfab/log-search/status', body: { jobId: first.payload.job.id },
    authenticatedUser: { id: '15' }, requestId: 'first-status', ip: '127.0.0.1'
  });
  assert.equal(firstStatus.payload.job.status, 'running');
  assert.equal((await waitForJob(api, second.payload.job.id, { id: '16' })).status, 'completed');

  releaseFirstList();
  assert.equal((await waitForJob(api, first.payload.job.id, { id: '15' })).status, 'completed');
});

test('다른 직원의 짧은 검색은 실행 중인 장기 검색과 독립적으로 완료된다', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cs-log-fair-queue-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let releaseFirstList;
  const firstListGate = new Promise((resolve) => { releaseFirstList = resolve; });
  t.after(() => releaseFirstList());
  const listedHours = [];
  const emptyList = '<EnumerationResults><Blobs></Blobs><NextMarker></NextMarker></EnumerationResults>';
  const api = createPlayFabLogSearchApi({
    dataDir: dir,
    storageAccount: 'dungeonslasherlogs',
    container: 'logs',
    sasToken: 'sv=1&sp=rl&sig=fake',
    prefix: 'data',
    liveTitleId: 'EF17D',
    fetchImpl: async (url) => {
      const prefix = new URL(url).searchParams.get('prefix');
      listedHours.push(prefix.match(/hour=(\d{2})/)?.[1]);
      if (listedHours.length === 1) await firstListGate;
      return new Response(emptyList, { status: 200 });
    },
    now: () => Date.parse('2026-08-14T06:00:00Z')
  });

  const first = await api.handle({
    path: '/api/playfab/log-search/search',
    body: { from: '2026-08-14T02:00:00Z', to: '2026-08-14T04:00:00Z', query: '첫 검색', sort: 'asc' },
    authenticatedUser: { id: '15' }, requestId: 'fair-first', ip: '127.0.0.1'
  });
  await delay(5);
  const second = await api.handle({
    path: '/api/playfab/log-search/search',
    body: { from: '2026-08-14T05:00:00Z', to: '2026-08-14T06:00:00Z', query: '두 번째 검색', sort: 'asc' },
    authenticatedUser: { id: '16' }, requestId: 'fair-second', ip: '127.0.0.1'
  });
  assert.equal((await waitForJob(api, second.payload.job.id, { id: '16' })).status, 'completed');
  assert.deepEqual(listedHours, ['02', '05']);
  releaseFirstList();

  assert.equal((await waitForJob(api, first.payload.job.id, { id: '15' })).status, 'completed');
  assert.deepEqual(listedHours, ['02', '05', '03']);
});

test('실행 중인 장기 검색은 현재 Azure 요청 이후 안전하게 취소한다', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cs-log-cancel-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let releaseList;
  const listGate = new Promise((resolve) => { releaseList = resolve; });
  let listCalls = 0;
  const api = createPlayFabLogSearchApi({
    dataDir: dir,
    storageAccount: 'dungeonslasherlogs',
    container: 'logs',
    sasToken: 'sv=1&sp=rl&sig=fake',
    prefix: 'data',
    liveTitleId: 'EF17D',
    fetchImpl: async () => {
      listCalls += 1;
      await listGate;
      return new Response('<EnumerationResults><Blobs></Blobs><NextMarker></NextMarker></EnumerationResults>', { status: 200 });
    },
    now: () => Date.parse('2026-08-14T06:00:00Z')
  });
  const user = { id: '15' };
  const started = await api.handle({
    path: '/api/playfab/log-search/search',
    body: { from: '2026-08-14T02:00:00Z', to: '2026-08-14T04:00:00Z', query: '취소 검색' },
    authenticatedUser: user, requestId: 'cancel', ip: '127.0.0.1'
  });
  await delay(5);
  const cancelling = await api.handle({
    path: '/api/playfab/log-search/cancel', body: { jobId: started.payload.job.id },
    authenticatedUser: user, requestId: 'cancel-request', ip: '127.0.0.1'
  });
  assert.equal(cancelling.statusCode, 202);
  assert.equal(cancelling.payload.job.cancelRequested, true);
  releaseList();

  const cancelled = await waitForJob(api, started.payload.job.id, user);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(listCalls, 1);
});

test('Azure 403은 비동기 작업 실패 상태에 원인 코드와 SAS List 권한 안내를 남긴다', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cs-log-403-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const api = createPlayFabLogSearchApi({
    dataDir: dir,
    storageAccount: 'dungeonslasherlogs',
    container: 'logs',
    sasToken: 'sv=1&sp=r&sig=fake',
    prefix: 'data',
    liveTitleId: 'EF17D',
    fetchImpl: async () => new Response(
      '<?xml version="1.0"?><Error><Code>AuthorizationPermissionMismatch</Code><Message>This request is not authorized.</Message></Error>',
      { status: 403, headers: { 'content-type': 'application/xml' } }
    ),
    now: () => Date.parse('2026-08-14T04:00:00Z')
  });

  const started = await api.handle({
    path: '/api/playfab/log-search/search',
    body: {
      from: '2026-08-14T03:00:00Z',
      to: '2026-08-14T04:00:00Z',
      query: '젬'
    },
    authenticatedUser: 'tester', requestId: '1', ip: '127.0.0.1'
  });
  assert.equal(started.statusCode, 202);
  const failed = await waitForJob(api, started.payload.job.id, 'tester');
  assert.equal(failed.status, 'failed');
  assert.match(failed.error, /AuthorizationPermissionMismatch/);
  assert.match(failed.error, /List\(l\)/);
});

test('검색 작업 상태는 요청한 회사 사용자만 조회할 수 있다', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cs-log-owner-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const api = createPlayFabLogSearchApi({
    dataDir: dir,
    storageAccount: 'dungeonslasherlogs',
    container: 'logs',
    sasToken: 'sv=1&sp=rl&sig=fake',
    prefix: 'data',
    liveTitleId: 'EF17D',
    fetchImpl: async () => new Response('<EnumerationResults><Blobs></Blobs><NextMarker></NextMarker></EnumerationResults>', { status: 200 })
  });
  const started = await api.handle({
    path: '/api/playfab/log-search/search',
    body: {
      from: new Date(Date.now() - 3_600_000).toISOString(),
      to: new Date().toISOString(),
      query: '젬'
    },
    authenticatedUser: { id: '15' }, requestId: 'owner', ip: '127.0.0.1'
  });
  await assert.rejects(() => api.handle({
    path: '/api/playfab/log-search/status',
    body: { jobId: started.payload.job.id },
    authenticatedUser: { id: '16' }, requestId: 'other', ip: '127.0.0.1'
  }), /검색 작업을 찾을 수 없습니다/);
  await assert.rejects(() => api.handle({
    path: '/api/playfab/log-search/cancel',
    body: { jobId: started.payload.job.id },
    authenticatedUser: { id: '16' }, requestId: 'other-cancel', ip: '127.0.0.1'
  }), /검색 작업을 찾을 수 없습니다/);
  await waitForJob(api, started.payload.job.id, { id: '15' });
});

async function waitForJob(api, jobId, authenticatedUser) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const status = await api.handle({
      path: '/api/playfab/log-search/status',
      body: { jobId },
      authenticatedUser,
      requestId: `status-${attempt}`,
      ip: '127.0.0.1'
    });
    validateLogJob(status.payload.job, { jobId, titleId: 'EF17D' });
    if (['completed', 'failed', 'cancelled'].includes(status.payload.job.status)) return status.payload.job;
    await delay(5);
  }
  assert.fail('로그 검색 작업 완료 대기 시간이 초과되었습니다.');
}
