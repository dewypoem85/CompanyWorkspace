import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readRetentionDays } from '../lib/clickhouse-schema.js';
import { createClickHouseStatistics, normalizeNodeSelectionRates, parseFilter, selectionRateScope } from '../lib/clickhouse-statistics.js';
import { createPlayFabAzureSource } from '../lib/playfab-azure-source.js';
import { createClickHouseClient } from '../lib/clickhouse-client.js';
import { estimateBackfillRequiredBytes, insertBlob, insertBlobs, normalizePublication, readAggregateRepairPlan, readMismatchedAggregateDays, reachedFirstMiddleBoss, rebuildBatches, rebuildDay, rebuildDays, requiresPipelineReplay, shouldReadAllRawDays, sourceDateKeysForRefresh } from '../lib/clickhouse-ingest.js';

test('ClickHouse 통계 보존 기간 기본값은 90일이다', () => {
  assert.equal(readRetentionDays(undefined), 90);
  assert.equal(readRetentionDays('30'), 30);
  assert.throws(() => readRetentionDays('0'), /1~3650/);
});

test('통계 조회 기간은 보존 기간을 넘을 수 없다', () => {
  const previous = process.env.STATISTICS_RETENTION_DAYS;
  process.env.STATISTICS_RETENTION_DAYS = '90';
  try {
    const valid = parseFilter(new URLSearchParams({ from: '2026-06-24', to: '2026-09-21' }), Date.parse('2026-09-21T00:00:00Z'));
    assert.equal(valid.from, '2026-06-24');
    assert.throws(() => parseFilter(new URLSearchParams({ from: '2026-06-23', to: '2026-09-21' }), Date.parse('2026-09-21T00:00:00Z')), /최대 90일/);
  } finally {
    if (previous === undefined) delete process.env.STATISTICS_RETENTION_DAYS;
    else process.env.STATISTICS_RETENTION_DAYS = previous;
  }
});

test('Azure 목록은 요청한 날짜 파티션만 조회한다', async () => {
  const requestedPrefixes = [];
  const source = createPlayFabAzureSource({
    storageAccount: 'gamestats', container: 'logs', prefix: 'data', sasToken: 'sig=test', titleId: 'LIVE',
    fetchImpl: async url => {
      const prefix = new URL(url).searchParams.get('prefix');
      requestedPrefixes.push(prefix);
      const dateKey = prefix.match(/date=(\d{8})/)?.[1];
      return new Response(`<EnumerationResults><Blobs><Blob><Name>data/title=LIVE/date=${dateKey}/hour=00/part.parquet</Name><Properties><Content-Length>123</Content-Length></Properties></Blob></Blobs><NextMarker /></EnumerationResults>`);
    }
  });
  const blobs = await source.listParquetBlobsForDates(['20260920', '20260921', '20260920', 'invalid']);
  assert.deepEqual(requestedPrefixes, ['data/title=LIVE/date=20260920/', 'data/title=LIVE/date=20260921/']);
  assert.deepEqual(blobs.map(blob => blob.dateKey), ['20260920', '20260921']);
});

test('ClickHouse 준비 확인은 아직 생성되지 않은 업무 DB를 지정하지 않는다', async () => {
  let requestedUrl = '';
  const client = createClickHouseClient({
    url: 'http://clickhouse.test:8123', database: 'not_created_yet',
    fetchImpl: async url => { requestedUrl = String(url); return new Response('1\n'); }
  });
  assert.equal(await client.ping(), true);
  assert.equal(new URL(requestedUrl).searchParams.has('database'), false);
});

test('ReplacingMergeTree 직접 적재는 일시 연결 실패를 같은 청크로 재시도한다', async () => {
  let attempts = 0;
  const client = createClickHouseClient({
    url: 'http://clickhouse.test:8123',
    fetchImpl: async () => {
      attempts += 1;
      if (attempts < 3) throw new TypeError('fetch failed');
      return new Response('');
    }
  });
  await client.insertRows('analytics_events', [{ event_id: 'retry-safe' }]);
  assert.equal(attempts, 3);
});

