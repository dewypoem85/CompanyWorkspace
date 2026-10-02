import { getCollectionMeta } from './collection-data.js';
import { getBossMeta } from './game-master-data.js';
import { readRetentionDays } from './clickhouse-schema.js';

const BUILD_TYPES = new Set(['characters', 'skins', 'weapons', 'pets', 'nodes', 'nodeCombinations', 'skills', 'artifacts', 'sinPoints', 'combinations']);
const CHARACTER_SCOPED_TYPES = new Set(['skins', 'weapons', 'nodes', 'nodeCombinations', 'sinPoints']);
const COMPLETE_NODE_TYPES = new Set(['nodes', 'nodeCombinations', 'combinationsWithNodes']);
const COMPLETE_NODE_COMBINATION_SQL = `JSONLength(descriptor_json, 'nodes') >= 12
  AND arrayExists(node -> JSONExtractInt(node, 'id') BETWEEN 110 AND 119, JSONExtractArrayRaw(descriptor_json, 'nodes'))`;
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
const USER_METRIC_TYPES = ['characters', 'skins', 'weapons', 'pets', 'skills', 'artifacts', 'nodes'];
const DETAIL_INSIGHT_TYPES = new Set(['characters', 'skins', 'weapons', 'pets', 'skills', 'artifacts', 'nodes']);
const SYNERGY_DETAIL_TYPES = new Set(['characters', 'weapons', 'pets']);
const RELATED_DETAIL_TYPES = Object.freeze({
  artifacts: ['skills', 'artifacts'],
  skills: ['skills', 'artifacts'],
  pets: ['characters', 'weapons', 'skills', 'artifacts']
});
const LAST_BOSSES = Object.freeze([
  { code: 'B302', name: '베네딕트' },
  { code: 'B504', name: '누트' }
]);
const SORTS = {
  runs: 'runs', players: 'players', clearRate: 'clear_rate', selectionRate: 'selection_rate',
  name: 'name', kills: 'kills', encounters: 'encounters', encounterClearRate: 'encounter_clear_rate'
};

