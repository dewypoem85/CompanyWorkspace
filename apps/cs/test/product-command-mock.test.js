import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createProductCommandApi } from '../lib/product-command-api.js';

test('Mock 모드 실행은 실제 PlayFab 네트워크 API를 호출하지 않는다', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cs-product-mock-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error('Mock 모드에서 네트워크 호출이 발생하면 안 됩니다.');
  };
  t.after(() => { globalThis.fetch = originalFetch; });

  const api = createProductCommandApi({
    dataDir: dir,
    titleId: '',
    secretKey: '',
    liveEnabled: false,
    mockMode: true
  });

  const preview = (await api.handle({
    path: '/api/playfab/product-commands/preview',
    body: {
      operation: 'grant',
      playFabIds: ['AAAAAAAAAAAAAAAA'],
      memo: 'Mock 네트워크 검증',
      command: { currencies: { gem: 100 } }
    },
    authenticatedUser: { id: '15', name: '홍길동', email: 'hong@example.com' },
    requestId: 'preview',
    ip: '127.0.0.1'
  })).payload;

  const executed = (await api.handle({
    path: '/api/playfab/product-commands/execute',
    body: { previewToken: preview.previewToken, dryRun: false },
    authenticatedUser: { id: '15', name: '홍길동', email: 'hong@example.com' },
    requestId: 'execute',
    ip: '127.0.0.1'
  })).payload;

  assert.equal(executed.results[0].status, 'success');
  assert.equal(fetchCalls, 0);
  const audit = await readFile(path.join(dir, 'playfab-product-command-audit.jsonl'), 'utf8');
  assert.match(audit, /"userId":"15"/);
  assert.match(audit, /"userName":"홍길동"/);
  assert.match(audit, /"userEmail":"hong@example.com"/);
});