test('상태와 통계 조회도 일시 연결 실패를 재시도한다', async () => {
  let attempts = 0;
  const client = createClickHouseClient({
    url: 'http://clickhouse.test:8123',
    fetchImpl: async () => {
      attempts += 1;
      if (attempts < 3) throw new TypeError('fetch failed');
      return new Response(JSON.stringify({ data: [{ value: 1 }] }));
    }
  });
  assert.deepEqual(await client.rows('SELECT 1 AS value'), [{ value: 1 }]);
  assert.equal(attempts, 3);
});

test('장기 ClickHouse 명령은 fetch 헤더 제한 없이 명시한 쿼리 시간까지 기다린다', async t => {
  const server = http.createServer((req, res) => {
    req.resume();
    req.on('end', () => setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('done');
    }, 100));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const address = server.address();
  const client = createClickHouseClient({ url: `http://127.0.0.1:${address.port}`, timeoutMs: 1_000 });

  assert.equal(await client.request('SELECT 1'), 'done');
});

test('결과를 알 수 없는 ClickHouse 명령 실패는 중복 적재 위험 때문에 자동 재시도하지 않는다', async () => {
  let attempts = 0;
  const client = createClickHouseClient({
    url: 'http://clickhouse.test:8123',
    fetchImpl: async () => { attempts += 1; throw new TypeError('fetch failed'); }
  });

  await assert.rejects(client.command('INSERT INTO target SELECT * FROM source'), /fetch failed/);
  assert.equal(attempts, 1);
});

test('게시 상태는 완료 revision과 별도로 현재 실행 번호를 보존한다', () => {
  assert.deepEqual(normalizePublication({
    revision: 'ready-revision', run_id: '8a66935e-a11b-4f28-86d4-997dd6dd6171', status: 'running',
    started_at: '2026-09-28 06:00:00', completed_at: '2026-09-22 07:11:58', data_through: '2026-09-21 15:50:00',
    processed_blobs: '12', processed_events: '34', current_profile: '집계 중', error: ''
  }), {
    revision: 'ready-revision', runId: '8a66935e-a11b-4f28-86d4-997dd6dd6171', status: 'running', inProgress: true,
    startedAt: '2026-09-28 06:00:00', completedAt: '2026-09-22 07:11:58', dataThrough: '2026-09-21 15:50:00',
    processedBlobs: 12, processedEvents: 34, currentProfile: '집계 중', error: ''
  });
});

test('결과 문자열만 남은 레거시 팩트도 클리어와 사망으로 집계한다', async () => {
  const inserted = new Map();
  const client = { insertRows: async (table, rows) => inserted.set(table, rows) };
  const base = { timestamp: Date.parse('2026-09-16T00:00:00Z'), type: 'battleResult', version: '0.772.0' };
  await insertBlob(client, { name: 'legacy-index/test', dateKey: '20260916', byteLength: 123 }, [
    { ...base, id: 'clear', playerId: 'player-clear', resultType: 'Clear' },
    { ...base, id: 'dead', playerId: 'player-dead', resultType: 'Dead' },
    { ...base, id: 'fail', playerId: 'player-fail', resultType: 'Fail' }
  ], Date.parse('2026-09-22T00:00:00Z'));

  assert.deepEqual(inserted.get('analytics_events').map(row => [row.outcome, row.is_clear, row.is_dead]), [
    ['Clear', 1, 0],
    ['Dead', 0, 1],
    ['Fail', 0, 0]
  ]);

  const commands = [];
  await rebuildDay({ command: async sql => commands.push(sql) }, '2026-09-16', 'revision');
  assert.match(commands[0], /countIf\(is_clear = 1 OR outcome = 'Clear'\)/);
  assert.match(commands[0], /countIf\(is_dead = 1 OR outcome = 'Dead'\)/);
  assert.match(commands[1], /countIf\(is_clear = 1 OR outcome = 'Clear'\)/);
  assert.match(commands[1], /JSONExtractInt\(descriptor_json, 'id'\) BETWEEN 110 AND 119/);
  assert.match(commands[1], /uniqExact\(JSONExtractInt\(descriptor_json, 'id'\)\) >= 12/);
  assert.match(commands[1], /entity_type NOT IN \('nodes', 'nodeCombinations', 'combinationsWithNodes', 'combinationCollectionsWithNodes'\)/);
  for (const index of [1, 3, 5]) {
    assert.match(commands[index], /JSONExtractString\(descriptor_json, 'uniqueRuneState'\) != 'equipped'/);
    assert.match(commands[index], /JSONExtractInt\(part, 'id'\) = JSONExtractInt\(rune, 'weaponId'\)/);
    assert.match(commands[index], /JSONExtractString\(part, 'slot'\) = JSONExtractString\(rune, 'weaponSlot'\)/);
  }
  assert.match(commands[3], /JSONExtractInt\(descriptor_json, 'id'\) BETWEEN 110 AND 119/);
  assert.match(commands[5], /FROM analytics_boss_entities FINAL/);
  assert.match(commands[5], /entity_type NOT IN \('nodes', 'nodeCombinations', 'combinationsWithNodes'\)/);
});