export function createClickHouseStatistics({ client, now = () => Date.now() }) {
  async function publication() {
    const [row] = await client.rows(`
      SELECT revision, run_id, status, started_at, completed_at, data_through, processed_blobs,
             processed_events, current_profile, error, updated_at
      FROM analytics_publication FINAL ORDER BY updated_at DESC LIMIT 1
    `);
    return row ? {
      revision: row.revision, runId: row.run_id || null, status: row.status, inProgress: row.status === 'running',
      startedAt: stamp(row.started_at), completedAt: stamp(row.completed_at), dataThrough: stamp(row.data_through),
      processedBlobs: number(row.processed_blobs), processedEvents: number(row.processed_events),
      currentProfile: row.current_profile || '', error: row.error || ''
    } : { revision: '', status: 'empty', inProgress: false, startedAt: null, completedAt: null, dataThrough: null, processedBlobs: 0, processedEvents: 0, currentProfile: '', error: '' };
  }

  async function meta() {
    const current = await publication();
    const revisionWhere = 'revision = {revision:String}';
    const revisionParams = { revision: current.revision };
    const [range, versions, modes] = await Promise.all([
      client.rows(`SELECT min(event_date) AS min_date, max(event_date) AS max_date FROM analytics_daily_runs WHERE ${revisionWhere}`, { params: revisionParams }),
      client.rows(`SELECT version, sum(runs) AS runs FROM analytics_daily_runs WHERE ${revisionWhere} AND version != '' GROUP BY version ORDER BY version DESC`, { params: revisionParams }),
      client.rows(`SELECT game_mode AS mode, sum(runs) AS runs, minIf(mode_level, mode_level >= 0) AS min_level, max(mode_level) AS max_level FROM analytics_daily_runs WHERE ${revisionWhere} AND game_mode != '' GROUP BY game_mode ORDER BY runs DESC`, { params: revisionParams })
    ]);
    return {
      publication: current,
      range: { from: range[0]?.min_date || null, to: range[0]?.max_date || null },
      versions: versions.map(row => ({ value: row.version, family: versionFamily(row.version), runs: number(row.runs) })),
      modes: modes.map(row => ({ value: row.mode, runs: number(row.runs), minLevel: nullableLevel(row.min_level), maxLevel: nullableLevel(row.max_level) })),
      generatedAt: new Date(now()).toISOString(), uniquePlayersApproximate: true,
      retentionDays: readRetentionDays()
    };
  }

  async function dashboard(searchParams) {
    const filter = parseFilter(searchParams, now());
    const current = await publication();
    const where = sqlFilter(filter, current.revision);
    const [summaryRows, trendRows, buildRows, bossRows] = await Promise.all([
      client.rows(`
        SELECT sum(runs) runs, sum(clears) clears, sum(deaths) deaths, sum(fails) fails,
               uniqCombined64Merge(players) players,
               quantilesTDigestMerge(0.5, 0.9)(play_time) play_time
        FROM analytics_daily_runs WHERE ${where.sql}
      `, { params: where.params }),
      client.rows(`
        SELECT event_date date, sum(runs) runs, sum(clears) clears, sum(deaths) deaths,
               uniqCombined64Merge(players) players
        FROM analytics_daily_runs WHERE ${where.sql}
        GROUP BY event_date ORDER BY event_date
      `, { params: where.params }),
      client.rows(`
        SELECT entity_key key, argMax(entity_name, event_date) name, argMax(descriptor_json, event_date) descriptor,
               sum(runs) runs, sum(clears) clears, uniqCombined64Merge(players) players
        FROM analytics_daily_entities WHERE ${where.sql} AND entity_type = 'characters'
        GROUP BY entity_key ORDER BY runs DESC LIMIT 5
      `, { params: where.params }),
      client.rows(`
        SELECT boss_key key, argMax(boss_name, event_date) name, argMax(boss_rank, event_date) rank,
               sum(encounters) encounters, sum(kills) kills, sum(matched_kills) matched_kills
        FROM analytics_daily_bosses WHERE ${where.sql}
        GROUP BY boss_key ORDER BY kills DESC LIMIT 5
      `, { params: where.params })
    ]);
    const summary = summaryRows[0] || {};
    const runs = number(summary.runs), clears = number(summary.clears), deaths = number(summary.deaths), fails = number(summary.fails);
    return envelope(filter, current, {
      summary: {
        activePlayers: number(summary.players), totalRuns: runs, clears, deaths, fails,
        completionRate: percent(clears, runs), deathRate: percent(deaths, runs),
        playTime: distribution(summary.play_time)
      },
      trend: trendRows.map(row => ({ date: row.date, runs: number(row.runs), clears: number(row.clears), deaths: number(row.deaths), players: number(row.players) })),
      outcomes: [
        { key: 'Clear', label: '클리어', count: clears, rate: percent(clears, runs) },
        { key: 'Dead', label: '사망', count: deaths, rate: percent(deaths, runs) },
        { key: 'Fail', label: '실패·중단', count: fails, rate: percent(fails, runs) }
      ],
      topBuilds: buildRows.map(buildItem),
      topBosses: bossRows.map(bossItem)
    });
  }

  async function results(searchParams) {
    const filter = parseFilter(searchParams, now());
    const current = await publication();
    const where = sqlFilter(filter, current.revision);
    const dimensions = async column => client.rows(`
      SELECT ${column} key, sum(runs) runs, sum(clears) clears, sum(deaths) deaths, sum(fails) fails,
             uniqCombined64Merge(players) players,
             quantilesTDigestMerge(0.5, 0.9)(play_time) play_time
      FROM analytics_daily_runs WHERE ${where.sql}
      GROUP BY ${column} ORDER BY runs DESC
    `, { params: where.params });
    const [versions, modes] = await Promise.all([dimensions('version'), dimensions('game_mode')]);
    return envelope(filter, current, {
      versions: versions.map(resultItem),
      modes: modes.map(resultItem)
    });
  }

  async function builds(type, searchParams) {
    const safeType = buildType(type);
    const storedType = safeType === 'combinations' && truthy(searchParams.get('includeNodes')) ? 'combinationsWithNodes' : safeType;
    const filter = parseFilter(searchParams, now());
    const current = await publication();
    const where = sqlFilter(filter, current.revision);
    const page = pageInput(searchParams);
    const search = String(searchParams.get('search') || '').trim().slice(0, 100);
    const sort = sortInput(searchParams, 'runs');
    const searchSql = search ? 'AND positionCaseInsensitive(entity_name, {search:String}) > 0' : '';
    const params = { ...where.params, entityType: storedType, search };
    const order = `${SORTS[sort.key]} ${sort.direction.toUpperCase()}, runs DESC, name ASC`;
    const characterScoped = selectionRateScope(storedType) === 'character';
    const completeNodeScoped = COMPLETE_NODE_TYPES.has(storedType);
    const completeCombinationSql = ['nodeCombinations', 'combinationsWithNodes'].includes(storedType) ? `AND ${COMPLETE_NODE_COMBINATION_SQL}` : '';
    const characterColumn = characterScoped ? ', character_key' : '';
    const groupedBy = characterScoped ? 'entity_key, character_key' : 'entity_key';
    const totalsSql = completeNodeScoped
      ? `SELECT ${characterScoped ? 'character_key,' : ''} sum(runs) denominator FROM analytics_daily_entities
         WHERE ${where.sql} AND entity_type = 'nodeCombinations' AND ${COMPLETE_NODE_COMBINATION_SQL} ${characterScoped ? 'GROUP BY character_key' : ''}`
      : characterScoped
        ? `SELECT character_key, sum(runs) denominator FROM analytics_daily_entities
           WHERE ${where.sql} AND entity_type = 'characters' GROUP BY character_key`
        : `SELECT sum(runs) denominator FROM analytics_daily_runs WHERE ${where.sql}`;
    const totalsJoin = characterScoped ? 'INNER JOIN totals USING (character_key)' : 'CROSS JOIN totals';
    const rows = await client.rows(`
      WITH grouped AS (
        SELECT entity_key key${characterColumn}, argMax(entity_name, event_date) name, argMax(descriptor_json, event_date) descriptor,
               sum(runs) runs, sum(clears) clears, uniqCombined64Merge(players) players,
               quantilesTDigestMerge(0.5, 0.9)(play_time) play_time
        FROM analytics_daily_entities
        WHERE ${where.sql} AND entity_type = {entityType:String}
          AND ${VALID_WEAPON_RUNE_SQL}
          AND NOT match(descriptor_json, 'node:name:-?[0-9]+') ${completeCombinationSql} ${searchSql}
        GROUP BY ${groupedBy}
      ), totals AS (${totalsSql})
      SELECT *, if(denominator = 0, 0, runs * 100.0 / denominator) selection_rate,
             if(runs = 0, 0, clears * 100.0 / runs) clear_rate,
             count() OVER () total
      FROM grouped ${totalsJoin} ORDER BY ${order} LIMIT ${page.limit} OFFSET ${page.offset}
    `, { params });
    return envelope(filter, current, {
      type: safeType, page: page.page, pageSize: page.limit, total: number(rows[0]?.total),
      sort, items: rows.map(buildItem)
    });
  }

  async function buildDetail(type, key, searchParams) {
    const safeType = buildType(type);
    const storedType = safeType === 'combinations' && truthy(searchParams.get('includeNodes')) ? 'combinationsWithNodes' : safeType;
    const safeKey = String(key || '').slice(0, 1024);
    if (!safeKey) throw httpError(400, '상세 항목 키가 필요합니다.');
    const filter = parseFilter(searchParams, now());
    const current = await publication();
    const where = sqlFilter(filter, current.revision);
    const trendGrouping = searchParams.get('versionGrouping') === 'family' ? 'family' : 'exact';
    const trendLimit = searchParams.get('versionPoints') === 'all'
      ? null
      : clampInt(searchParams.get('versionPoints'), 5, 50, 20);
    const trendTo = new Date(`${filter.to}T00:00:00Z`);
    const trendFrom = new Date(trendTo.getTime() - (readRetentionDays() - 1) * 86_400_000);
    const trendFilter = { ...filter, from: isoDate(trendFrom), version: '' };
    const trendWhere = sqlFilter(trendFilter, current.revision);
    const versionColumn = trendGrouping === 'family' ? 'version_family' : 'version';
    const params = { ...where.params, entityType: storedType, key: safeKey };
    const characterScoped = selectionRateScope(storedType) === 'character';
    const completeNodeScoped = COMPLETE_NODE_TYPES.has(storedType);
    const completeCombinationSql = ['nodeCombinations', 'combinationsWithNodes'].includes(storedType) ? `AND ${COMPLETE_NODE_COMBINATION_SQL}` : '';
    const baseCharacterColumn = characterScoped ? ', character_key' : '';
    const baseGroupBy = characterScoped ? 'entity_key, character_key, denominator' : 'entity_key, denominator';
    const baseTotalsSql = completeNodeScoped
      ? `SELECT ${characterScoped ? 'character_key,' : ''} sum(runs) denominator FROM analytics_daily_entities
         WHERE ${where.sql} AND entity_type = 'nodeCombinations' AND ${COMPLETE_NODE_COMBINATION_SQL} ${characterScoped ? 'GROUP BY character_key' : ''}`
      : characterScoped
        ? `SELECT character_key, sum(runs) denominator FROM analytics_daily_entities
           WHERE ${where.sql} AND entity_type = 'characters' GROUP BY character_key`
        : `SELECT sum(runs) denominator FROM analytics_daily_runs WHERE ${where.sql}`;
    const baseTotalsJoin = characterScoped ? 'INNER JOIN totals USING (character_key)' : 'CROSS JOIN totals';
    const versionCharacterColumn = characterScoped ? ', character_key' : '';
    const versionGroupBy = characterScoped ? `${versionColumn}, character_key` : versionColumn;
    const versionTotalsSql = completeNodeScoped
      ? `SELECT ${versionColumn} version${characterScoped ? ', character_key' : ''}, sum(runs) denominator
         FROM analytics_daily_entities
         WHERE ${trendWhere.sql} AND ${versionColumn} != '' AND entity_type = 'nodeCombinations'
           AND ${COMPLETE_NODE_COMBINATION_SQL}
         GROUP BY ${versionColumn}${characterScoped ? ', character_key' : ''}`
      : characterScoped
        ? `SELECT ${versionColumn} version, character_key, sum(runs) denominator
           FROM analytics_daily_entities
           WHERE ${trendWhere.sql} AND ${versionColumn} != '' AND entity_type = 'characters'
           GROUP BY ${versionColumn}, character_key`
        : `SELECT ${versionColumn} version, sum(runs) denominator
           FROM analytics_daily_runs
           WHERE ${trendWhere.sql} AND ${versionColumn} != ''
           GROUP BY ${versionColumn}`;
    const versionTotalsJoin = characterScoped ? 'USING (version, character_key)' : 'USING version';
    const [baseRows, versionRows] = await Promise.all([
      client.rows(`
        WITH totals AS (${baseTotalsSql})
        SELECT entity_key key${baseCharacterColumn}, argMax(entity_name, event_date) name, argMax(descriptor_json, event_date) descriptor,
               sum(runs) runs, sum(clears) clears, uniqCombined64Merge(players) players,
               quantilesTDigestMerge(0.5, 0.9)(play_time) play_time,
               if(denominator = 0, 0, runs * 100.0 / denominator) selection_rate,
               if(runs = 0, 0, clears * 100.0 / runs) clear_rate
        FROM analytics_daily_entities ${baseTotalsJoin}
        WHERE ${where.sql} AND entity_type = {entityType:String} AND entity_key = {key:String}
          AND ${VALID_WEAPON_RUNE_SQL}
          AND NOT match(descriptor_json, 'node:name:-?[0-9]+') ${completeCombinationSql}
        GROUP BY ${baseGroupBy}
      `, { params }),
      client.rows(`
        WITH totals AS (${versionTotalsSql}), entity AS (
          SELECT ${versionColumn} version${versionCharacterColumn}, sum(runs) runs, sum(clears) clears
          FROM analytics_daily_entities
          WHERE ${trendWhere.sql} AND ${versionColumn} != ''
            AND ${VALID_WEAPON_RUNE_SQL}
            AND NOT match(descriptor_json, 'node:name:-?[0-9]+')
            AND entity_type = {entityType:String} AND entity_key = {key:String} ${completeCombinationSql}
          GROUP BY ${versionGroupBy}
        )
        SELECT entity.version version, runs, clears,
               if(runs = 0, 0, clears * 100.0 / runs) clear_rate,
               if(denominator = 0, 0, runs * 100.0 / denominator) selection_rate
        FROM entity INNER JOIN totals ${versionTotalsJoin}
      `, { params: { ...trendWhere.params, entityType: storedType, key: safeKey } })
    ]);
    if (!baseRows.length) throw httpError(404, '선택한 빌드 통계를 찾지 못했습니다.');
    const item = buildItem(baseRows[0]);
    const allVersions = versionRows
      .map(row => ({
        version: row.version || '미기록', runs: number(row.runs), clears: number(row.clears),
        selectionRate: decimal(row.selection_rate), clearRate: decimal(row.clear_rate)
      }))
      .sort((left, right) => compareVersions(left.version, right.version));
    item.versions = trendLimit ? allVersions.slice(-trendLimit) : allVersions;
    item.versionTrend = { grouping: trendGrouping, points: trendLimit || 'all', from: trendFilter.from, to: trendFilter.to };
    const detailTasks = [];
    if (safeType === 'characters') detailTasks.push(characterComponents(client, where, safeKey).then(value => { item.components = value; }));
    if (safeType === 'nodes') detailTasks.push(nodeDetailSelectionRate(client, where, safeKey, baseRows[0].character_key, item).then(value => { item.selectionRate = value; }));
    if (DETAIL_INSIGHT_TYPES.has(safeType)) detailTasks.push(itemInsights(client, filter, storedType, safeKey, item.runs).then(value => { item.insights = value; }));
    await Promise.all(detailTasks);
    if (safeType === 'combinations') {
      const collectionType = storedType === 'combinationsWithNodes' ? 'combinationCollectionsWithNodes' : 'combinationCollections';
      item.collections = await combinationCollections(client, where, safeKey, collectionType, item.runs);
      item.synergies = item.collections.filter(value => /시너지/.test(value.effect || ''));
    }
    return envelope(filter, current, { type: safeType, item });
  }

  async function bosses(searchParams) {
    const filter = parseFilter(searchParams, now());
    const current = await publication();
    const where = sqlFilter(filter, current.revision);
    const page = pageInput(searchParams);
    const search = String(searchParams.get('search') || '').trim().slice(0, 100);
    const sort = sortInput(searchParams, 'kills');
    const searchSql = search ? 'AND positionCaseInsensitive(boss_name, {search:String}) > 0' : '';
    const order = `${SORTS[sort.key] || 'kills'} ${sort.direction.toUpperCase()}, kills DESC, name ASC`;
    const rows = await client.rows(`
      WITH grouped AS (
        SELECT boss_key key, argMax(boss_name, event_date) name, argMax(boss_rank, event_date) rank,
               sum(encounters) encounters, sum(kills) kills, sum(matched_kills) matched_kills,
               uniqCombined64Merge(players) players,
               quantilesTDigestMerge(0.5, 0.9)(fight_time) fight_time
        FROM analytics_daily_bosses WHERE ${where.sql} ${searchSql} GROUP BY boss_key
      )
      SELECT *, if(encounters = 0, 0, matched_kills * 100.0 / encounters) encounter_clear_rate,
             count() OVER () total
      FROM grouped ORDER BY ${order} LIMIT ${page.limit} OFFSET ${page.offset}
    `, { params: { ...where.params, search } });
    return envelope(filter, current, {
      page: page.page, pageSize: page.limit, total: number(rows[0]?.total), sort,
      items: rows.map(bossItem)
    });
  }

  async function bossDetail(key, searchParams) {
    const safeKey = String(key || '').slice(0, 1024);
    if (!safeKey) throw httpError(400, '보스 상세 키가 필요합니다.');
    const filter = parseFilter(searchParams, now());
    const current = await publication();
    const where = sqlFilter(filter, current.revision);
    const params = { ...where.params, key: safeKey };
    const [bossRows, builds] = await Promise.all([
      client.rows(`
        SELECT boss_key key, argMax(boss_name, event_date) name, argMax(boss_rank, event_date) rank,
               sum(encounters) encounters, sum(kills) kills, sum(matched_kills) matched_kills,
               uniqCombined64Merge(players) players,
               quantilesTDigestMerge(0.5, 0.9)(fight_time) fight_time,
               if(encounters = 0, 0, matched_kills * 100.0 / encounters) encounter_clear_rate
        FROM analytics_daily_bosses WHERE ${where.sql} AND boss_key = {key:String}
        GROUP BY boss_key
      `, { params }),
      client.rows(`
        SELECT entity_type type, entity_key key, argMax(entity_name, event_date) name,
               argMax(descriptor_json, event_date) descriptor,
               sum(encounters) encounters, sum(kills) kills, sum(matched_kills) matched_kills,
               uniqCombined64Merge(players) players,
               if(encounters = 0, 0, matched_kills * 100.0 / encounters) clear_rate
        FROM analytics_daily_boss_entities
        WHERE ${where.sql} AND boss_key = {key:String}
          AND ${VALID_WEAPON_RUNE_SQL}
        GROUP BY entity_type, entity_key ORDER BY type, matched_kills DESC, encounters DESC LIMIT 500
      `, { params })
    ]);
    if (!bossRows.length) throw httpError(404, '선택한 보스 통계를 찾지 못했습니다.');
    const grouped = Object.create(null);
    for (const row of builds) (grouped[row.type] ||= []).push({ ...descriptor(row), key: row.key, name: row.name, encounters: number(row.encounters), kills: number(row.kills), matchedKills: number(row.matched_kills), uniquePlayers: number(row.players), clearRate: decimal(row.clear_rate) });
    return envelope(filter, current, { item: { ...bossItem(bossRows[0]), buildStats: grouped } });
  }

  async function users(searchParams) {
    const requestedFilter = parseFilter(searchParams, now());
    const filter = { ...requestedFilter, afterFirstMiddleBoss: false };
    const current = await publication();
    const where = sqlFilter(filter, current.revision);
    const playerBase = `
      SELECT player_hash, max(max_chapter) max_chapter, max(mode_level) max_mode_level,
             sum(runs) run_count, argMin(first_play_time_ms, first_event_time) first_play_time_ms
      FROM analytics_daily_players
      WHERE ${where.sql} AND account_linked = 1
      GROUP BY player_hash`;
    const [summaryRows, entityRows, chapterRows, levelRows, durationRows] = await Promise.all([
      client.rows(`
        WITH players AS (${playerBase})
        SELECT count() linked_users, sum(run_count) runs, countIf(run_count = 1) one_run_users,
               avg(run_count) average_runs, countIf(max_chapter = 0) unknown_chapter_users
        FROM players
      `, { params: where.params }),
      client.rows(`
        WITH total AS (
          SELECT uniqCombined64(player_hash) users
          FROM analytics_daily_players
          WHERE ${where.sql} AND account_linked = 1
        ), grouped AS (
          SELECT entity_type type, entity_key key, argMax(entity_name, event_date) name,
                 argMax(descriptor_json, event_date) descriptor, uniqCombined64Merge(players) users
          FROM analytics_daily_user_entities
          WHERE ${where.sql} AND account_linked = 1 AND entity_type IN ('characters', 'skins', 'weapons', 'pets', 'skills', 'artifacts', 'nodes')
            AND ${VALID_WEAPON_RUNE_SQL}
          GROUP BY entity_type, entity_key
          ORDER BY type, users DESC
          LIMIT 20 BY entity_type
        )
        SELECT grouped.*, total.users total_users,
               if(total.users = 0, 0, grouped.users * 100.0 / total.users) usage_rate
        FROM grouped CROSS JOIN total
        ORDER BY type, users DESC, name ASC
      `, { params: where.params }),
      client.rows(`
        WITH players AS (${playerBase})
        SELECT chapter, countIf(max_chapter >= chapter) users
        FROM players ARRAY JOIN [1, 2, 3, 4] AS chapter
        GROUP BY chapter ORDER BY chapter
      `, { params: where.params }),
      client.rows(`
        WITH players AS (${playerBase})
        SELECT max_mode_level level, count() retired_users
        FROM players WHERE max_mode_level >= 0
        GROUP BY max_mode_level ORDER BY level
      `, { params: where.params }),
      client.rows(`
        WITH players AS (${playerBase})
        SELECT multiIf(
                 first_play_time_ms = 0, 'unknown',
                 first_play_time_ms <= 300000, '0_5m',
                 first_play_time_ms <= 600000, '5_10m',
                 first_play_time_ms <= 1200000, '10_20m',
                 first_play_time_ms <= 1800000, '20_30m',
                 first_play_time_ms <= 3600000, '30_60m', '60m_plus'
               ) bucket,
               count() users, countIf(run_count = 1) one_run_users
        FROM players GROUP BY bucket
      `, { params: where.params })
    ]);
    const summaryRow = summaryRows[0] || {};
    const totalUsers = number(summaryRow.linked_users);
    const usage = Object.fromEntries(USER_METRIC_TYPES.map(type => [type, []]));
    for (const row of entityRows) {
      if (!usage[row.type]) continue;
      usage[row.type].push({
        ...descriptor(row), key: row.key, name: row.name || '미기록',
        uniqueUsers: number(row.users), usageRate: decimal(row.usage_rate)
      });
    }
    const chapters = chapterRows.map(row => ({
      chapter: number(row.chapter), reachedUsers: number(row.users),
      reachRate: percent(number(row.users), totalUsers)
    }));
    const levelCounts = levelRows.map(row => ({ level: number(row.level), retiredUsers: number(row.retired_users) }));
    let reached = 0;
    const levels = [];
    for (let index = levelCounts.length - 1; index >= 0; index -= 1) {
      reached += levelCounts[index].retiredUsers;
      levels.unshift({ ...levelCounts[index], reachedUsers: reached, reachRate: percent(reached, totalUsers), retireRate: percent(levelCounts[index].retiredUsers, reached) });
    }
    const bucketOrder = ['0_5m', '5_10m', '10_20m', '20_30m', '30_60m', '60m_plus', 'unknown'];
    const durationByKey = new Map(durationRows.map(row => [row.bucket, row]));
    const firstPlay = bucketOrder.map(bucket => {
      const row = durationByKey.get(bucket) || {};
      const users = number(row.users), oneRunUsers = number(row.one_run_users);
      return { bucket, users, oneRunUsers, exitRate: percent(oneRunUsers, users) };
    }).filter(row => row.users > 0);
    return envelope(filter, current, {
      accountLinkedOnly: true,
      summary: {
        uniqueUsers: totalUsers, runs: number(summaryRow.runs), oneRunUsers: number(summaryRow.one_run_users),
        oneRunRate: percent(number(summaryRow.one_run_users), totalUsers), averageRuns: decimal(summaryRow.average_runs),
        unknownChapterUsers: number(summaryRow.unknown_chapter_users)
      },
      usage, chapters, levels, firstPlay,
      definitions: {
        uniqueUser: '조회 기간에 계정 연동 UID로 확인된 사용자를 한 번만 집계합니다.',
        usageRate: '해당 항목을 한 번 이상 사용한 고유 사용자 ÷ 전체 계정 연동 고유 사용자입니다.',
        chapter: '로그의 Chapter 또는 Stage에서 확인한 최대 챕터 도달값입니다.',
        retirement: '조회 기간 내 해당 단계가 최고 기록인 사용자입니다.',
        firstPlay: '조회 기간 내 처음 관측된 출정의 플레이 시간이며 앱 실행 세션 시간은 아닙니다.'
      }
    });
  }

  return { publication, meta, dashboard, results, builds, buildDetail, bosses, bossDetail, users };
}

