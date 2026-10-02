import crypto from 'node:crypto';
import { describeAnalyticsBuild } from './playfab-analytics.js';
import { getCollectionMeta } from './collection-data.js';
import { CLICKHOUSE_SCHEMA_REVISION, readRetentionDays } from './clickhouse-schema.js';

const ENTITY_TYPES = ['characters', 'skins', 'weapons', 'pets', 'nodes', 'nodeCombinations', 'skills', 'artifacts', 'sinPoints', 'combinations', 'combinationsWithNodes'];
const BLOB_INSERT_BATCH_SIZE = 12;
const BLOB_READ_PARALLELISM = 2;
const VALID_WEAPON_RUNE_SQL = `(entity_type != 'weapons'
  OR JSONExtractString(descriptor_json, 'uniqueRuneState') != 'equipped'
  OR arrayAll(
    rune -> arrayExists(
      part -> JSONExtractInt(part, 'id') = JSONExtractInt(rune, 'weaponId')
        AND JSONExtractString(part, 'slot') = JSONExtractString(rune, 'weaponSlot'),
      JSONExtractArrayRaw(descriptor_json, 'parts')
    ),
    JSONExtractArrayRaw(descriptor_json, 'uniqueRunes')
  ))`;

export function createClickHouseIngestor({ client, source, legacySource = null, now = () => Date.now(), concurrency = 4 }) {
  async function publicationState() {
    const [row] = await client.rows(`
      SELECT revision, run_id, status, started_at, completed_at, data_through,
             processed_blobs, processed_events, current_profile, error, updated_at
      FROM analytics_publication FINAL ORDER BY updated_at DESC LIMIT 1
    `);
    return normalizePublication(row);
  }

  async function refresh({ full = false, onProgress = () => {}, runId = crypto.randomUUID() } = {}) {
    const retentionDays = readRetentionDays();
    const windowDays = retentionDateKeys(now(), retentionDays);
    const retainedDaySet = new Set(windowDays);
    const cutoffDate = dateKeyToIso(windowDays[0]);
    const targetRevision = runId;
    const startedAt = clickHouseDateTime(now());
    const previous = await publicationState();
    const activeRevision = previous.completedAt ? previous.revision : '';
    let processedBlobs = 0;
    let processedEvents = 0;
    await writePublication({ revision: activeRevision, runId, status: 'running', startedAt, completedAt: previous.completedAt, dataThrough: previous.dataThrough, currentProfile: 'Azure 원본 목록 확인' });
    try {
      const legacyState = legacySource?.configured ? legacySource.state() : { configured: false, days: [], rows: 0 };
      const retainedLegacyDays = legacyState.days.filter(day => retainedDaySet.has(day));
      const retainedLegacyRows = (legacyState.dayRows || []).filter(row => retainedDaySet.has(row.dateKey)).reduce((sum, row) => sum + row.rowCount, 0);
      const ingested = full ? new Map() : await readIngestedBlobs(client);
      const pipelineReplay = !full && await requiresPipelineReplay(client);
      const coverageDays = new Set(await readLegacyCoverage(client));
      await recoverLegacyCoverage(client, legacyState, coverageDays, now());
      const completedLegacyRows = (legacyState.dayRows || [])
        .filter(row => retainedDaySet.has(row.dateKey) && coverageDays.has(row.dateKey))
        .reduce((sum, row) => sum + row.rowCount, 0);
      const affectedDays = new Set();
      const missingLegacyDays = retainedLegacyDays.filter(day => !coverageDays.has(day));
      if (missingLegacyDays.length) {
        for (const day of missingLegacyDays) {
          await legacySource.scanBatches(async batch => {
            const blob = { name: `legacy-index/date=${batch.dateKey}/batch-${String(batch.batchIndex).padStart(6, '0')}.ndjson`, dateKey: batch.dateKey, byteLength: batch.byteLength };
            await insertBlob(client, blob, batch.events, now());
            affectedDays.add(dateKeyToIso(batch.dateKey)); processedBlobs += 1; processedEvents += batch.events.length;
            if (processedBlobs % 10 === 0) {
              const completed = completedLegacyRows + processedEvents;
              const ratio = retainedLegacyRows ? Math.min(100, completed / retainedLegacyRows * 100) : 100;
              const currentProfile = `기존 정규화 이력 이전 ${completed.toLocaleString()} / ${retainedLegacyRows.toLocaleString()}건 · ${ratio.toFixed(1)}%`;
              onProgress({ revision: activeRevision, targetRevision, processedBlobs, processedEvents, currentProfile });
              await writePublication({ revision: activeRevision, runId, status: 'running', startedAt, completedAt: previous.completedAt, dataThrough: previous.dataThrough, processedBlobs, processedEvents, currentProfile });
            }
          }, { days: [day], concurrency: Math.min(6, Math.max(1, concurrency)) });
          await markLegacyCoverage(client, [day], now());
          coverageDays.add(day);
        }
      }
      const lookbackDays = readLookbackDays();
      const sourceDateKeys = sourceDateKeysForRefresh({
        full: full || pipelineReplay,
        hasCompletedPublication: Boolean(previous.completedAt),
        windowDays,
        coverageDays,
        lookbackDays
      });
      const allBlobs = await listSourceBlobs(source, sourceDateKeys);
      if (full || !previous.completedAt) await assertCapacity(client, allBlobs, { rows: retainedLegacyRows });
      const pending = allBlobs.filter(blob => ingested.get(blob.name) !== Number(blob.byteLength || 0));
      await writePublication({ revision: activeRevision, runId, status: 'running', startedAt, completedAt: previous.completedAt, dataThrough: previous.dataThrough, processedBlobs, processedEvents, currentProfile: `원본 로그 적재 0 / ${pending.length}` });
      let next = 0;
      const workers = Array.from({ length: Math.min(Math.max(1, concurrency), Math.max(1, pending.length)) }, async () => {
        while (next < pending.length) {
          const batch = pending.slice(next, next + BLOB_INSERT_BATCH_SIZE);
          next += batch.length;
          const entries = [];
          for (let offset = 0; offset < batch.length; offset += BLOB_READ_PARALLELISM) {
            const group = batch.slice(offset, offset + BLOB_READ_PARALLELISM);
            entries.push(...await Promise.all(group.map(async blob => ({ blob, events: await source.readEvents(blob) }))));
          }
          await insertBlobs(client, entries, now());
          for (const { blob, events } of entries) {
            affectedDays.add(dateKeyToIso(blob.dateKey));
            processedBlobs += 1;
            processedEvents += events.length;
          }
          const currentProfile = `원본 로그 적재 ${processedBlobs} / ${pending.length}`;
          onProgress({ revision: activeRevision, targetRevision, processedBlobs, processedEvents, totalBlobs: pending.length, currentProfile });
          if (processedBlobs % Math.max(1, concurrency) === 0 || processedBlobs === pending.length) {
            await writePublication({ revision: activeRevision, runId, status: 'running', startedAt, completedAt: previous.completedAt, dataThrough: previous.dataThrough, processedBlobs, processedEvents, currentProfile });
          }
        }
      });
      await Promise.all(workers);

      // 최초 게시 전 재시도에서는 원본 적재가 이미 끝난 날짜가 affectedDays에
      // 다시 들어오지 않는다. 이때 변경분만 집계하면 기존 원본 날짜가 누락되어
      // 최종 원본/집계 건수 검증이 실패하므로 보존 기간 전체를 다시 구성한다.
      const rebuildAll = shouldReadAllRawDays({ full, activeRevision });
      const repairPlan = activeRevision && !rebuildAll
        ? await readAggregateRepairPlan(client, activeRevision, cutoffDate)
        : { allDays: [], playerDays: [] };
      const rawDays = rebuildAll ? await readRawDays(client, cutoffDate) : [];
      const allDays = [...new Set(rebuildAll ? rawDays : [...affectedDays, ...repairPlan.allDays])].sort();
      const playerDays = [...new Set(rebuildAll ? rawDays : [...allDays, ...repairPlan.playerDays])].sort();
      const allDaySet = new Set(allDays);
      const playerOnlyDays = playerDays.filter(day => !allDaySet.has(day));
      if (!allDays.length && !playerOnlyDays.length && activeRevision) {
        const completedAt = clickHouseDateTime(now());
        await writePublication({ revision: activeRevision, runId, status: 'ready', startedAt, completedAt, dataThrough: previous.dataThrough, processedBlobs, processedEvents, currentProfile: '' });
        return publicationState();
      }
      if (activeRevision && !full) await copyUnaffectedAggregates(client, activeRevision, targetRevision, { allDays, playerDays }, cutoffDate);
      let rebuiltDays = 0;
      for (const batch of rebuildBatches(allDays, 1)) {
        const currentProfile = `일별 분석 집계 ${rebuiltDays + 1}-${rebuiltDays + batch.length} / ${allDays.length}`;
        onProgress({ revision: activeRevision, targetRevision, processedBlobs, processedEvents, currentProfile });
        await writePublication({ revision: activeRevision, runId, status: 'running', startedAt, completedAt: previous.completedAt, dataThrough: previous.dataThrough, processedBlobs, processedEvents, currentProfile });
        await rebuildDays(client, batch, targetRevision);
        rebuiltDays += batch.length;
      }
      let rebuiltPlayerDays = 0;
      for (const batch of rebuildBatches(playerOnlyDays, 3)) {
        const currentProfile = `사용자 지표 집계 ${rebuiltPlayerDays + 1}-${rebuiltPlayerDays + batch.length} / ${playerOnlyDays.length}`;
        onProgress({ revision: activeRevision, targetRevision, processedBlobs, processedEvents, currentProfile });
        await writePublication({ revision: activeRevision, runId, status: 'running', startedAt, completedAt: previous.completedAt, dataThrough: previous.dataThrough, processedBlobs, processedEvents, currentProfile });
        await rebuildDays(client, batch, targetRevision, { tables: ['players', 'user_entities'] });
        rebuiltPlayerDays += batch.length;
      }

      await validateRevision(client, targetRevision, cutoffDate);

      const dataThrough = await readDataThrough(client, cutoffDate) || previous.dataThrough || clickHouseDateTime(now());
      const completedAt = clickHouseDateTime(now());
      await writePublication({ revision: targetRevision, runId, status: 'ready', startedAt, completedAt, dataThrough, processedBlobs, processedEvents, currentProfile: '' });
      await cleanupAggregateRevisions(client, [targetRevision]);
      return publicationState();
    } catch (error) {
      await writePublication({ revision: activeRevision, runId, status: 'error', startedAt, completedAt: previous.completedAt, dataThrough: previous.dataThrough, processedBlobs, processedEvents, currentProfile: '', error: String(error?.message || error) });
      if (activeRevision) await cleanupAggregateRevisions(client, [activeRevision]);
      throw error;
    }
  }

  async function writePublication({
    revision, runId = null, status, startedAt = null, completedAt = null, dataThrough = null,
    processedBlobs = 0, processedEvents = 0, currentProfile = '', error = ''
  }) {
    await client.insertRows('analytics_publication', [{
      revision, run_id: runId || '', status, started_at: startedAt, completed_at: completedAt, data_through: dataThrough,
      processed_blobs: processedBlobs, processed_events: processedEvents,
      current_profile: currentProfile, error, updated_at: clickHouseDateTime(now())
    }]);
  }

  return { refresh, publicationState };
}