test('계정 연동 이벤트는 사용자 지표 재료에 연동 상태를 보존한다', async () => {
  const inserted = new Map();
  const client = { insertRows: async (table, rows) => inserted.set(table, rows) };
  await insertBlob(client, { name: 'account-linked/test', dateKey: '20260916', byteLength: 123 }, [{
    id: 'linked-run', timestamp: Date.parse('2026-09-16T00:00:00Z'), type: 'battleResult',
    version: '0.772.0', playerId: 'linked-player', accountLinked: true, resultType: 'Clear', characterId: 0
  }], Date.parse('2026-09-22T00:00:00Z'));

  assert.equal(inserted.get('analytics_events')[0].account_linked, 1);
  assert.equal(inserted.get('analytics_entities').length > 0, true);
  assert.equal(inserted.get('analytics_entities').every(row => row.account_linked === 1), true);
});

test('여러 재집계 날짜는 한 번의 테이블별 쿼리로 처리한다', async () => {
  const commands = [];
  await rebuildDays({ command: async (sql, options) => commands.push({ sql, options }) }, ['2026-09-21', '2026-09-22'], 'revision');

  assert.equal(commands.length, 6);
  for (const command of commands) {
    assert.match(command.sql, /event_date IN \(\{date0:Date\}, \{date1:Date\}\)/);
    assert.deepEqual(command.options.params, { revision: 'revision', date0: '2026-09-21', date1: '2026-09-22' });
  }
});

test('사용자 지표만 어긋난 날짜는 플레이어 집계만 다시 만든다', async () => {
  const commands = [];
  await rebuildDays({ command: async sql => commands.push(sql) }, ['2026-07-01'], 'revision', { tables: ['players', 'user_entities'] });

  assert.equal(commands.length, 2);
  assert.match(commands[0], /INSERT INTO analytics_daily_players/);
  assert.match(commands[1], /INSERT INTO analytics_daily_user_entities/);
  assert.doesNotMatch(commands.join('\n'), /analytics_daily_boss_entities/);
});

test('재집계 날짜는 월 경계를 넘지 않는 최대 7일 배치로 제한한다', () => {
  assert.deepEqual(rebuildBatches([
    '2026-07-29', '2026-07-30', '2026-07-31',
    '2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08'
  ]), [
    ['2026-07-29', '2026-07-30', '2026-07-31'],
    ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07'],
    ['2026-08-08']
  ]);
});

test('이전 파이프라인으로 적재된 원본이 있으면 전체 원본을 다시 읽는다', async () => {
  const client = { rows: async (sql, options) => {
    assert.match(sql, /pipeline_revision !=/);
    assert.equal(Number.isInteger(options.params.pipelineRevision), true);
    return [{ outdated: 42 }];
  }};
  assert.equal(await requiresPipelineReplay(client), true);
});