async function nodeDetailSelectionRate(client, where, entityKey, characterKey, item) {
  const id = Number(item.id);
  if (!Number.isInteger(id) || id < 0) return Math.min(100, number(item.selectionRate));
  const stage = id === 999 ? 999 : Math.floor(id / 10);
  const rows = await client.rows(`
    SELECT entity_key key, sum(runs) runs
    FROM analytics_daily_entities
    WHERE ${where.sql} AND entity_type = 'nodes' AND character_key = {characterKey:String}
      AND if(JSONExtractInt(descriptor_json, 'id') = 999, 999, intDiv(JSONExtractInt(descriptor_json, 'id'), 10)) = {nodeStage:Int16}
      AND NOT match(descriptor_json, 'node:name:-?[0-9]+')
    GROUP BY entity_key
  `, { params: { ...where.params, characterKey, nodeStage: stage } });
  const total = rows.reduce((sum, row) => sum + number(row.runs), 0);
  const selected = number(rows.find(row => row.key === entityKey)?.runs);
  return percent(selected, total);
}

async function itemInsights(client, filter, entityType, entityKey, itemRuns) {
  const where = rawSqlFilter(filter);
  const params = { ...where.params, entityType, key: entityKey };
  const selectedEvents = rawSelectedEventsSql('analytics_entities', where.sql, entityType);
  const selectedBossEvents = rawSelectedEventsSql('analytics_boss_entities', where.sql, entityType, true);
  const relatedTypes = RELATED_DETAIL_TYPES[entityType] || [];
  const tasks = [client.rows(`
    WITH selected_boss_events AS (${selectedBossEvents})
    SELECT multiIf(
             kills.boss_key IN ('id:B302', 'B302', 'legacy-master:B302') OR kills.boss_name = '베네딕트', 'B302',
             kills.boss_key IN ('id:B504', 'B504', 'legacy-master:B504') OR kills.boss_name = '누트', 'B504',
             '') boss_code,
           avg(kills.fight_duration_ms) average_ms,
           uniqExact(kills.event_id) kills
    FROM (
      SELECT event_id, boss_key, boss_name, fight_duration_ms
      FROM analytics_events FINAL
      WHERE ${where.sql} AND event_type = 'bossKill' AND fight_duration_ms > 0
        AND (boss_key IN ('id:B302', 'B302', 'legacy-master:B302', 'id:B504', 'B504', 'legacy-master:B504')
          OR boss_name IN ('베네딕트', '누트'))
    ) kills INNER JOIN selected_boss_events USING (event_id, boss_key)
    GROUP BY boss_code HAVING boss_code != ''
  `, { params })];

  if (SYNERGY_DETAIL_TYPES.has(entityType)) tasks.push(client.rows(`
    WITH selected_events AS (${selectedEvents})
    SELECT arrayJoin(JSONExtract(events.descriptor_json, 'collectionIds', 'Array(Int32)')) collection_id,
           uniqExact(events.event_id) uses
    FROM (
      SELECT event_id, descriptor_json
      FROM analytics_events FINAL
      WHERE ${where.sql} AND event_type = 'battleResult'
    ) events INNER JOIN selected_events USING (event_id)
    GROUP BY collection_id ORDER BY uses DESC LIMIT 500
  `, { params }));

  if (relatedTypes.length) tasks.push(client.rows(`
    WITH selected_events AS (${selectedEvents})
    SELECT related.entity_type type, related.entity_key key,
           argMax(related.entity_name, related.event_time) name,
           argMax(related.descriptor_json, related.event_time) descriptor,
           uniqExact(related.event_id) runs
    FROM (
      SELECT event_id, event_time, entity_type, entity_key, entity_name, descriptor_json
      FROM analytics_entities FINAL
      WHERE ${where.sql} AND entity_type IN (${relatedTypes.map(type => `'${type}'`).join(', ')})
        AND ${VALID_WEAPON_RUNE_SQL}
        AND NOT match(descriptor_json, 'node:name:-?[0-9]+')
    ) related INNER JOIN selected_events USING (event_id)
    WHERE NOT (related.entity_type = {entityType:String} AND related.entity_key = {key:String})
    GROUP BY related.entity_type, related.entity_key
    ORDER BY type, runs DESC, name ASC LIMIT 5 BY type
  `, { params }));

  const results = await Promise.all(tasks);
  let resultIndex = 0;
  const bossRows = results[resultIndex++];
  const bossByCode = new Map(bossRows.map(row => [String(row.boss_code), row]));
  const bossKillTimes = LAST_BOSSES.map(boss => {
    const row = bossByCode.get(boss.code);
    const meta = getBossMeta(boss.code, boss.name, 'Boss');
    return {
      code: boss.code, name: meta?.name || boss.name,
      averageMs: row ? Math.round(number(row.average_ms)) : null,
      kills: number(row?.kills)
    };
  });

  let synergies = [];
  if (SYNERGY_DETAIL_TYPES.has(entityType)) {
    synergies = results[resultIndex++].map(row => {
      const id = number(row.collection_id); const meta = getCollectionMeta(id);
      return meta && /\uc2dc\ub108\uc9c0/.test(meta.effect || '') ? {
        id, name: meta.name || `\uc2dc\ub108\uc9c0 ${id}`, effect: meta.effect || '',
        uses: number(row.uses), usageRate: percent(number(row.uses), itemRuns)
      } : null;
    }).filter(Boolean).slice(0, 3);
  }

  const related = Object.create(null);
  if (relatedTypes.length) {
    for (const row of results[resultIndex] || []) {
      (related[row.type] ||= []).push({
        ...descriptor(row), key: row.key, name: row.name || '미기록', runs: number(row.runs),
        usageRate: percent(number(row.runs), itemRuns)
      });
    }
  }
  return { bossKillTimes, synergies, related };
}

