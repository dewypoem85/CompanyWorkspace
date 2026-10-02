// 계정 연동 여부는 원본 Parquet에서 다시 읽어야 채워지는 값이다.
// 기존 적재 이력을 그대로 재사용하지 않도록 파이프라인 리비전을 올린다.
export const CLICKHOUSE_SCHEMA_REVISION = 9;

const RETENTION_TABLES = [
  'analytics_events',
  'analytics_entities',
  'analytics_boss_entities',
  'analytics_ingested_blobs',
  'analytics_daily_runs',
  'analytics_daily_entities',
  'analytics_daily_players',
  'analytics_daily_user_entities',
  'analytics_daily_bosses',
  'analytics_daily_boss_entities'
];

export async function ensureClickHouseSchema(client) {
  const retentionDays = readRetentionDays();
  await client.command(`CREATE DATABASE IF NOT EXISTS ${client.database}`, { useDatabase: false });
  for (const statement of schemaStatements(retentionDays)) await client.command(statement, { timeout: 120_000 });
  for (const statement of migrationStatements()) await client.command(statement, { timeout: 120_000 });
  for (const table of RETENTION_TABLES) {
    await client.command(`ALTER TABLE ${table} MODIFY TTL event_date + INTERVAL ${retentionDays} DAY DELETE`, { timeout: 120_000 });
  }
  await client.insertRows('analytics_schema', [{ revision: CLICKHOUSE_SCHEMA_REVISION, applied_at: new Date().toISOString().replace('T', ' ').replace('Z', '') }]);
}