test('여러 원본 조각은 테이블별 한 번의 저장 요청으로 묶어 적재한다', async () => {
  const calls = [];
  const client = { insertRows: async (table, rows) => calls.push({ table, rows }) };
  const event = id => ({
    id, timestamp: Date.parse('2026-09-16T00:00:00Z'), type: 'battleResult',
    version: '0.772.0', playerId: `player-${id}`, accountLinked: true, resultType: 'Clear', characterId: 0
  });
  await insertBlobs(client, [
    { blob: { name: 'batch/a', dateKey: '20260916', byteLength: 100 }, events: [event('a')] },
    { blob: { name: 'batch/b', dateKey: '20260916', byteLength: 200 }, events: [event('b')] }
  ], Date.parse('2026-09-22T00:00:00Z'));

  assert.deepEqual(calls.map(call => call.table), [
    'analytics_events', 'analytics_entities', 'analytics_boss_entities', 'analytics_ingested_blobs'
  ]);
  assert.equal(calls[0].rows.length, 2);
  assert.deepEqual(calls[3].rows.map(row => row.blob_name), ['batch/a', 'batch/b']);
});

test('최초 게시가 실패한 뒤 재시도하면 이미 적재된 전체 보존 기간을 다시 집계한다', () => {
  assert.equal(shouldReadAllRawDays({ full: false, activeRevision: '' }), true);
  assert.equal(shouldReadAllRawDays({ full: true, activeRevision: 'ready-revision' }), true);
  assert.equal(shouldReadAllRawDays({ full: false, activeRevision: 'ready-revision' }), false);
});

test('전체 갱신은 이전 게시 상태와 무관하게 90일 원본을 다시 읽는다', () => {
  const windowDays = ['20260919', '20260920', '20260921'];
  const coverageDays = new Set(['20260919']);
  assert.deepEqual(sourceDateKeysForRefresh({ full: true, hasCompletedPublication: true, windowDays, coverageDays, lookbackDays: 2 }), windowDays);
  assert.deepEqual(sourceDateKeysForRefresh({ full: false, hasCompletedPublication: true, windowDays, coverageDays, lookbackDays: 2 }), ['20260920', '20260921']);
  assert.deepEqual(sourceDateKeysForRefresh({ full: false, hasCompletedPublication: false, windowDays, coverageDays, lookbackDays: 2 }), ['20260920', '20260921']);
});

test('실패한 실행에서 원본과 기존 집계가 다른 날짜를 다음 실행에서 다시 집계한다', async () => {
  const client = { rows: async (sql, options) => {
    assert.match(sql, /FROM analytics_events FINAL/);
    assert.match(sql, /raw_runs != ifNull\(agg_runs, 0\)/);
    assert.match(sql, /raw_encounters != ifNull\(agg_encounters, 0\)/);
    assert.match(sql, /raw_kills != ifNull\(agg_kills, 0\)/);
    assert.match(sql, /raw_linked_players != ifNull\(agg_linked_players, 0\)/);
    assert.deepEqual(options.params, { revision: 'ready-revision', cutoff: '2026-07-01' });
    return [
      { date: '2026-07-01', rebuild_all: 0, rebuild_players: 1 },
      { date: '2026-08-21', rebuild_all: 1, rebuild_players: 1 },
      { date: '2026-09-28', rebuild_all: 1, rebuild_players: 1 }
    ];
  }};

  assert.deepEqual(await readAggregateRepairPlan(client, 'ready-revision', '2026-07-01'), {
    allDays: ['2026-08-21', '2026-09-28'],
    playerDays: ['2026-07-01', '2026-08-21', '2026-09-28']
  });
  assert.deepEqual(await readMismatchedAggregateDays(client, 'ready-revision', '2026-07-01'), ['2026-07-01', '2026-08-21', '2026-09-28']);
});

test('ClickHouse 적재는 레거시 후반 스테이지를 1챕터 중간보스 이후로 분류한다', () => {
  for (const stage of ['독성 늪지', 'Toxic Swamp', '니플헤임', 'Niflheim', '철혈의 요새', 'Fortress', '붉은 태양의 사막', 'Red Sun', '고대 도시 그랑펠', 'Granfel', '2-1', '1-Boss']) {
    assert.equal(reachedFirstMiddleBoss(stage), true, stage);
  }
  assert.equal(reachedFirstMiddleBoss('1-2'), false);
  assert.equal(reachedFirstMiddleBoss(''), false);
});