function rawSelectedEventsSql(table, whereSql, entityType, boss = false) {
  const eventKindSql = boss ? "AND event_kind = 'bossKill'" : '';
  const completeNodeSql = entityType === 'nodes' ? `AND event_id IN (
    SELECT event_id FROM ${table} FINAL
    WHERE ${whereSql} AND entity_type = 'nodes' ${eventKindSql}
      AND NOT match(descriptor_json, 'node:name:-?[0-9]+')
    GROUP BY event_id
    HAVING uniqExact(JSONExtractInt(descriptor_json, 'id')) >= 12
       AND countIf(JSONExtractInt(descriptor_json, 'id') BETWEEN 110 AND 119) > 0
  )` : '';
  return `SELECT DISTINCT event_id${boss ? ', boss_key' : ''}
    FROM ${table} FINAL
    WHERE ${whereSql} AND entity_type = {entityType:String} AND entity_key = {key:String}
      ${eventKindSql}
      AND ${VALID_WEAPON_RUNE_SQL}
      AND NOT match(descriptor_json, 'node:name:-?[0-9]+')
      ${completeNodeSql}`;
}

async function characterComponents(client, where, characterKey) {
  const rows = await client.rows(`
    WITH character_total AS (
      SELECT sum(runs) denominator
      FROM analytics_daily_entities
      WHERE ${where.sql} AND entity_type = 'characters' AND entity_key = {characterKey:String}
    ), complete_node_total AS (
      SELECT sum(runs) denominator
      FROM analytics_daily_entities
      WHERE ${where.sql} AND entity_type = 'nodeCombinations' AND character_key = {characterKey:String}
        AND ${COMPLETE_NODE_COMBINATION_SQL}
    )
    SELECT entity_type type, entity_key key, argMax(entity_name, event_date) name, argMax(descriptor_json, event_date) descriptor,
           sum(runs) runs, sum(clears) clears, uniqCombined64Merge(players) players,
           complete_node_total.denominator complete_node_runs,
           if(runs = 0, 0, clears * 100.0 / runs) clear_rate,
           if(entity_type IN ('nodes', 'nodeCombinations', 'combinationsWithNodes'),
              if(complete_node_total.denominator = 0, 0, runs * 100.0 / complete_node_total.denominator),
              if(character_total.denominator = 0, 0, runs * 100.0 / character_total.denominator)) selection_rate
    FROM analytics_daily_entities CROSS JOIN character_total CROSS JOIN complete_node_total
    WHERE ${where.sql} AND character_key = {characterKey:String}
      AND NOT match(descriptor_json, 'node:name:-?[0-9]+')
      AND ${VALID_WEAPON_RUNE_SQL}
      AND (entity_type NOT IN ('nodeCombinations', 'combinationsWithNodes') OR (${COMPLETE_NODE_COMBINATION_SQL}))
      AND entity_type NOT IN ('characters', 'combinationCollections', 'combinationCollectionsWithNodes')
    GROUP BY entity_type, entity_key, character_total.denominator, complete_node_total.denominator
    ORDER BY type, runs DESC
    LIMIT 160 BY type
  `, { params: { ...where.params, characterKey } });
  const grouped = Object.create(null);
  for (const row of rows) {
    const type = row.type === 'combinationsWithNodes' ? 'combinationsWithNodes' : row.type;
    const limit = type === 'sinPoints' ? 147 : (type === 'nodes' ? 64 : (type.startsWith('combination') || type === 'nodeCombinations' ? 20 : 12));
    if ((grouped[type] ||= []).length >= limit) continue;
    grouped[type].push({
      ...descriptor(row), key: row.key, name: row.name,
      runs: number(row.runs), clears: number(row.clears), uniquePlayers: number(row.players),
      selectionRate: decimal(row.selection_rate), clearRate: decimal(row.clear_rate)
    });
  }
  if (grouped.nodes?.length) {
    const completeNodeRuns = number(rows.find(row => row.type === 'nodes')?.complete_node_runs);
    grouped.nodes = normalizeNodeSelectionRates(grouped.nodes, completeNodeRuns);
  }
  return grouped;
}

