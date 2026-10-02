import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPlayFabAnalytics } from '../lib/playfab-analytics.js';
import { publicationRevision, validRefreshReceipt } from '../lib/publication-contract.js';

for (const hasSource of [true, false]) test(`actual queue serializes intents and distinguishes acceptance from ${hasSource ? 'completion' : 'failure'}`, async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'statistics-queue-contract-'));
  let release, began;
  const hold = new Promise(resolve => { release = resolve; });
  const fetched = new Promise(resolve => { began = resolve; });
  let requests = 0;
  const analytics = createPlayFabAnalytics({ dataDir, storageAccount: 'storage123', container: 'logs',
    sasToken: 'sp=rl&sig=synthetic', liveTitleId: 'LIVE', now: () => Date.parse('2026-09-11T00:00:00Z'),
    fetchImpl: async url => {
      requests++; began(); await hold;
      const blob = hasSource && new URL(url).searchParams.get('prefix')?.includes('date=20260910')
        ? '<Blob><Name>data/title=LIVE/date=20260910/hour=01/part-1.parquet</Name><Properties><Content-Length>1234</Content-Length></Properties></Blob>' : '';
      return new Response(`<EnumerationResults><Blobs>${blob}</Blobs><NextMarker /></EnumerationResults>`, { status: 200 });
    },
    parquetReader: async () => [{ Timestamp: '2026-09-10T01:00:00Z', EntityLineage_master_player_account: 'SYNTHETIC',
      EventId: 'synthetic-run', FullName_Name: 'battle_result', EventData: JSON.stringify({
        Version: '0.772.1', Mode: 'Normal', ModeLevel: 3, Character: '기사', Weapon: '철검', IsClear: true, PlayTime: 10
      }) }]
  });
  let work;
  try {
    const id = 'a1111111-1111-4111-8111-111111111111';
    const expectedRevision = publicationRevision(analytics.getPublicationState());
    const [first, second] = await Promise.allSettled([
      analytics.requestPublishedRefresh({ expectedRevision, requestId: id, rejectIfRunning: true, enforceCooldown: true }),
      analytics.requestPublishedRefresh({ expectedRevision, requestId: 'a2222222-2222-4222-8222-222222222222', rejectIfRunning: true, force: true })
    ]);
    assert.equal(first.status, 'fulfilled');
    assert.equal(validRefreshReceipt(first.value, id), true);
    assert.equal(second.status, 'rejected');
    assert.equal(second.reason.statusCode, 409);
    work = analytics.queuePublishedRefresh(); // automatic callers retain the existing join behavior
    await fetched;
    assert.equal(analytics.getPublicationState().runId, id);
    await assert.rejects(analytics.requestPublishedRefresh({ force: true, rejectIfRunning: true,
      expectedRevision: publicationRevision(analytics.getPublicationState()) }), { statusCode: 409 });
    release();
    await work;
    assert.ok(requests > 0);
    assert.equal(analytics.getPublicationState().status, hasSource ? 'ready' : 'error');
    assert.equal(analytics.getPublicationState().runId, id);
    assert.equal(analytics.getPublicationState().inProgress, false);
    if (hasSource) await assert.rejects(analytics.requestPublishedRefresh({ enforceCooldown: true }), { statusCode: 429 });
    await assert.rejects(analytics.requestPublishedRefresh({ force: true, expectedRevision }), { statusCode: 409 });
  } finally {
    release(); if (work) await work;
    analytics.close(); await fs.rm(dataDir, { recursive: true, force: true });
  }
});

test('queue compares expected publication after disk initialization; invalid/stale intents cannot start work', async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'statistics-queue-restart-'));
  const now = Date.parse('2026-09-11T00:30:00Z');
  await fs.writeFile(path.join(dataDir, 'statistics-publication-state.json'), JSON.stringify({ completedAt: '2026-09-11T00:00:00Z' }));
  let calls = 0;
  const analytics = createPlayFabAnalytics({ dataDir, now: () => now, fetchImpl: () => { calls++; throw new Error('unexpected fetch'); } });
  try {
    const beforeLoading = publicationRevision(analytics.getPublicationState());
    analytics.startPublisher();
    await assert.rejects(analytics.requestPublishedRefresh({ force: true, expectedRevision: beforeLoading }), { statusCode: 409 });
    await assert.rejects(analytics.requestPublishedRefresh({ requestId: 'bad' }), { statusCode: 422 });
    await assert.rejects(analytics.requestPublishedRefresh({ force: true, expectedRevision: 'bad' }), { statusCode: 409 });
    await assert.rejects(analytics.requestPublishedRefresh({ enforceCooldown: true }), error => error.statusCode === 429 && error.retryAt === '2026-09-11T01:00:00.000Z');
    assert.equal(calls, 0);
    assert.equal(analytics.getPublicationState().runId, null);
    assert.equal(analytics.getPublicationState().status, 'idle');
  } finally {
    analytics.close(); await fs.rm(dataDir, { recursive: true, force: true });
  }
});
