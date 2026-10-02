import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSteamReportIndex } from '../lib/steam-report-index.js';

const steamId = '76561198000000000';
const otherSteamId = '76561198000000001';
const transaction = (orderId, transactionId, owner, time) => ({
  orderId,
  transactionId,
  steamId: owner,
  status: 'Succeeded',
  currency: 'KRW',
  country: 'KR',
  time,
  items: [{ itemId: '100', quantity: '1', amount: '1000', vat: '100', status: 'Succeeded' }]
});

test('Steam 거래 보고서는 한 번만 증분 동기화하고 Steam ID별 전체 내역을 영구 색인한다', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-steam-index-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'transactions.json');
  const first = transaction('100', '200', steamId, '2026-01-01T00:00:00Z');
  const second = transaction('101', '201', steamId, '2026-02-01T00:00:00Z');
  const other = transaction('102', '202', otherSteamId, '2026-02-01T00:00:01Z');
  const calls = [];
  const batches = [[first], [first, second, other], [other]];
  const index = createSteamReportIndex({
    steamClient: { getTransactionReport: async cursor => { calls.push(cursor); return batches.shift() ?? []; } },
    filePath,
    namespace: '2712460/production'
  });

  const [left, right] = await Promise.all([index.findBySteamId(steamId), index.findBySteamId(otherSteamId)]);
  assert.deepEqual(left.transactions.map(value => value.transactionId), ['201', '200']);
  assert.deepEqual(right.transactions.map(value => value.transactionId), ['202']);
  assert.equal(calls.length, 3);

  const restored = createSteamReportIndex({
    steamClient: { getTransactionReport: async cursor => { calls.push(cursor); return []; } },
    filePath,
    namespace: '2712460/production'
  });
  const cached = await restored.findBySteamId(steamId);
  assert.deepEqual(cached.transactions.map(value => value.transactionId), ['201', '200']);
  assert.equal(calls.at(-1), '2026-02-01T00:00:01Z');
});

test('동시 Steam ID 검색은 진행 중인 보고서 동기화를 공유한다', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cs-steam-index-lock-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let calls = 0;
  const index = createSteamReportIndex({
    steamClient: { getTransactionReport: async () => { calls += 1; await gate; return []; } },
    filePath: path.join(directory, 'transactions.json'),
    namespace: '2712460/production'
  });
  const searches = [index.findBySteamId(steamId), index.findBySteamId(otherSteamId)];
  for (let attempt = 0; calls === 0 && attempt < 20; attempt += 1) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(calls, 1);
  release();
  await Promise.all(searches);
  assert.equal(calls, 1);
});