function normalizeNodeSelectionRates(items, completeNodeRuns = 0) {
  const normalized = items.map(item => ({ ...item }));
  const stages = new Map();
  for (let index = 0; index < normalized.length; index += 1) {
    const id = Number(normalized[index].id);
    if (!Number.isInteger(id) || id < 0 || id === 999) continue;
    const stage = Math.floor(id / 10);
    if (!stages.has(stage)) stages.set(stage, []);
    stages.get(stage).push(index);
  }
  for (const indexes of stages.values()) {
    const total = indexes.reduce((sum, index) => sum + number(normalized[index].runs), 0);
    if (!total) {
      for (const index of indexes) normalized[index].selectionRate = 0;
      continue;
    }
    const allocations = indexes.map(index => {
      const exact = number(normalized[index].runs) * 1000 / total;
      const units = Math.floor(exact);
      return { index, units, remainder: exact - units };
    });
    let remaining = 1000 - allocations.reduce((sum, allocation) => sum + allocation.units, 0);
    allocations.sort((left, right) => right.remainder - left.remainder || number(normalized[right.index].runs) - number(normalized[left.index].runs));
    for (let index = 0; index < remaining; index += 1) allocations[index % allocations.length].units += 1;
    for (const allocation of allocations) normalized[allocation.index].selectionRate = allocation.units / 10;
  }
  for (const item of normalized) {
    const id = Number(item.id);
    if (!Number.isInteger(id) || id === 999) item.selectionRate = Math.min(100, percent(number(item.runs), completeNodeRuns));
  }
  return normalized;
}