export function shouldReadAllRawDays({ full = false, activeRevision = '' } = {}) {
  return full || !activeRevision;
}

export function sourceDateKeysForRefresh({ full = false, hasCompletedPublication = false, windowDays = [], coverageDays = new Set(), lookbackDays = 2 } = {}) {
  if (full) return [...windowDays];
  return hasCompletedPublication
    ? windowDays.slice(-lookbackDays)
    : windowDays.filter(day => !coverageDays.has(day));
}

async function insertBlob(client, blob, events, nowMs) {
  return insertBlobs(client, [{ blob, events }], nowMs);
}

export async function insertBlobs(client, entries, nowMs) {
  const prepared = entries.map(({ blob, events }) => prepareBlobRows(blob, events, clickHouseDateTime(nowMs)));
  await client.insertRows('analytics_events', prepared.flatMap(value => value.eventRows), { chunkSize: 10_000 });
  await client.insertRows('analytics_entities', prepared.flatMap(value => value.entityRows), { chunkSize: 20_000 });
  await client.insertRows('analytics_boss_entities', prepared.flatMap(value => value.bossEntityRows), { chunkSize: 20_000 });
  await client.insertRows('analytics_ingested_blobs', prepared.map(value => value.ingestedBlob));
}

function prepareBlobRows(blob, events, ingestedAt) {
  const eventRows = [];
  const entityRows = [];
  const bossEntityRows = [];
  for (const event of events) {
    const shared = sharedRow(event, ingestedAt);
    const build = describeAnalyticsBuild(event, { includeNodes: true });
    // 이전 SQLite 팩트에는 정규화된 resultType은 남아 있지만 isClear/isDead가
    // 포함되지 않았다. 결과 문자열을 함께 사용해야 과거 이관 데이터의
    // 클리어·사망 분자가 0으로 떨어지지 않는다.
    const isClear = event.isClear === true || event.resultType === 'Clear';
    const isDead = event.isDead === true || event.resultType === 'Dead';
    eventRows.push({
      event_id: event.id, source_blob: blob.name, event_time: clickHouseDateTime(event.timestamp),
      ...shared,
      event_type: event.type, run_id: event.runId || '', schema_era: event.schemaEra || '',
      outcome: event.resultType || '', is_clear: isClear ? 1 : 0, is_dead: isDead ? 1 : 0,
      play_time_ms: nonnegative(event.playTimeMs), stage: event.stage || '', chapter: progressChapter(event), encounter_id: event.encounterId || '',
      boss_key: event.bossKey || '', boss_name: event.bossName || '', boss_rank: event.bossRank || '',
      fight_duration_ms: nonnegative(event.fightDurationMs),
      descriptor_json: JSON.stringify({ characterId: event.characterId, collectionIds: event.collectionIds || [] }),
      ingested_at: ingestedAt
    });

    const characterKey = build.characters?.[0]?.key || '';
    for (const type of ENTITY_TYPES) {
      for (const descriptor of build[type] || []) {
        const row = {
          event_id: event.id, event_time: clickHouseDateTime(event.timestamp), ...shared,
          outcome: event.resultType || '', is_clear: isClear ? 1 : 0,
          play_time_ms: nonnegative(event.playTimeMs), character_key: characterKey,
          entity_type: type, entity_key: descriptor.aggregateKey || descriptor.key || '',
          entity_name: descriptor.name || '', source: event.schemaEra === 'legacy' ? 'name' : 'id',
          descriptor_json: JSON.stringify(descriptor),
          ingested_at: ingestedAt
        };
        if (event.type === 'battleResult') entityRows.push(row);
        else bossEntityRows.push({
          event_id: row.event_id, event_time: row.event_time, player_hash: row.player_hash,
          version: row.version, version_family: row.version_family, platform: row.platform,
          game_mode: row.game_mode, mode_level: row.mode_level, after_first_middle: 1,
          encounter_id: event.encounterId || '', boss_key: event.bossKey || '', event_kind: event.type,
          character_key: row.character_key, entity_type: row.entity_type, entity_key: row.entity_key,
          entity_name: row.entity_name, descriptor_json: row.descriptor_json, ingested_at: ingestedAt
        });
      }
    }
    if (event.type === 'battleResult') {
      for (const combination of [...(build.combinations || []), ...(build.combinationsWithNodes || [])]) {
        for (const collectionId of [...new Set(event.collectionIds || [])]) {
          const meta = getCollectionMeta(collectionId);
          entityRows.push({
            event_id: event.id, event_time: clickHouseDateTime(event.timestamp), ...shared,
            outcome: event.resultType || '', is_clear: isClear ? 1 : 0,
            play_time_ms: nonnegative(event.playTimeMs), character_key: characterKey,
            entity_type: combination.includesNodes ? 'combinationCollectionsWithNodes' : 'combinationCollections',
            entity_key: `${combination.key}|collection:${collectionId}`,
            entity_name: meta?.name || `컬렉션 ${collectionId}`, source: 'id',
            descriptor_json: JSON.stringify({ combinationKey: combination.key, collectionId, name: meta?.name || `컬렉션 ${collectionId}`, effect: meta?.effect || '' }),
            ingested_at: ingestedAt
          });
        }
      }
    }
  }
  return { eventRows, entityRows, bossEntityRows, ingestedBlob: {
    blob_name: blob.name, byte_length: blob.byteLength || 0, event_date: dateKeyToIso(blob.dateKey),
    event_count: events.length, pipeline_revision: CLICKHOUSE_SCHEMA_REVISION, ingested_at: ingestedAt
  }};
}

