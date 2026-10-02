import test from 'node:test';
import assert from 'node:assert/strict';
import { createAzureProcessedStore } from '../lib/azure-processed-store.js';

test('통계 전용 Azure 저장소에 일별 청크·manifest·snapshot을 분리해 저장한다', async () => {
  const blobs = new Map();
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(url);
    const name = parsed.pathname.split('/').slice(2).map(decodeURIComponent).join('/');
    requests.push({ method: init.method || 'GET', name, headers: init.headers });
    if ((init.method || 'GET') === 'PUT') {
      if (init.headers?.['If-None-Match'] === '*' && blobs.has(name)) return new Response('', { status: 412 });
      blobs.set(name, String(init.body || ''));
      return new Response('', { status: 201 });
    }
    if (!blobs.has(name)) return new Response('', { status: 404 });
    return new Response(blobs.get(name), { status: 200 });
  };
  const store = createAzureProcessedStore({
    storageAccount: 'storage123', container: 'statistics', sasToken: 'sp=rcwl&sig=test',
    prefix: 'playfab-analytics/v1', titleId: 'LIVE', fetchImpl
  });
  const chunk = 'chunk-0123456789abcdef.ndjson';
  const manifest = { revision: 1, date: '20260818', processed: { 'raw.parquet': 123 }, chunks: [chunk] };

  assert.equal(store.configured, true);
  assert.deepEqual(await store.writeDayChunk('20260818', chunk, '{"id":"one"}\n'), { created: true });
  assert.deepEqual(await store.writeDayChunk('20260818', chunk, 'duplicate'), { created: false });
  await store.writeDayManifest('20260818', manifest);
  await store.writeSnapshot('7d-0123456789ab', { summary: { totalRuns: 1 } });

  assert.equal(await store.readDayChunk('20260818', chunk), '{"id":"one"}\n');
  assert.deepEqual(await store.readDayManifest('20260818'), manifest);
  assert.deepEqual(await store.readSnapshot('7d-0123456789ab'), { summary: { totalRuns: 1 } });
  assert.ok(requests.some(request => request.name.endsWith('/date=20260818/manifest.json')));
  assert.ok(requests.some(request => request.name.endsWith('/snapshots/7d-0123456789ab.json')));
});

test('통계 저장소 설정이 없으면 비활성 상태로 생성된다', () => {
  const store = createAzureProcessedStore({ storageAccount: 'storage123', titleId: 'LIVE' });
  assert.equal(store.configured, false);
});