async function combinationCollections(client, where, combinationKey, entityType, combinationRuns) {
  const rows = await client.rows(`
    SELECT entity_key key, argMax(entity_name, event_date) name, argMax(descriptor_json, event_date) descriptor,
           sum(runs) activations, sum(clears) clears
    FROM analytics_daily_entities
    WHERE ${where.sql} AND entity_type = {entityType:String}
      AND startsWith(entity_key, {prefix:String})
    GROUP BY entity_key ORDER BY activations DESC
  `, { params: { ...where.params, entityType, prefix: `${combinationKey}|collection:` } });
  return rows.map(row => {
    const details = descriptor(row); const meta = getCollectionMeta(details.collectionId);
    return {
      id: details.collectionId, name: meta?.name || row.name, effect: meta?.effect || details.effect || '',
      activations: number(row.activations), activationRate: percent(number(row.activations), combinationRuns),
      clearRate: percent(number(row.clears), number(row.activations))
    };
  });
}

function parseFilter(params, nowMs) {
  const retentionDays = readRetentionDays();
  const today = new Date(nowMs); const defaultFrom = new Date(today.getTime() - 6 * 86_400_000);
  const from = dateParam(params.get('from'), defaultFrom);
  const to = dateParam(params.get('to'), today);
  if (from > to) throw httpError(400, '시작일은 종료일보다 늦을 수 없습니다.');
  if ((to - from) / 86_400_000 >= retentionDays) throw httpError(400, `조회 기간은 최대 ${retentionDays}일입니다.`);
  const version = safeText(params.get('version'), 40);
  if (version && !/^\d+\.\d+\.(?:\d+|x)$/.test(version)) throw httpError(400, '게임 버전 필터가 올바르지 않습니다.');
  const minLevelRaw = params.get('minModeLevel');
  const minModeLevel = minLevelRaw === null || minLevelRaw === '' ? null : Number(minLevelRaw);
  if (minModeLevel !== null && (!Number.isInteger(minModeLevel) || minModeLevel < 0 || minModeLevel > 999)) throw httpError(400, '최소 단계가 올바르지 않습니다.');
  return { from: isoDate(from), to: isoDate(to), version, mode: safeText(params.get('mode'), 80), minModeLevel, afterFirstMiddleBoss: truthy(params.get('afterFirstMiddleBoss')) };
}