function sharedRow(event, ingestedAt) {
  return {
    player_hash: hash64(event.playerId), account_linked: event.accountLinked === true ? 1 : 0,
    version: event.version || '', version_family: versionFamily(event.version),
    platform: event.platform || '', game_mode: event.mode || '', mode_level: Number.isInteger(event.modeLevel) ? event.modeLevel : -1,
    after_first_middle: event.type === 'battleResult' ? (event.reachedFirstMiddleBoss === true || reachedFirstMiddleBoss(event.stage) ? 1 : 0) : 1,
    ingested_at: ingestedAt
  };
}

async function readIngestedBlobs(client) {
  const rows = await client.rows('SELECT blob_name, argMax(byte_length, ingested_at) AS byte_length FROM analytics_ingested_blobs WHERE pipeline_revision = {pipelineRevision:UInt32} GROUP BY blob_name', { params: { pipelineRevision: CLICKHOUSE_SCHEMA_REVISION }, timeout: 120_000 });
  return new Map(rows.map(row => [row.blob_name, Number(row.byte_length)]));
}

export async function requiresPipelineReplay(client) {
  const [row] = await client.rows(`
    SELECT countIf(pipeline_revision != {pipelineRevision:UInt32} AND NOT startsWith(blob_name, 'legacy-')) AS outdated
    FROM analytics_ingested_blobs FINAL
  `, { params: { pipelineRevision: CLICKHOUSE_SCHEMA_REVISION }, timeout: 120_000 });
  return Number(row?.outdated || 0) > 0;
}

