import assert from 'node:assert/strict';
import { createClickHouseClient } from '../lib/clickhouse-client.js';
import { createClickHouseIngestor } from '../lib/clickhouse-ingest.js';
import { ensureClickHouseSchema } from '../lib/clickhouse-schema.js';
import { createClickHouseStatistics } from '../lib/clickhouse-statistics.js';

if (process.env.CLICKHOUSE_SMOKE !== '1') process.exit(0);

const client = createClickHouseClient();
const timestamp = Date.parse('2026-09-20T03:00:00Z');
const common = {
  timestamp, playerId: 'smoke-player', version: '0.772.3', platform: 'Windows', mode: 'Challenge', modeLevel: 7,
  schemaEra: 'id', characterId: 0, characterName: '기사', characterLevel: 30, skinId: 0, skinName: '기본 스킨',
  weaponId: 0, weaponName: '철검', subWeaponId: null, subWeaponName: '', petId: 0, petName: '플라스크',
  hasNodeIds: true, nodeIds: [0, 10], nodeNames: [], collectionIds: [1], hasEquipSkillIds: true,
  equipSkillIds: [0], hasEquipSkillNames: false, equipSkillNames: [], hasEquipArtifactKeys: true,
  equipArtifactKeys: ['0'], hasEquipArtifactNames: false, equipArtifactNames: [], hasEquippedRunes: true,
  equippedRuneIds: [], equippedRuneNames: [], reachedFirstMiddleBoss: true, stage: '1-Boss'
};
const events = [
  { ...common, id: 'run-1', type: 'battleResult', runId: 'run-1', resultType: 'Clear', isClear: true, isDead: false, playTimeMs: 600000, encounterId: '', bossKey: '', bossName: '', bossRank: '', fightDurationMs: 0 },
  { ...common, id: 'encounter-1', type: 'bossEncounter', runId: 'run-1', resultType: '', isClear: false, isDead: false, playTimeMs: 0, encounterId: 'enc-1', bossKey: 'B1', bossName: '탐욕', bossRank: '챕터 보스', fightDurationMs: 0 },
  { ...common, id: 'kill-1', type: 'bossKill', runId: 'run-1', resultType: '', isClear: false, isDead: false, playTimeMs: 0, encounterId: 'enc-1', bossKey: 'B1', bossName: '탐욕', bossRank: '챕터 보스', fightDurationMs: 30000 }
];

try {
  await ensureClickHouseSchema(client);
  const blobs = [{ name: 'smoke/date=20260920/log.parquet', dateKey: '20260920', byteLength: 1024 }];
  const source = { listAllParquetBlobs: async () => blobs, readEvents: async blob => blob.dateKey === '20260920' ? events : [{ ...events[0], id: 'run-2', timestamp: Date.parse('2026-09-21T03:00:00Z'), playerId: 'smoke-player-2' }] };
  const ingestor = createClickHouseIngestor({ client, source, now: () => Date.parse('2026-09-21T01:00:00Z'), concurrency: 1 });
  const publication = await ingestor.refresh({ full: true });
  assert.equal(publication.status, 'ready');
  const service = createClickHouseStatistics({ client, now: () => Date.parse('2026-09-21T01:00:00Z') });
  const params = new URLSearchParams({ from: '2026-09-20', to: '2026-09-20' });
  const dashboard = await service.dashboard(params);
  assert.equal(dashboard.summary.totalRuns, 1);
  assert.equal(dashboard.summary.clears, 1);
  const bosses = await service.bosses(params);
  assert.equal(bosses.items[0].matchedKills, 1);
  const builds = await service.builds('characters', params);
  assert.equal(builds.items[0].name, '기사');
  const detail = await service.buildDetail('characters', builds.items[0].key, params);
  assert.ok(detail.item.components.weapons.length > 0);
  blobs.push({ name: 'smoke/date=20260921/log.parquet', dateKey: '20260921', byteLength: 1024 });
  const incremental = await ingestor.refresh();
  assert.notEqual(incremental.revision, publication.revision);
  const twoDays = await service.dashboard(new URLSearchParams({ from: '2026-09-20', to: '2026-09-21' }));
  assert.equal(twoDays.summary.totalRuns, 2);
  const noChanges = await ingestor.refresh();
  assert.equal(noChanges.revision, incremental.revision);
  console.log(JSON.stringify({ ok: true, revision: incremental.revision, dashboardBytes: Buffer.byteLength(JSON.stringify(twoDays)), bossCount: bosses.total }));
} finally {
  await client.command(`DROP DATABASE IF EXISTS ${client.database}`, { useDatabase: false });
}