function sqlFilter(filter, revision = '') {
  const clauses = ['revision = {revision:String}', 'event_date >= {from:Date}', 'event_date <= {to:Date}'];
  const params = { revision, from: filter.from, to: filter.to };
  if (filter.version) { const family = filter.version.endsWith('.x'); clauses.push(`${family ? 'version_family' : 'version'} = {version:String}`); params.version = filter.version; }
  if (filter.mode) { clauses.push('game_mode = {mode:String}'); params.mode = filter.mode; }
  if (filter.minModeLevel !== null) { clauses.push('mode_level >= {minModeLevel:Int16}'); params.minModeLevel = filter.minModeLevel; }
  if (filter.afterFirstMiddleBoss) clauses.push('after_first_middle = 1');
  return { sql: clauses.join(' AND '), params };
}

function rawSqlFilter(filter) {
  const clauses = ['event_date >= {from:Date}', 'event_date <= {to:Date}'];
  const params = { from: filter.from, to: filter.to };
  if (filter.version) { const family = filter.version.endsWith('.x'); clauses.push(`${family ? 'version_family' : 'version'} = {version:String}`); params.version = filter.version; }
  if (filter.mode) { clauses.push('game_mode = {mode:String}'); params.mode = filter.mode; }
  if (filter.minModeLevel !== null) { clauses.push('mode_level >= {minModeLevel:Int16}'); params.minModeLevel = filter.minModeLevel; }
  if (filter.afterFirstMiddleBoss) clauses.push('after_first_middle = 1');
  return { sql: clauses.join(' AND '), params };
}