async function assertCapacity(client, blobs, legacyState = {}) {
  const estimatedEventCount = Number(legacyState.rows || 0) + Math.ceil(blobs.reduce((sum, blob) => sum + Number(blob.byteLength || 0), 0) / 40_000);
  const bytesPerEvent = Math.max(1_000, Number(process.env.STATISTICS_ESTIMATED_BYTES_PER_EVENT || 10_000));
  const estimatedBytes = estimatedEventCount * bytesPerEvent;
  const [usage] = await client.rows(`
    SELECT sum(bytes_on_disk) AS bytes
    FROM system.parts
    WHERE active AND database = currentDatabase()
  `);
  const existingBytes = Number(usage?.bytes || 0);
  const [disk] = await client.rows("SELECT free_space, total_space FROM system.disks WHERE name = 'default' LIMIT 1");
  if (!disk) return;
  const free = Number(disk.free_space || 0);
  // 이미 같은 90일 범위가 적재된 운영 DB에서는 실제 압축 후 사용량이
  // 가장 정확한 백필 기준이다. 최초 적재일 때만 원본 파일 기반 추정치를 쓴다.
  const required = estimateBackfillRequiredBytes({ existingBytes, estimatedBytes });
  if (free < required) throw new Error(`ClickHouse 백필 공간이 부족합니다. 필요 약 ${formatBytes(required)}, 사용 가능 ${formatBytes(free)}.`);
}

export function estimateBackfillRequiredBytes({ existingBytes = 0, estimatedBytes = 0 } = {}) {
  const baseline = existingBytes > 0 ? existingBytes : estimatedBytes;
  return Math.ceil(Math.max(0, Number(baseline) || 0) * 2);
}

async function readLegacyCoverage(client) { const rows = await client.rows("SELECT replaceRegexpOne(blob_name, '^legacy-coverage:', '') day FROM analytics_ingested_blobs FINAL WHERE startsWith(blob_name, 'legacy-coverage:')"); return rows.map(row => String(row.day)); }
async function markLegacyCoverage(client, days, nowMs) { if (!days.length) return; const ingestedAt = clickHouseDateTime(nowMs); await client.insertRows('analytics_ingested_blobs', days.map(day => ({ blob_name: `legacy-coverage:${day}`, byte_length: 0, event_date: dateKeyToIso(day), event_count: 0, pipeline_revision: CLICKHOUSE_SCHEMA_REVISION, ingested_at: ingestedAt }))); }