test('기존 90일 데이터가 있으면 실제 압축 용량을 기준으로 백필 여유를 계산한다', () => {
  assert.equal(estimateBackfillRequiredBytes({ existingBytes: 85, estimatedBytes: 438 }), 170);
  assert.equal(estimateBackfillRequiredBytes({ existingBytes: 0, estimatedBytes: 438 }), 876);
});

test('캐릭터 종속 빌드의 선택률은 해당 캐릭터 출정을 분모로 사용한다', () => {
  for (const type of ['skins', 'weapons', 'nodes', 'nodeCombinations', 'sinPoints']) {
    assert.equal(selectionRateScope(type), 'character');
  }
  for (const type of ['characters', 'pets', 'skills', 'artifacts', 'combinations']) {
    assert.equal(selectionRateScope(type), 'global');
  }
});

test('노드 선택률 분모는 110번대 최종 노드가 있는 완성 조합 출정만 사용한다', async () => {
  const queries = [];
  const client = { rows: async sql => {
    queries.push(sql);
    if (sql.includes('FROM analytics_publication')) return [{
      revision: 'ready-revision', status: 'ready', completed_at: '2026-09-22 01:00:00',
      data_through: '2026-09-22 00:50:00', processed_blobs: 1, processed_events: 1,
      current_profile: '', error: ''
    }];
    return [];
  }};
  const statistics = createClickHouseStatistics({ client, now: () => Date.parse('2026-09-22T02:00:00Z') });
  await statistics.builds('nodes', new URLSearchParams({ from: '2026-09-16', to: '2026-09-22' }));
  const query = queries.find(sql => sql.includes('WITH grouped AS'));
  assert.match(query, /entity_type = 'nodeCombinations'/);
  assert.match(query, /JSONLength\(descriptor_json, 'nodes'\) >= 12/);
  assert.match(query, /JSONExtractInt\(node, 'id'\) BETWEEN 110 AND 119/);
  assert.match(query, /GROUP BY character_key/);
});

test('노드 선택률은 같은 선택 단계끼리 정확히 100%가 되고 100%를 넘지 않는다', () => {
  const nodes = normalizeNodeSelectionRates([
    { id: 0, runs: 29_000, selectionRate: 375.8 },
    { id: 10, runs: 12_719, selectionRate: 164.8 },
    { id: 11, runs: 8_000, selectionRate: 103.7 },
    { id: 12, runs: 5_281, selectionRate: 68.4 },
    { id: 999, runs: 1_000, selectionRate: 200 }
  ], 7_716);

  assert.equal(nodes.find(node => node.id === 0).selectionRate, 100);
  assert.equal(nodes.filter(node => [10, 11, 12].includes(node.id)).reduce((sum, node) => sum + node.selectionRate, 0), 100);
  assert.equal(nodes.every(node => node.selectionRate <= 100), true);
  assert.equal(nodes.find(node => node.id === 999).selectionRate, 13);
});

test('개별 노드 상세 선택률도 같은 선택 단계 합계를 분모로 사용한다', async () => {
  const client = { rows: async sql => {
    if (sql.includes('FROM analytics_publication')) return [{ revision: 'ready-revision', status: 'ready', completed_at: '2026-09-22 01:00:00' }];
    if (sql.includes('intDiv(JSONExtractInt')) return [
      { key: 'id:0|node:id:10', runs: 30 }, { key: 'id:0|node:id:11', runs: 20 }, { key: 'id:0|node:id:12', runs: 50 }
    ];
    if (sql.includes('selected_boss_events') || sql.includes('entity AS (')) return [];
    if (sql.includes('AND entity_type = {entityType:String} AND entity_key = {key:String}')) return [{
      key: 'id:0|node:id:10', character_key: 'id:0', name: '완벽한 공격', descriptor: '{"id":10,"name":"완벽한 공격"}',
      runs: 300, clears: 90, players: 100, play_time: [600000, 1200000], selection_rate: 389, clear_rate: 30
    }];
    return [];
  }};
  const statistics = createClickHouseStatistics({ client, now: () => Date.parse('2026-09-22T02:00:00Z') });
  const result = await statistics.buildDetail('nodes', 'id:0|node:id:10', new URLSearchParams({ from: '2026-09-16', to: '2026-09-22' }));
  assert.equal(result.item.selectionRate, 30);
});

