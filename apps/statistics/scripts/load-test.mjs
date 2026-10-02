import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createClickHouseClient } from '../lib/clickhouse-client.js';
import { createClickHouseStatistics } from '../lib/clickhouse-statistics.js';

if (process.env.STATISTICS_LOAD_TEST !== '1') process.exit(0);

const concurrency = positiveInteger(process.env.STATISTICS_LOAD_CONCURRENCY, 50);
const client = createClickHouseClient();
const service = createClickHouseStatistics({ client });
const meta = await service.meta();
assert.equal(meta.publication.status, 'ready', '완료된 통계 publication이 필요합니다.');

const to = meta.range.to;
const from = maxDate(meta.range.from, shiftDate(to, -6));
const query = () => new URLSearchParams({ from, to });
const firstBuilds = await service.builds('characters', query());
const firstBosses = await service.bosses(query());
const characterKey = firstBuilds.items[0]?.key;
const bossKey = firstBosses.items[0]?.key;

const cases = [
  { name: 'dashboard', limitMs: 300, limitBytes: 100_000, run: () => service.dashboard(query()) },
  { name: 'results', limitMs: 500, limitBytes: 250_000, run: () => service.results(query()) },
  { name: 'builds-characters', limitMs: 500, limitBytes: 250_000, run: () => service.builds('characters', query()) },
  { name: 'builds-combinations', limitMs: 500, limitBytes: 250_000, run: () => service.builds('combinations', query()) },
  { name: 'bosses', limitMs: 500, limitBytes: 250_000, run: () => service.bosses(query()) }
];
if (characterKey) cases.push({ name: 'build-detail', limitMs: 800, limitBytes: 500_000, run: () => service.buildDetail('characters', characterKey, query()) });
if (bossKey) cases.push({ name: 'boss-detail', limitMs: 800, limitBytes: 500_000, run: () => service.bossDetail(bossKey, query()) });

for (const item of cases) await item.run();
const samples = await Promise.all(Array.from({ length: concurrency }, async (_, index) => {
  const item = cases[index % cases.length];
  const started = performance.now();
  const value = await item.run();
  return { name: item.name, elapsedMs: performance.now() - started, bytes: Buffer.byteLength(JSON.stringify(value)), limitMs: item.limitMs, limitBytes: item.limitBytes };
}));

const summary = cases.map(item => {
  const rows = samples.filter(sample => sample.name === item.name);
  const p95Ms = percentile(rows.map(row => row.elapsedMs), 0.95);
  const maxMs = Math.max(...rows.map(row => row.elapsedMs));
  const maxBytes = Math.max(...rows.map(row => row.bytes));
  return { name: item.name, requests: rows.length, p95Ms: Math.round(p95Ms * 10) / 10, maxMs: Math.round(maxMs * 10) / 10, maxBytes, limitMs: item.limitMs, limitBytes: item.limitBytes, passed: p95Ms <= item.limitMs && maxMs <= 2_000 && maxBytes <= item.limitBytes };
});
console.log(JSON.stringify({ ok: summary.every(row => row.passed), concurrency, revision: meta.publication.revision, range: { from, to }, summary }, null, 2));
if (summary.some(row => !row.passed)) process.exitCode = 1;

function positiveInteger(value, fallback) { const parsed = Number.parseInt(String(value || fallback), 10); return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback; }
function percentile(values, ratio) { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)] || 0; }
function shiftDate(value, offset) { const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + offset); return date.toISOString().slice(0, 10); }
function maxDate(left, right) { return left > right ? left : right; }