async function recoverLegacyCoverage(client, legacyState, coverageDays, nowMs) {
  if (!legacyState?.configured || !legacyState.dayRows?.length) return;
  const expected = new Map(legacyState.dayRows.map(row => [String(row.dateKey), Number(row.rowCount || 0)]));
  const rows = await client.rows(`
    SELECT replaceAll(toString(event_date), '-', '') day, count() rows
    FROM analytics_events FINAL
    WHERE startsWith(source_blob, 'legacy-index/')
    GROUP BY event_date
  `, { timeout: 600_000 });
  const recovered = rows
    .filter(row => !coverageDays.has(String(row.day)) && expected.get(String(row.day)) === Number(row.rows))
    .map(row => String(row.day));
  if (!recovered.length) return;
  await markLegacyCoverage(client, recovered, nowMs);
  for (const day of recovered) coverageDays.add(day);
}

async function readRawDays(client, cutoffDate) {
  const rows = await client.rows('SELECT DISTINCT toString(event_date) date FROM analytics_events WHERE event_date >= {cutoff:Date} ORDER BY date', { params: { cutoff: cutoffDate }, timeout: 120_000 });
  return rows.map(row => String(row.date));
}

export async function readAggregateRepairPlan(client, revision, cutoffDate) {
  const rows = await client.rows(`
    WITH raw AS (
      SELECT event_date,
             countIf(event_type = 'battleResult') raw_runs,
             countIf(event_type = 'bossEncounter') raw_encounters,
             countIf(event_type = 'bossKill') raw_kills,
             uniqExactIf(player_hash, event_type = 'battleResult' AND account_linked = 1) raw_linked_players
      FROM analytics_events FINAL
      WHERE event_date >= {cutoff:Date}
      GROUP BY event_date
    ), run_agg AS (
      SELECT event_date, sum(runs) agg_runs
      FROM analytics_daily_runs
      WHERE revision = {revision:String} AND event_date >= {cutoff:Date}
      GROUP BY event_date
    ), boss_agg AS (
      SELECT event_date, sum(encounters) agg_encounters, sum(kills) agg_kills
      FROM analytics_daily_bosses
      WHERE revision = {revision:String} AND event_date >= {cutoff:Date}
      GROUP BY event_date
    ), player_agg AS (
      SELECT event_date, uniqExactIf(player_hash, account_linked = 1) agg_linked_players
      FROM analytics_daily_players
      WHERE revision = {revision:String} AND event_date >= {cutoff:Date}
      GROUP BY event_date
    )
    SELECT toString(raw.event_date) date,
           (raw_runs != ifNull(agg_runs, 0)
             OR raw_encounters != ifNull(agg_encounters, 0)
             OR raw_kills != ifNull(agg_kills, 0)) rebuild_all,
           raw_linked_players != ifNull(agg_linked_players, 0) rebuild_players
    FROM raw
    LEFT JOIN run_agg USING event_date
    LEFT JOIN boss_agg USING event_date
    LEFT JOIN player_agg USING event_date
    ORDER BY date
  `, { params: { revision, cutoff: cutoffDate }, timeout: 600_000 });
  return {
    allDays: rows.filter(row => Number(row.rebuild_all) > 0).map(row => String(row.date)),
    playerDays: rows.filter(row => Number(row.rebuild_players) > 0).map(row => String(row.date))
  };
}

export async function readMismatchedAggregateDays(client, revision, cutoffDate) {
  const plan = await readAggregateRepairPlan(client, revision, cutoffDate);
  return [...new Set([...plan.allDays, ...plan.playerDays])].sort();
}

async function readDataThrough(client, cutoffDate) {
  const [row] = await client.rows('SELECT max(event_time) data_through FROM analytics_events WHERE event_date >= {cutoff:Date}', { params: { cutoff: cutoffDate }, timeout: 120_000 });
  return row?.data_through || null;
}

async function listSourceBlobs(source, dateKeys) {
  if (!dateKeys.length) return [];
  if (typeof source.listParquetBlobsForDates === 'function') return source.listParquetBlobsForDates(dateKeys);
  const allowed = new Set(dateKeys);
  return (await source.listAllParquetBlobs()).filter(blob => allowed.has(blob.dateKey));
}

async function rebuildDay(client, date, revision) {
  return rebuildDays(client, [date], revision);
}