function schemaStatements(retentionDays) {
  return [
    `CREATE TABLE IF NOT EXISTS analytics_events (
      event_id String,
      source_blob String,
      event_time DateTime64(3, 'UTC'),
      event_date Date MATERIALIZED toDate(event_time),
      player_hash UInt64,
      account_linked UInt8,
      event_type LowCardinality(String),
      version LowCardinality(String),
      version_family LowCardinality(String),
      platform LowCardinality(String),
      game_mode LowCardinality(String),
      mode_level Int16,
      after_first_middle UInt8,
      run_id String,
      schema_era LowCardinality(String),
      outcome LowCardinality(String),
      is_clear UInt8,
      is_dead UInt8,
      play_time_ms UInt64,
      stage String,
      chapter UInt8,
      encounter_id String,
      boss_key String,
      boss_name String,
      boss_rank LowCardinality(String),
      fight_duration_ms UInt64,
      descriptor_json String,
      ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
    ) ENGINE = ReplacingMergeTree(ingested_at)
    PARTITION BY event_date
    ORDER BY (event_date, version_family, version, game_mode, mode_level, event_type, event_id)
    TTL event_date + INTERVAL ${retentionDays} DAY DELETE`,

    `CREATE TABLE IF NOT EXISTS analytics_entities (
      event_id String,
      event_time DateTime64(3, 'UTC'),
      event_date Date MATERIALIZED toDate(event_time),
      player_hash UInt64,
      account_linked UInt8,
      version LowCardinality(String),
      version_family LowCardinality(String),
      platform LowCardinality(String),
      game_mode LowCardinality(String),
      mode_level Int16,
      after_first_middle UInt8,
      outcome LowCardinality(String),
      is_clear UInt8,
      play_time_ms UInt64,
      character_key String,
      entity_type LowCardinality(String),
      entity_key String,
      entity_name String,
      source LowCardinality(String),
      descriptor_json String,
      ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
    ) ENGINE = ReplacingMergeTree(ingested_at)
    PARTITION BY event_date
    ORDER BY (event_date, entity_type, version_family, version, game_mode, mode_level, character_key, entity_key, event_id)
    TTL event_date + INTERVAL ${retentionDays} DAY DELETE`,

    `CREATE TABLE IF NOT EXISTS analytics_boss_entities (
      event_id String,
      event_time DateTime64(3, 'UTC'),
      event_date Date MATERIALIZED toDate(event_time),
      player_hash UInt64,
      version LowCardinality(String),
      version_family LowCardinality(String),
      platform LowCardinality(String),
      game_mode LowCardinality(String),
      mode_level Int16,
      after_first_middle UInt8,
      encounter_id String,
      boss_key String,
      event_kind LowCardinality(String),
      character_key String,
      entity_type LowCardinality(String),
      entity_key String,
      entity_name String,
      descriptor_json String,
      ingested_at DateTime64(3, 'UTC') DEFAULT now64(3)
    ) ENGINE = ReplacingMergeTree(ingested_at)
    PARTITION BY event_date
    ORDER BY (event_date, boss_key, entity_type, version_family, version, game_mode, mode_level, character_key, entity_key, event_kind, event_id)
    TTL event_date + INTERVAL ${retentionDays} DAY DELETE`,

    `CREATE TABLE IF NOT EXISTS analytics_ingested_blobs (
      blob_name String,
      byte_length UInt64,
      event_date Date,
      event_count UInt64,
      pipeline_revision UInt32,
      ingested_at DateTime64(3, 'UTC')
    ) ENGINE = ReplacingMergeTree(ingested_at)
    ORDER BY blob_name
    TTL event_date + INTERVAL ${retentionDays} DAY DELETE`,

    `CREATE TABLE IF NOT EXISTS analytics_daily_players (
      revision String,
      event_date Date,
      version LowCardinality(String),
      version_family LowCardinality(String),
      platform LowCardinality(String),
      game_mode LowCardinality(String),
      mode_level Int16,
      after_first_middle UInt8,
      account_linked UInt8,
      player_hash UInt64,
      runs UInt32,
      max_chapter UInt8,
      play_time_sum UInt64,
      first_event_time DateTime64(3, 'UTC'),
      first_play_time_ms UInt64,
      last_event_time DateTime64(3, 'UTC')
    ) ENGINE = MergeTree
    PARTITION BY event_date
    ORDER BY (revision, event_date, version_family, version, platform, game_mode, mode_level, after_first_middle, account_linked, player_hash)
    TTL event_date + INTERVAL ${retentionDays} DAY DELETE`,

    `CREATE TABLE IF NOT EXISTS analytics_daily_user_entities (
      revision String,
      event_date Date,
      version LowCardinality(String),
      version_family LowCardinality(String),
      platform LowCardinality(String),
      game_mode LowCardinality(String),
      mode_level Int16,
      after_first_middle UInt8,
      account_linked UInt8,
      entity_type LowCardinality(String),
      entity_key String,
      entity_name String,
      descriptor_json String,
      players AggregateFunction(uniqCombined64, UInt64)
    ) ENGINE = AggregatingMergeTree
    PARTITION BY event_date
    ORDER BY (revision, event_date, entity_type, version_family, version, platform, game_mode, mode_level, after_first_middle, account_linked, entity_key)
    TTL event_date + INTERVAL ${retentionDays} DAY DELETE`,

    `CREATE TABLE IF NOT EXISTS analytics_publication (
      revision String,
      status LowCardinality(String),
      started_at Nullable(DateTime64(3, 'UTC')),
      completed_at Nullable(DateTime64(3, 'UTC')),
      data_through Nullable(DateTime64(3, 'UTC')),
      processed_blobs UInt64,
      processed_events UInt64,
      current_profile String,
      error String,
      updated_at DateTime64(3, 'UTC')
    ) ENGINE = ReplacingMergeTree(updated_at)
    ORDER BY tuple()`,

    `CREATE TABLE IF NOT EXISTS analytics_daily_runs (
      revision String,
      event_date Date,
      version LowCardinality(String),
      version_family LowCardinality(String),
      platform LowCardinality(String),
      game_mode LowCardinality(String),
      mode_level Int16,
      after_first_middle UInt8,
      runs UInt64,
      clears UInt64,
      deaths UInt64,
      fails UInt64,
      play_time_sum UInt64,
      players AggregateFunction(uniqCombined64, UInt64),
      play_time AggregateFunction(quantilesTDigest(0.5, 0.9), UInt64)
    ) ENGINE = AggregatingMergeTree
    PARTITION BY event_date
    ORDER BY (revision, event_date, version_family, version, platform, game_mode, mode_level, after_first_middle)
    TTL event_date + INTERVAL ${retentionDays} DAY DELETE`,

    `CREATE TABLE IF NOT EXISTS analytics_daily_entities (
      revision String,
      event_date Date,
      version LowCardinality(String),
      version_family LowCardinality(String),
      platform LowCardinality(String),
      game_mode LowCardinality(String),
      mode_level Int16,
      after_first_middle UInt8,
      character_key String,
      entity_type LowCardinality(String),
      entity_key String,
      entity_name String,
      source LowCardinality(String),
      descriptor_json String,
      runs UInt64,
      clears UInt64,
      players AggregateFunction(uniqCombined64, UInt64),
      play_time AggregateFunction(quantilesTDigest(0.5, 0.9), UInt64)
    ) ENGINE = AggregatingMergeTree
    PARTITION BY event_date
    ORDER BY (revision, event_date, entity_type, version_family, version, platform, game_mode, mode_level, after_first_middle, character_key, entity_key)
    TTL event_date + INTERVAL ${retentionDays} DAY DELETE`,

    `CREATE TABLE IF NOT EXISTS analytics_daily_bosses (
      revision String,
      event_date Date,
      version LowCardinality(String),
      version_family LowCardinality(String),
      platform LowCardinality(String),
      game_mode LowCardinality(String),
      mode_level Int16,
      after_first_middle UInt8,
      boss_key String,
      boss_name String,
      boss_rank LowCardinality(String),
      encounters UInt64,
      kills UInt64,
      matched_kills UInt64,
      players AggregateFunction(uniqCombined64, UInt64),
      fight_time AggregateFunction(quantilesTDigest(0.5, 0.9), UInt64)
    ) ENGINE = AggregatingMergeTree
    PARTITION BY event_date
    ORDER BY (revision, event_date, version_family, version, platform, game_mode, mode_level, after_first_middle, boss_key)
    TTL event_date + INTERVAL ${retentionDays} DAY DELETE`,

    `CREATE TABLE IF NOT EXISTS analytics_daily_boss_entities (
      revision String,
      event_date Date,
      version LowCardinality(String),
      version_family LowCardinality(String),
      platform LowCardinality(String),
      game_mode LowCardinality(String),
      mode_level Int16,
      after_first_middle UInt8,
      boss_key String,
      character_key String,
      entity_type LowCardinality(String),
      entity_key String,
      entity_name String,
      descriptor_json String,
      encounters UInt64,
      kills UInt64,
      matched_kills UInt64,
      players AggregateFunction(uniqCombined64, UInt64)
    ) ENGINE = AggregatingMergeTree
    PARTITION BY event_date
    ORDER BY (revision, event_date, boss_key, entity_type, version_family, version, platform, game_mode, mode_level, after_first_middle, character_key, entity_key)
    TTL event_date + INTERVAL ${retentionDays} DAY DELETE`,

    `CREATE TABLE IF NOT EXISTS analytics_schema (
      revision UInt32,
      applied_at DateTime64(3, 'UTC')
    ) ENGINE = ReplacingMergeTree(applied_at)
    ORDER BY tuple()`
  ];
}

function migrationStatements() {
  return [
    'ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS account_linked UInt8 DEFAULT 0',
    'ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS chapter UInt8 DEFAULT 0',
    'ALTER TABLE analytics_entities ADD COLUMN IF NOT EXISTS account_linked UInt8 DEFAULT 0',
    'ALTER TABLE analytics_ingested_blobs ADD COLUMN IF NOT EXISTS pipeline_revision UInt32 DEFAULT 0',
    "ALTER TABLE analytics_publication ADD COLUMN IF NOT EXISTS run_id String DEFAULT ''"
  ];
}

export function readRetentionDays(value = process.env.STATISTICS_RETENTION_DAYS) {
  const parsed = Number.parseInt(String(value || '90'), 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 3650) throw new Error('STATISTICS_RETENTION_DAYS는 1~3650 사이의 정수여야 합니다.');
  return parsed;
}
