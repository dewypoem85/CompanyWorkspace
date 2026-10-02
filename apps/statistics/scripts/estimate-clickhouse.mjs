import { createClickHouseClient } from '../lib/clickhouse-client.js';
import { ensureClickHouseSchema } from '../lib/clickhouse-schema.js';
import { createLegacyIndexSource } from '../lib/legacy-index-source.js';
import { insertBlob, rebuildDay } from '../lib/clickhouse-ingest.js';

const client = createClickHouseClient();
const source = await createLegacyIndexSource();
const state = source.state();
const sampleDate = process.env.STATISTICS_SAMPLE_DATE || state.days.at(-8);
const retentionDays = Number.parseInt(process.env.STATISTICS_RETENTION_DAYS || '90', 10);
const retainedDays = state.dayRows.slice(-retentionDays);
const retainedEvents = retainedDays.reduce((sum, row) => sum + row.rowCount, 0);
try {
  await ensureClickHouseSchema(client);
  let events = 0; let batches = 0;
  await source.scanBatches(async batch => {
    await insertBlob(client, { name: `sample/date=${batch.dateKey}/batch-${batch.batchIndex}.ndjson`, dateKey: batch.dateKey, byteLength: batch.byteLength }, batch.events, Date.now());
    events += batch.events.length; batches += 1;
    if (batches % 10 === 0) console.log(JSON.stringify({ progress: true, sampleDate, events, batches }));
  }, { days: [sampleDate] });
  await rebuildDay(client, `${sampleDate.slice(0,4)}-${sampleDate.slice(4,6)}-${sampleDate.slice(6,8)}`, 'estimate');
  await client.command('OPTIMIZE TABLE analytics_events FINAL');
  await client.command('OPTIMIZE TABLE analytics_entities FINAL');
  await client.command('OPTIMIZE TABLE analytics_boss_entities FINAL');
  const parts = await client.rows(`SELECT table, sum(rows) rows, sum(data_compressed_bytes) compressed_bytes, sum(data_uncompressed_bytes) uncompressed_bytes FROM system.parts WHERE database = {database:String} AND active GROUP BY table ORDER BY table`, { params: { database: client.database } });
  const compressed = parts.reduce((sum,row)=>sum+Number(row.compressed_bytes||0),0);
  const projected = events ? Math.ceil(compressed * retainedEvents / events) : 0;
  console.log(JSON.stringify({ sampleDate, events, retentionDays, retainedEvents, compressedBytes: compressed, projectedBytes: projected, requiredWithTwoTimesMargin: projected * 2, parts }));
} finally {
  await client.command(`DROP DATABASE IF EXISTS ${client.database}`, { useDatabase: false });
}