export async function rebuildDays(client, dates, revision, { tables = ['runs', 'entities', 'players', 'user_entities', 'bosses', 'boss_entities'] } = {}) {
  const uniqueDates = [...new Set(dates.map(value => String(value)))].filter(value => /^\d{4}-\d{2}-\d{2}$/.test(value));
  if (!uniqueDates.length) return;
  const selectedTables = new Set(tables);
  const param = { revision };
  const dayFilter = uniqueDates.length === 1
    ? (param.date = uniqueDates[0], 'event_date = {date:Date}')
    : `event_date IN (${uniqueDates.map((date, index) => {
        param[`date${index}`] = date;
        return `{date${index}:Date}`;
      }).join(', ')})`;
  // ReplacingMergeTree는 새 파서가 더 이상 내보내지 않는 예전 엔티티 행을
  // 자동으로 지우지 않는다. 완성 트리(110~119번 최종 노드)가 실제로 함께
  // 기록된 이벤트만 노드 관련 일별 집계에 포함한다.
  const completeNodeEvent = `(event_date, event_id) IN (
    SELECT event_date, event_id
    FROM analytics_entities FINAL
    WHERE ${dayFilter} AND entity_type = 'nodes'
    GROUP BY event_date, event_id
    HAVING uniqExact(JSONExtractInt(descriptor_json, 'id')) >= 12
       AND countIf(JSONExtractInt(descriptor_json, 'id') BETWEEN 110 AND 119) > 0
  )`;
  const completeBossNodeEvent = `(event_date, event_id) IN (
    SELECT event_date, event_id
    FROM analytics_boss_entities FINAL
    WHERE ${dayFilter} AND entity_type = 'nodes'
    GROUP BY event_date, event_id
    HAVING uniqExact(JSONExtractInt(descriptor_json, 'id')) >= 12
       AND countIf(JSONExtractInt(descriptor_json, 'id') BETWEEN 110 AND 119) > 0
  )`;
  const aggregateSettings = 'SETTINGS max_threads = 1, max_insert_threads = 1, max_bytes_before_external_group_by = 536870912, max_memory_usage = 3221225472';
  if (selectedTables.has('runs')) await client.command(`
    INSERT INTO analytics_daily_runs
    SELECT {revision:String}, event_date, version, version_family, platform, game_mode, mode_level, after_first_middle,
           count() AS runs, countIf(is_clear = 1 OR outcome = 'Clear') AS clears,
           countIf(is_dead = 1 OR outcome = 'Dead') AS deaths,
           countIf(NOT (is_clear = 1 OR outcome = 'Clear') AND NOT (is_dead = 1 OR outcome = 'Dead')) AS fails,
           sum(play_time_ms) AS play_time_sum,
           uniqCombined64State(player_hash) AS players,
           quantilesTDigestStateIf(0.5, 0.9)(play_time_ms, play_time_ms > 0) AS play_time
    FROM analytics_events FINAL
    WHERE ${dayFilter} AND event_type = 'battleResult'
    GROUP BY event_date, version, version_family, platform, game_mode, mode_level, after_first_middle
  `, { params: param, timeout: 600_000 });
  if (selectedTables.has('entities')) await client.command(`
    INSERT INTO analytics_daily_entities
    SELECT {revision:String}, event_date, version, version_family, platform, game_mode, mode_level, after_first_middle,
           character_key, entity_type, entity_key, entity_name, source, descriptor_json,
           count() AS runs, countIf(is_clear = 1 OR outcome = 'Clear') AS clears,
           uniqCombined64State(player_hash) AS players,
           quantilesTDigestStateIf(0.5, 0.9)(play_time_ms, play_time_ms > 0) AS play_time
    FROM analytics_entities FINAL
    WHERE ${dayFilter}
      AND NOT match(descriptor_json, 'node:name:-?[0-9]+')
      AND ${VALID_WEAPON_RUNE_SQL}
      AND (entity_type NOT IN ('nodes', 'nodeCombinations', 'combinationsWithNodes', 'combinationCollectionsWithNodes') OR ${completeNodeEvent})
    GROUP BY event_date, version, version_family, platform, game_mode, mode_level, after_first_middle,
             character_key, entity_type, entity_key, entity_name, source, descriptor_json
    ${aggregateSettings}
  `, { params: param, timeout: 600_000 });
  if (selectedTables.has('players')) await client.command(`
    INSERT INTO analytics_daily_players
    SELECT {revision:String}, event_date, version, version_family, platform, game_mode, mode_level, after_first_middle,
           account_linked, player_hash, toUInt32(count()) AS runs, max(chapter) AS max_chapter,
           sum(play_time_ms) AS play_time_sum, min(event_time) AS first_event_time,
           argMin(play_time_ms, event_time) AS first_play_time_ms, max(event_time) AS last_event_time
    FROM analytics_events FINAL
    WHERE ${dayFilter} AND event_type = 'battleResult'
    GROUP BY event_date, version, version_family, platform, game_mode, mode_level, after_first_middle,
             account_linked, player_hash
  `, { params: param, timeout: 600_000 });
  if (selectedTables.has('user_entities')) await client.command(`
    INSERT INTO analytics_daily_user_entities
    SELECT {revision:String}, event_date, version, version_family, platform, game_mode, mode_level, after_first_middle,
           account_linked, entity_type, entity_key, argMax(entity_name, event_time), argMax(descriptor_json, event_time),
           uniqCombined64State(player_hash)
    FROM analytics_entities FINAL
    WHERE ${dayFilter}
      AND NOT match(descriptor_json, 'node:name:-?[0-9]+')
      AND ${VALID_WEAPON_RUNE_SQL}
      AND (entity_type NOT IN ('nodes', 'nodeCombinations', 'combinationsWithNodes', 'combinationCollectionsWithNodes') OR ${completeNodeEvent})
    GROUP BY event_date, version, version_family, platform, game_mode, mode_level, after_first_middle,
             account_linked, entity_type, entity_key
    ${aggregateSettings}
  `, { params: param, timeout: 600_000 });
  const matched = `encounter_id != '' AND (event_date, player_hash, encounter_id, boss_key) IN (
    SELECT event_date, player_hash, encounter_id, boss_key FROM analytics_events FINAL
    WHERE ${dayFilter} AND event_type = 'bossEncounter' AND encounter_id != ''
  )`;
  if (selectedTables.has('bosses')) await client.command(`
    INSERT INTO analytics_daily_bosses
    SELECT {revision:String}, event_date, version, version_family, platform, game_mode, mode_level, after_first_middle,
           boss_key, any(boss_name), any(boss_rank), countIf(event_type = 'bossEncounter'),
           countIf(event_type = 'bossKill'), countIf(event_type = 'bossKill' AND ${matched}),
           uniqCombined64State(player_hash),
           quantilesTDigestStateIf(0.5, 0.9)(fight_duration_ms, event_type = 'bossKill' AND fight_duration_ms > 0)
    FROM analytics_events FINAL
    WHERE ${dayFilter} AND event_type IN ('bossEncounter', 'bossKill')
    GROUP BY event_date, version, version_family, platform, game_mode, mode_level, after_first_middle, boss_key
  `, { params: param, timeout: 600_000 });
  if (selectedTables.has('boss_entities')) await client.command(`
    INSERT INTO analytics_daily_boss_entities
    SELECT {revision:String}, event_date, version, version_family, platform, game_mode, mode_level, after_first_middle,
           boss_key, character_key, entity_type, entity_key, entity_name, descriptor_json,
           countIf(event_kind = 'bossEncounter'), countIf(event_kind = 'bossKill'),
           countIf(event_kind = 'bossKill' AND encounter_id != '' AND (event_date, player_hash, encounter_id, boss_key) IN (
             SELECT event_date, player_hash, encounter_id, boss_key FROM analytics_events FINAL
             WHERE ${dayFilter} AND event_type = 'bossEncounter' AND encounter_id != ''
           )),
           uniqCombined64State(player_hash)
    FROM analytics_boss_entities FINAL
    WHERE ${dayFilter}
      AND NOT match(descriptor_json, 'node:name:-?[0-9]+')
      AND ${VALID_WEAPON_RUNE_SQL}
      AND (entity_type NOT IN ('nodes', 'nodeCombinations', 'combinationsWithNodes') OR ${completeBossNodeEvent})
    GROUP BY event_date, version, version_family, platform, game_mode, mode_level, after_first_middle,
             boss_key, character_key, entity_type, entity_key, entity_name, descriptor_json
    ${aggregateSettings}
  `, { params: param, timeout: 600_000 });
}