test('캐릭터 상세 구성은 종류별 상한을 적용해 노드 조합이 일반 조합에 밀리지 않는다', async () => {
  const queries = [];
  const client = {
    rows: async sql => {
      queries.push(sql);
      if (sql.includes('FROM analytics_publication')) return [{
        revision: 'ready-revision', status: 'ready', started_at: '2026-09-22 00:00:00',
        completed_at: '2026-09-22 01:00:00', data_through: '2026-09-22 00:50:00',
        processed_blobs: 1, processed_events: 1, current_profile: '', error: ''
      }];
      if (sql.includes('WITH character_total AS')) return [{
        type: 'nodeCombinations', key: 'id:0|node-set:id:0|node:id:10',
        name: '기사 · 완벽한 공격', descriptor: JSON.stringify({
          character: { id: 0, key: 'id:0', name: '기사' },
          nodes: [{ id: 10, key: 'id:0|node:id:10', name: '완벽한 공격' }]
        }), runs: 25, clears: 5, players: 20, clear_rate: 20, selection_rate: 12.5
      }];
      if (sql.includes('entity AS (')) return [];
      if (sql.includes('AND entity_type = {entityType:String} AND entity_key = {key:String}')) return [{
        key: 'id:0', name: '기사', descriptor: JSON.stringify({ id: 0, key: 'id:0', name: '기사' }),
        runs: 200, clears: 40, players: 100, play_time: [600000, 1200000], selection_rate: 30, clear_rate: 20
      }];
      return [];
    }
  };
  const statistics = createClickHouseStatistics({ client, now: () => Date.parse('2026-09-22T02:00:00Z') });
  const result = await statistics.buildDetail('characters', 'id:0', new URLSearchParams({ from: '2026-09-16', to: '2026-09-22' }));

  assert.equal(result.item.components.nodeCombinations.length, 1);
  const componentQuery = queries.find(sql => sql.includes('WITH character_total AS'));
  assert.match(componentQuery, /complete_node_total AS/);
  assert.match(componentQuery, /entity_type = 'nodeCombinations'/);
  assert.match(componentQuery, /JSONLength\(descriptor_json, 'nodes'\) >= 12/);
  assert.match(componentQuery, /JSONExtractInt\(part, 'id'\) = JSONExtractInt\(rune, 'weaponId'\)/);
  assert.match(componentQuery, /NOT match\(descriptor_json, 'node:name:-\?\[0-9\]\+'\)/);
  assert.match(componentQuery, /LIMIT 160 BY type/);
});

test('항목 상세는 마지막 보스 평균 처치 시간과 종류별 연관 통계를 제공한다', async () => {
  const queries = [];
  const client = { rows: async (sql, options = {}) => {
    queries.push({ sql, params: options.params || {} });
    if (sql.includes('FROM analytics_publication')) return [{
      revision: 'ready-revision', status: 'ready', completed_at: '2026-09-22 01:00:00',
      data_through: '2026-09-22 00:50:00', processed_blobs: 1, processed_events: 1,
      current_profile: '', error: ''
    }];
    if (sql.includes('selected_boss_events')) return [
      { boss_code: 'B302', average_ms: 65_432, kills: 12 },
      { boss_code: 'B504', average_ms: 123_456, kills: 7 }
    ];
    if (sql.includes("'collectionIds'")) return [{ collection_id: 6, uses: 30 }];
    if (sql.includes("entity_type IN ('characters', 'weapons', 'skills', 'artifacts')")) return [
      { type: 'characters', key: 'id:0', name: '기사', descriptor: '{"id":0,"name":"기사"}', runs: 40 },
      { type: 'weapons', key: 'id:0', name: '철검', descriptor: '{"id":0,"name":"철검"}', runs: 35 },
      { type: 'skills', key: 'id:1', name: '니플헤임 검술', descriptor: '{"id":1,"name":"니플헤임 검술"}', runs: 20 },
      { type: 'artifacts', key: 'id:2', name: '용의 오의', descriptor: '{"id":2,"name":"용의 오의"}', runs: 10 }
    ];
    if (sql.includes('entity AS (')) return [];
    if (sql.includes('AND entity_type = {entityType:String} AND entity_key = {key:String}')) return [{
      key: 'id:1', name: '어비시우스', descriptor: '{"id":1,"name":"어비시우스"}',
      runs: 100, clears: 25, players: 60, play_time: [600000, 1200000], selection_rate: 20, clear_rate: 25
    }];
    return [];
  }};
  const statistics = createClickHouseStatistics({ client, now: () => Date.parse('2026-09-22T02:00:00Z') });
  const result = await statistics.buildDetail('pets', 'id:1', new URLSearchParams({ from: '2026-09-16', to: '2026-09-22' }));

  assert.deepEqual(result.item.insights.bossKillTimes.map(value => [value.code, value.averageMs, value.kills]), [
    ['B302', 65_432, 12], ['B504', 123_456, 7]
  ]);
  assert.equal(result.item.insights.synergies[0].name, '방화광');
  assert.equal(result.item.insights.synergies[0].usageRate, 30);
  assert.equal(result.item.insights.related.characters[0].usageRate, 40);
  assert.equal(result.item.insights.related.artifacts[0].usageRate, 10);
  const relationQuery = queries.find(query => query.sql.includes("entity_type IN ('characters', 'weapons', 'skills', 'artifacts')"));
  assert.equal(relationQuery.params.relatedTypes, undefined);
  assert.match(queries.find(query => query.sql.includes('selected_boss_events')).sql, /fight_duration_ms > 0/);
});