function pageInput(params) { const page = clampInt(params.get('page'), 1, 100_000, 1); const limit = clampInt(params.get('pageSize'), 10, 100, 50); return { page, limit, offset: (page - 1) * limit }; }
function sortInput(params, fallback) { const key = SORTS[params.get('sort')] ? params.get('sort') : fallback; const direction = String(params.get('direction') || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc'; return { key, direction }; }
function buildType(value) { const type = String(value || ''); if (!BUILD_TYPES.has(type)) throw httpError(400, '빌드 분석 대상이 올바르지 않습니다.'); return type; }
function selectionRateScope(type) { return CHARACTER_SCOPED_TYPES.has(String(type || '')) ? 'character' : 'global'; }
function envelope(filter, publication, payload) { return { revision: publication.revision, publishedAt: publication.completedAt, dataThrough: publication.dataThrough, publication, uniquePlayersApproximate: true, filter, ...payload }; }
function resultItem(row) { const runs = number(row.runs), clears = number(row.clears), deaths = number(row.deaths); return { key: row.key || '미기록', runs, clears, deaths, fails: number(row.fails), players: number(row.players), clearRate: percent(clears, runs), deathRate: percent(deaths, runs), playTime: distribution(row.play_time) }; }
function buildItem(row) { return { ...descriptor(row), key: row.key, name: row.name || '미기록', runs: number(row.runs), clears: number(row.clears), uniquePlayers: number(row.players), selectionRate: decimal(row.selection_rate), clearRate: row.clear_rate === undefined ? percent(number(row.clears), number(row.runs)) : decimal(row.clear_rate), playTime: distribution(row.play_time) }; }
function bossItem(row) { const rawId=String(row.key||'').replace(/^id:/,''); const meta=getBossMeta(rawId,row.name,row.rank); return { key: row.key, id: meta?.code||rawId, imageCode: meta?.imageCode||meta?.code||rawId, name: row.name || meta?.name || '알 수 없는 보스', rank: row.rank || meta?.rank || '미기록', encounterCount: number(row.encounters), killCount: number(row.kills), matchedKills: number(row.matched_kills), uniquePlayers: number(row.players), encounterClearRate: row.encounter_clear_rate === undefined ? percent(number(row.matched_kills), number(row.encounters)) : decimal(row.encounter_clear_rate), fightDuration: distribution(row.fight_time) }; }
function descriptor(row) { try { const value = JSON.parse(row.descriptor || '{}'); return value && typeof value === 'object' ? value : {}; } catch { return {}; } }
function distribution(value) { const list = Array.isArray(value) ? value.map(number) : []; return { sampleSize: list.length ? 1 : 0, medianMs: list[0] || null, p90Ms: list[1] || null }; }
function percent(value, total) { return total ? Math.round(value / total * 1000) / 10 : 0; }
function decimal(value) { const numberValue = Number(value); return Number.isFinite(numberValue) ? Math.round(numberValue * 10) / 10 : 0; }
function number(value) { const result = Number(value); return Number.isFinite(result) ? result : 0; }
function nullableLevel(value) { const numberValue = Number(value); return Number.isInteger(numberValue) && numberValue >= 0 ? numberValue : null; }
function truthy(value) { return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase()); }
function clampInt(value, min, max, fallback) { const numberValue = Number.parseInt(String(value ?? ''), 10); return Number.isInteger(numberValue) ? Math.max(min, Math.min(max, numberValue)) : fallback; }
function safeText(value, max) { const text = String(value || '').trim(); if (text.length > max || /[\u0000-\u001f]/.test(text)) throw httpError(400, '필터 문자열이 올바르지 않습니다.'); return text; }
function dateParam(value, fallback) { if (!value) return new Date(Date.UTC(fallback.getUTCFullYear(), fallback.getUTCMonth(), fallback.getUTCDate())); if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw httpError(400, '날짜 형식이 올바르지 않습니다.'); const date = new Date(`${value}T00:00:00Z`); if (Number.isNaN(date.getTime())) throw httpError(400, '날짜 형식이 올바르지 않습니다.'); return date; }
function isoDate(date) { return date.toISOString().slice(0, 10); }
function versionFamily(value) { const match = String(value || '').match(/^(\d+)\.(\d+)\./); return match ? `${match[1]}.${match[2]}.x` : ''; }
function compareVersions(left, right) {
  const parts = value => String(value).split('.').map(part => part === 'x' ? -1 : Number.parseInt(part, 10));
  const a = parts(left), b = parts(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? -1) - (b[index] ?? -1);
    if (difference) return difference;
  }
  return String(left).localeCompare(String(right), 'ko');
}
function stamp(value) { if (!value) return null; const text = String(value).replace(' ', 'T'); return `${text}${/[zZ]|[+-]\d\d:\d\d$/.test(text) ? '' : 'Z'}`; }
function httpError(statusCode, message) { const error = new Error(message); error.statusCode = statusCode; return error; }

export { normalizeNodeSelectionRates, parseFilter, selectionRateScope, sqlFilter };