async function copyUnaffectedAggregates(client, activeRevision, targetRevision, { allDays, playerDays }, cutoffDate) {
  for (const table of ['runs', 'entities', 'players', 'user_entities', 'bosses', 'boss_entities']) {
    const affectedDays = table === 'players' || table === 'user_entities' ? playerDays : allDays;
    const dates = affectedDays.map(date => `'${String(date).replaceAll("'", "''")}'`).join(',');
    const unaffected = dates ? ` AND event_date NOT IN (${dates})` : '';
    await client.command(`INSERT INTO analytics_daily_${table} SELECT {target:String}, * EXCEPT revision FROM analytics_daily_${table} WHERE revision = {active:String} AND event_date >= {cutoff:Date}${unaffected}`, {
      params: { target: targetRevision, active: activeRevision, cutoff: cutoffDate }, timeout: 3_600_000
    });
  }
}

async function validateRevision(client, revision, cutoffDate = '1970-01-01') {
  const [raw] = await client.rows(`SELECT countIf(event_type = 'battleResult') runs, countIf(event_type = 'bossEncounter') encounters, countIf(event_type = 'bossKill') kills, uniqExactIf(player_hash, event_type = 'battleResult' AND account_linked = 1) linked_players FROM analytics_events FINAL WHERE event_date >= {cutoff:Date}`, { params: { cutoff: cutoffDate }, timeout: 600_000 });
  const [runs] = await client.rows(`SELECT sum(runs) runs FROM analytics_daily_runs WHERE revision = {revision:String}`, { params: { revision }, timeout: 600_000 });
  const [players] = await client.rows(`SELECT uniqExactIf(player_hash, account_linked = 1) linked_players FROM analytics_daily_players WHERE revision = {revision:String}`, { params: { revision }, timeout: 600_000 });
  const [bosses] = await client.rows(`SELECT sum(encounters) encounters, sum(kills) kills FROM analytics_daily_bosses WHERE revision = {revision:String}`, { params: { revision }, timeout: 600_000 });
  for (const key of ['runs']) if (Number(raw?.[key] || 0) !== Number(runs?.[key] || 0)) throw new Error(`집계 검증에 실패했습니다: ${key}`);
  if (Number(raw?.linked_players || 0) !== Number(players?.linked_players || 0)) throw new Error('집계 검증에 실패했습니다: linked_players');
  for (const key of ['encounters', 'kills']) if (Number(raw?.[key] || 0) !== Number(bosses?.[key] || 0)) throw new Error(`집계 검증에 실패했습니다: ${key}`);
}

