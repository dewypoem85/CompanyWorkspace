import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createMockProductPlayFabClient } from '../lib/product-playfab.js';
import { createProductCommandApi } from '../lib/product-command-api.js';
import { createPlayerDataApi } from '../lib/player-data-api.js';

test('config는 테스트/라이브 서버를 각각 노출하고 Secret Key는 노출하지 않는다', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cs-env-config-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const api = createProductCommandApi({
    dataDir: dir,
    liveEnabled: true,
    environmentClients: {
      live: createMockProductPlayFabClient(),
      test: createMockProductPlayFabClient()
    }
  });
  const payload = (await api.handle({
    path: '/api/playfab/product-commands/config',
    body: {}, authenticatedUser: 'tester', requestId: '1', ip: '127.0.0.1'
  })).payload;
  assert.equal(payload.defaultEnvironment, 'live');
  assert.deepEqual(payload.environments.map((item) => item.id), ['live', 'test']);
  assert.doesNotMatch(JSON.stringify(payload), /secret/i);
});

test('플레이어 데이터 config도 라이브 서버를 기본으로 선택한다', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cs-player-env-config-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const api = createPlayerDataApi({
    dataDir: dir,
    liveEnabled: true,
    environmentClients: {
      live: createMockProductPlayFabClient(),
      test: createMockProductPlayFabClient()
    }
  });
  const payload = (await api.handle({
    path: '/api/playfab/player-data/config',
    body: {}, authenticatedUser: 'tester', requestId: '1', ip: '127.0.0.1'
  })).payload;
  assert.equal(payload.defaultEnvironment, 'live');
  assert.equal(payload.environments.live.configured, true);
  assert.equal(payload.environments.test.configured, true);
  assert.doesNotMatch(JSON.stringify(payload), /secret/i);
});