test('유저 지표는 계정 연동 UID만 기간 내 한 번 집계하고 원본 UID를 반환하지 않는다', async () => {
  const queries = [];
  const client = { rows: async sql => {
    queries.push(sql);
    if (sql.includes('FROM analytics_publication')) return [{
      revision: 'ready-revision', status: 'ready', started_at: '2026-09-22 00:00:00',
      completed_at: '2026-09-22 01:00:00', data_through: '2026-09-22 00:50:00',
      processed_blobs: 1, processed_events: 1, current_profile: '', error: ''
    }];
    if (sql.includes('FROM analytics_daily_user_entities')) return [{
      type: 'characters', key: 'id:0', name: '기사', descriptor: '{"id":0,"name":"기사"}',
      users: 40, total_users: 100, usage_rate: 40
    }];
    if (sql.includes('ARRAY JOIN')) return [1, 2, 3, 4].map(chapter => ({ chapter, users: 110 - chapter * 10 }));
    if (sql.includes('retired_users')) return [{ level: 1, retired_users: 20 }, { level: 2, retired_users: 80 }];
    if (sql.includes("first_play_time_ms = 0")) return [{ bucket: '0_5m', users: 50, one_run_users: 25 }];
    if (sql.includes('linked_users')) return [{ linked_users: 100, runs: 250, one_run_users: 40, average_runs: 2.5, unknown_chapter_users: 5 }];
    return [];
  }};
  const statistics = createClickHouseStatistics({ client, now: () => Date.parse('2026-09-22T02:00:00Z') });
  const result = await statistics.users(new URLSearchParams({ from: '2026-09-16', to: '2026-09-22', afterFirstMiddleBoss: '1' }));
  assert.equal(result.accountLinkedOnly, true);
  assert.equal(result.filter.afterFirstMiddleBoss, false);
  assert.equal(result.summary.uniqueUsers, 100);
  assert.equal(result.usage.characters[0].usageRate, 40);
  assert.equal(result.chapters[3].reachRate, 70);
  assert.equal(result.levels[0].reachedUsers, 100);
  assert.equal(result.firstPlay[0].exitRate, 50);
  assert.doesNotMatch(JSON.stringify(result), /player_hash|EntityLineage|master_player_account/);
  assert.equal(queries.filter(sql => sql.includes('account_linked = 1')).length >= 2, true);
  const summaryQuery = queries.find(sql => sql.includes('linked_users'));
  assert.match(summaryQuery, /sum\(runs\) run_count/);
  assert.match(summaryQuery, /sum\(run_count\) runs/);
  assert.match(queries.find(sql => sql.includes("first_play_time_ms = 0")), /countIf\(run_count = 1\)/);
});