async function cleanupAggregateRevisions(client, keep) {
  if (!keep.length) return;
  const list = keep.map(value => `'${String(value).replaceAll("'", "''")}'`).join(',');
  for (const table of ['runs', 'entities', 'players', 'user_entities', 'bosses', 'boss_entities']) {
    await client.command(`ALTER TABLE analytics_daily_${table} DELETE WHERE revision NOT IN (${list})`, { timeout: 120_000 }).catch(error => console.error(JSON.stringify({ level: 'warn', component: 'statistics-worker', event: 'revision_cleanup_failed', table, message: error.message })));
  }
}

function normalizePublication(row) {
  if (!row) return { status: 'empty', revision: '', inProgress: false, completedAt: null, dataThrough: null, processedBlobs: 0, processedEvents: 0, currentProfile: '', error: '' };
  return {
    status: row.status, revision: row.revision, runId: row.run_id || null, inProgress: row.status === 'running',
    startedAt: row.started_at || null, completedAt: row.completed_at || null, dataThrough: row.data_through || null,
    processedBlobs: Number(row.processed_blobs || 0), processedEvents: Number(row.processed_events || 0),
    currentProfile: row.current_profile || '', error: row.error || ''
  };
}

function hash64(value) { return (BigInt(`0x${crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 16)}`) & ((1n << 64n) - 1n)).toString(); }
function versionFamily(value) { const match = String(value || '').match(/^(\d+)\.(\d+)\./); return match ? `${match[1]}.${match[2]}.x` : ''; }
function nonnegative(value) { const number = Number(value); return Number.isFinite(number) && number > 0 ? Math.trunc(number) : 0; }
export function progressChapter(event) {
  const explicit = Number(event?.chapter);
  if (Number.isInteger(explicit) && explicit > 0) return Math.min(255, explicit);
  const stage = String(event?.stage || '').trim().toLocaleLowerCase('ko-KR');
  const labeled = stage.match(/(?:chapter|챕터)\s*(\d+)/i);
  if (labeled) return Math.min(255, Number(labeled[1]));
  const progression = stage.match(/(?:^|[^0-9])(\d+)\s*[-_]\s*(?:\d+|boss|middle)/i);
  if (progression) return Math.min(255, Number(progression[1]));
  return event?.reachedFirstMiddleBoss === true || reachedFirstMiddleBoss(stage) ? 1 : 0;
}
function clickHouseDateTime(value) { return new Date(value).toISOString().replace('T', ' ').replace('Z', ''); }
function dateKeyToIso(value) { const text = String(value || ''); if (!/^\d{8}$/.test(text)) throw new Error(`날짜 파티션이 올바르지 않습니다: ${text}`); return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`; }
function rebuildBatches(days, batchSize = 7) {
  const groups = new Map();
  for (const day of days) {
    const month = String(day).slice(0, 7);
    if (!groups.has(month)) groups.set(month, []);
    groups.get(month).push(day);
  }
  return [...groups.values()].flatMap(group => {
    const batches = [];
    for (let index = 0; index < group.length; index += batchSize) batches.push(group.slice(index, index + batchSize));
    return batches;
  });
}
function retentionDateKeys(nowMs, retentionDays) { const result = []; const today = new Date(nowMs); today.setUTCHours(0, 0, 0, 0); for (let offset = retentionDays - 1; offset >= 0; offset -= 1) { const date = new Date(today); date.setUTCDate(today.getUTCDate() - offset); result.push(date.toISOString().slice(0, 10).replaceAll('-', '')); } return result; }
function readLookbackDays() { const value = Number.parseInt(String(process.env.STATISTICS_SYNC_LOOKBACK_DAYS || '2'), 10); return Number.isInteger(value) && value > 0 ? Math.min(value, 30) : 2; }
export function reachedFirstMiddleBoss(stage) {
  const text = String(stage || '').trim().toLocaleLowerCase('ko-KR').replace(/[_–—]/g, '-').replace(/\s+/g, ' ');
  if (!text) return false;
  if (/middle\s*-?\s*boss|중간\s*보스/.test(text)) return true;
  if (/(?:^|[-\s])boss$|보스$/.test(text)) return true;
  if (/독성\s*늪지|toxic\s*swamp|니플헤임|niflheim|철혈의\s*요새|fortress|붉은\s*태양의\s*사막|red\s*sun|고대\s*도시\s*그랑펠|granfel/.test(text)) return true;
  const progression = text.match(/(\d+)\s*-\s*(\d+)\s*$/);
  return Boolean(progression && Number(progression[1]) > 1);
}
function formatBytes(value) { const units = ['B', 'KB', 'MB', 'GB', 'TB']; let amount = Number(value || 0), index = 0; while (amount >= 1024 && index < units.length - 1) { amount /= 1024; index += 1; } return `${amount.toFixed(index ? 1 : 0)} ${units[index]}`; }

export { dateKeyToIso, normalizePublication, rebuildBatches, rebuildDay, validateRevision, insertBlob };
