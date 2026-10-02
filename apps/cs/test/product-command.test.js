import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  buildProductCommandValue,
  createProductRequestId,
  mergeProductCommandValue,
  normalizeProductCommand,
  validateProductCommandPreviewRequest
} from '../lib/product-command.js';
import {
  createMockProductPlayFabClient,
  createProductPlayFabClient,
  ProductPlayFabApiError
} from '../lib/product-playfab.js';
import { createProductCommandApi } from '../lib/product-command-api.js';

test('상품 명령 JSON은 빈 필드를 생략하고 회수 재화도 양수로 만든다', () => {
  const input = validateProductCommandPreviewRequest({
    operation: 'revoke',
    playFabIds: ['ABCDEF0123456789'],
    memo: '회수 테스트',
    command: {
      currencies: { gem: 1000, soul: '5,000', prayer: 0, rift: '', mileage: 100 },
      characters: [21],
      skins: ['21-3'],
      weapons: ['21-2'],
      pets: [5],
      packages: ['PACKAGE_A']
    }
  });

  assert.deepEqual(JSON.parse(buildProductCommandValue(input.command, 'revoke-test')), {
    '요청ID': 'revoke-test',
    '재화': { '젬': 1000, '영혼석': 5000, '마일리지': 100 },
    '캐릭터': [21],
    '스킨': ['21-3'],
    '무기': ['21-2'],
    '펫': [5],
    '패키지': ['PACKAGE_A']
  });
  assert.throws(() => normalizeProductCommand({ currencies: { gem: -1 } }), /0 이상의 정수/);
  assert.throws(() => normalizeProductCommand({ currencies: { mileage: -1 } }), /마일리지.*0 이상의 정수/);
});

test('지급과 회수 요청 ID는 서로 재사용하지 않는다', () => {
  const grant = createProductRequestId('grant');
  const revoke = createProductRequestId('revoke');
  assert.notEqual(grant, revoke);
  assert.match(grant, /^grant-[0-9a-f-]{36}$/);
  assert.match(revoke, /^revoke-[0-9a-f-]{36}$/);
});

test('상품 명령 PlayFab 클라이언트는 UserReadOnlyData Server API만 사용한다', async () => {
  const requests = [];
  const client = createProductPlayFabClient({
    titleId: 'A1B2C',
    secretKey: 'secret-value',
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      const isGet = String(url).endsWith('/Server/GetUserReadOnlyData');
      return new Response(JSON.stringify({
        code: 200,
        status: 'OK',
        data: isGet ? { PlayFabId: 'ABC', DataVersion: 1, Data: {} } : { DataVersion: 2 }
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
    sleepImpl: async () => {}
  });

  await client.getUserReadOnlyData({ playFabId: 'ABC', keys: ['지급', '회수'] });
  await client.updateUserReadOnlyData({ playFabId: 'ABC', data: { '지급': '{}' }, requestId: 'g' });
  await client.updateUserReadOnlyData({ playFabId: 'ABC', keysToRemove: ['회수'], requestId: 'd' });

  assert.equal(requests[0].url, 'https://A1B2C.playfabapi.com/Server/GetUserReadOnlyData');
  assert.equal(requests[1].url, 'https://A1B2C.playfabapi.com/Server/UpdateUserReadOnlyData');
  assert.equal(requests[2].url, 'https://A1B2C.playfabapi.com/Server/UpdateUserReadOnlyData');
  assert.ok(requests.every((item) => !item.url.includes('/Client/')));
  assert.ok(requests.every((item) => !item.url.endsWith('/Server/GetUserData')));
  assert.ok(requests.every((item) => !item.url.endsWith('/Server/UpdateUserData')));
  assert.ok(requests.every((item) => !item.url.includes('/Admin/')));
  assert.equal(requests[1].options.headers['X-SecretKey'], 'secret-value');
  assert.doesNotMatch(requests[1].options.body, /secret-value/);
});

test('기존 상품 명령은 재화 합산과 목록 병합 후 새 요청 ID를 사용한다', () => {
  const merged = JSON.parse(mergeProductCommandValue(JSON.stringify({
    '요청ID': 'revoke-old',
    '재화': { '젬': 1000, '영혼석': 5, '마일리지': 40 },
    '캐릭터': [21],
    '스킨': ['21-3'],
    '무기': ['21-2'],
    '펫': [5],
    '패키지': ['PACKAGE_A'],
    '추가필드': { keep: true }
  }), {
    '재화': { '젬': 200, '기도석': 10, '마일리지': 60 },
    '캐릭터': [21, 22],
    '스킨': ['21-3', '22-1'],
    '무기': ['22-4'],
    '펫': [5, 8],
    '패키지': ['PACKAGE_A', 'PACKAGE_B']
  }, 'revoke-new'));

  assert.deepEqual(merged, {
    '요청ID': 'revoke-new',
    '재화': { '젬': 1200, '영혼석': 5, '마일리지': 100, '기도석': 10 },
    '캐릭터': [21, 22],
    '스킨': ['21-3', '22-1'],
    '무기': ['21-2', '22-4'],
    '펫': [5, 8],
    '패키지': ['PACKAGE_A', 'PACKAGE_A', 'PACKAGE_B'],
    '추가필드': { keep: true }
  });
  assert.throws(() => mergeProductCommandValue('{broken', { '스킨': ['21-3'] }, 'revoke-new'), /병합할 수 없습니다/);
});

test('플레이어 데이터 클라이언트는 UserData Server API와 지정한 키만 사용한다', async () => {
  const requests = [];
  const client = createProductPlayFabClient({
    titleId: 'A1B2C',
    secretKey: 'secret-value',
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      const isGet = String(url).endsWith('/Server/GetUserData');
      return new Response(JSON.stringify({
        code: 200,
        status: 'OK',
        data: isGet
          ? { PlayFabId: 'ABC', DataVersion: 3, Data: { SaveData: { Value: '{}' } } }
          : { DataVersion: 4 }
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
    sleepImpl: async () => {}
  });

  const result = await client.getUserData({ playFabId: 'ABC', keys: ['SaveData', 'AutoSaveData'] });
  await client.updateUserData({ playFabId: 'ABC', data: { SaveData: '{"gem":1}' }, requestId: 'save-1' });

  assert.equal(requests[0].url, 'https://A1B2C.playfabapi.com/Server/GetUserData');
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    PlayFabId: 'ABC',
    Keys: ['SaveData', 'AutoSaveData']
  });
  assert.equal(requests[1].url, 'https://A1B2C.playfabapi.com/Server/UpdateUserData');
  assert.deepEqual(JSON.parse(requests[1].options.body).Data, { SaveData: '{"gem":1}' });
  assert.equal(JSON.parse(requests[1].options.body).Permission, 'Private');
  assert.equal(result.data.SaveData.value, '{}');
  assert.ok(requests.every((item) => !item.url.includes('/Client/')));
  assert.doesNotMatch(requests[1].options.body, /secret-value/);
});

test('플레이어 데이터 클라이언트는 읽기 전용과 내부 데이터 전용 API를 사용한다', async () => {
  const requests = [];
  const client = createProductPlayFabClient({
    titleId: 'A1B2C',
    secretKey: 'secret-value',
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), options });
      const isGet = String(url).includes('/GetUser');
      return new Response(JSON.stringify({
        code: 200,
        status: 'OK',
        data: isGet ? { PlayFabId: 'ABC', DataVersion: 7, Data: { Flag: { Value: 'on' } } } : { DataVersion: 8 }
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    },
    sleepImpl: async () => {}
  });

  const readOnly = await client.getUserReadOnlyData({ playFabId: 'ABC' });
  await client.updateUserReadOnlyData({ playFabId: 'ABC', data: { Flag: 'off' }, requestId: 'readonly-1' });
  const internal = await client.getUserInternalData({ playFabId: 'ABC', keys: ['Secret'] });
  await client.updateUserInternalData({ playFabId: 'ABC', keysToRemove: ['Secret'], requestId: 'internal-1' });

  assert.equal(requests[0].url, 'https://A1B2C.playfabapi.com/Server/GetUserReadOnlyData');
  assert.deepEqual(JSON.parse(requests[0].options.body), { PlayFabId: 'ABC' });
  assert.equal(requests[1].url, 'https://A1B2C.playfabapi.com/Server/UpdateUserReadOnlyData');
  assert.equal(requests[2].url, 'https://A1B2C.playfabapi.com/Admin/GetUserInternalData');
  assert.deepEqual(JSON.parse(requests[2].options.body), { PlayFabId: 'ABC', Keys: ['Secret'] });
  assert.equal(requests[3].url, 'https://A1B2C.playfabapi.com/Server/UpdateUserInternalData');
  assert.deepEqual(JSON.parse(requests[3].options.body).KeysToRemove, ['Secret']);
  assert.equal(readOnly.data.Flag.value, 'on');
  assert.equal(internal.data.Flag.value, 'on');
  assert.ok(requests.every((item) => !item.url.includes('/Client/')));
  assert.ok(requests.every((item) => item.options.headers['X-SecretKey'] === 'secret-value'));
  assert.ok(requests.every((item) => !item.options.body.includes('secret-value')));
});

test('429와 5xx는 재시도하고 영구 4xx는 재시도하지 않는다', async () => {
  let attempts = 0;
  const transient = createProductPlayFabClient({
    titleId: 'A1B2C',
    secretKey: 'secret',
    maxRetries: 2,
    sleepImpl: async () => {},
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) return new Response('{}', { status: 429 });
      if (attempts === 2) return new Response('{}', { status: 503 });
      return new Response(JSON.stringify({ code: 200, status: 'OK', data: { DataVersion: 1 } }), { status: 200 });
    }
  });
  const result = await transient.updateUserReadOnlyData({ playFabId: 'ABC', data: { '지급': '{}' }, requestId: 'r' });
  assert.equal(attempts, 3);
  assert.equal(result.retryCount, 2);

  let badAttempts = 0;
  const bad = createProductPlayFabClient({
    titleId: 'A1B2C',
    secretKey: 'secret',
    maxRetries: 2,
    sleepImpl: async () => {},
    fetchImpl: async () => {
      badAttempts += 1;
      return new Response(JSON.stringify({
        code: 400,
        status: 'BadRequest',
        error: 'InvalidParams',
        errorCode: 1000,
        errorMessage: 'Bad input'
      }), { status: 400 });
    }
  });
  await assert.rejects(
    () => bad.updateUserReadOnlyData({ playFabId: 'ABC', data: { '지급': '{}' }, requestId: 'r' }),
    (error) => error instanceof ProductPlayFabApiError && error.errorCode === 1000
  );
  assert.equal(badAttempts, 1);
});

test('지급과 회수 키는 독립적으로 수정·삭제된다', async () => {
  const client = createMockProductPlayFabClient({
    seed: { ABC: { data: { '지급': '{"g":1}', '회수': '{"r":1}' } } }
  });

  await client.updateUserReadOnlyData({ playFabId: 'ABC', data: { '지급': '{"g":2}' } });
  let current = await client.getUserReadOnlyData({ playFabId: 'ABC', keys: ['지급', '회수'] });
  assert.equal(current.data['지급'].value, '{"g":2}');
  assert.equal(current.data['회수'].value, '{"r":1}');

  await client.updateUserReadOnlyData({ playFabId: 'ABC', keysToRemove: ['회수'] });
  current = await client.getUserReadOnlyData({ playFabId: 'ABC', keys: ['지급', '회수'] });
  assert.equal(current.data['지급'].value, '{"g":2}');
  assert.equal(current.data['회수'], undefined);
});

test('라이브와 테스트 환경은 서로 다른 PlayFab 클라이언트로 라우팅된다', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cs-env-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const live = createMockProductPlayFabClient({
    seed: { AAAAAAAAAAAAAAAA: { data: { '지급': '{"live":1}' } } }
  });
  const testClient = createMockProductPlayFabClient({
    seed: { AAAAAAAAAAAAAAAA: { data: { '지급': '{"test":1}' } } }
  });
  const api = createProductCommandApi({
    dataDir: dir,
    liveEnabled: true,
    environmentClients: { live, test: testClient }
  });

  const liveLookup = (await api.handle({
    path: '/api/playfab/product-commands/lookup',
    body: { environment: 'live', playFabIds: ['AAAAAAAAAAAAAAAA'] },
    authenticatedUser: 'tester', requestId: '1', ip: '127.0.0.1'
  })).payload;
  const testLookup = (await api.handle({
    path: '/api/playfab/product-commands/lookup',
    body: { environment: 'test', playFabIds: ['AAAAAAAAAAAAAAAA'] },
    authenticatedUser: 'tester', requestId: '2', ip: '127.0.0.1'
  })).payload;

  assert.equal(liveLookup.results[0].grant.value, '{"live":1}');
  assert.equal(testLookup.results[0].grant.value, '{"test":1}');
  assert.equal(liveLookup.environment, 'live');
  assert.equal(testLookup.environment, 'test');
});

test('여러 UID 미리보기는 각각 다른 요청 ID를 받고 환경을 고정한다', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cs-preview-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const api = createProductCommandApi({
    dataDir: dir,
    liveEnabled: true,
    environmentClients: { test: createMockProductPlayFabClient() }
  });

  const preview = (await api.handle({
    path: '/api/playfab/product-commands/preview',
    body: {
      environment: 'test',
      operation: 'grant',
      playFabIds: ['AAAAAAAAAAAAAAAA', 'BBBBBBBBBBBBBBBB'],
      memo: '환경 미리보기',
      command: { currencies: { gem: 100 } }
    },
    authenticatedUser: 'tester', requestId: '1', ip: '127.0.0.1'
  })).payload;

  assert.equal(preview.environment, 'test');
  assert.notEqual(preview.items[0].requestId, preview.items[1].requestId);

  await assert.rejects(
    () => api.handle({
      path: '/api/playfab/product-commands/execute',
      body: { environment: 'live', previewToken: preview.previewToken, dryRun: true },
      authenticatedUser: 'tester', requestId: '2', ip: '127.0.0.1'
    }),
    /대상 PlayFab 서버가 다릅니다/
  );
});

test('기존 동일 키는 승인 없이 병합하지 않는다', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cs-merge-approval-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const client = createMockProductPlayFabClient({
    seed: { AAAAAAAAAAAAAAAA: { data: { '지급': '{"old":1}', '회수': '{"keep":1}' } } }
  });
  const api = createProductCommandApi({ dataDir: dir, liveEnabled: true, environmentClients: { test: client } });

  const preview = (await api.handle({
    path: '/api/playfab/product-commands/preview',
    body: {
      environment: 'test',
      operation: 'grant',
      playFabIds: ['AAAAAAAAAAAAAAAA'],
      memo: '병합 승인 테스트',
      command: { currencies: { gem: 10 } }
    },
    authenticatedUser: 'tester', requestId: '1', ip: '127.0.0.1'
  })).payload;

  const blocked = (await api.handle({
    path: '/api/playfab/product-commands/execute',
    body: { environment: 'test', previewToken: preview.previewToken, dryRun: false, mergePlayFabIds: [] },
    authenticatedUser: 'tester', requestId: '2', ip: '127.0.0.1'
  })).payload;
  assert.equal(blocked.results[0].status, 'existing');

  const current = await client.getUserReadOnlyData({ playFabId: 'AAAAAAAAAAAAAAAA', keys: ['지급', '회수'] });
  assert.equal(current.data['지급'].value, '{"old":1}');
  assert.equal(current.data['회수'].value, '{"keep":1}');
});

test('UID별 기존 명령과 병합 후 값을 미리보고 승인된 병합값을 저장한다', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cs-merge-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const client = createMockProductPlayFabClient({
    seed: {
      AAAAAAAAAAAAAAAA: { data: { '회수': '{"요청ID":"old-a","재화":{"젬":1000}}' } },
      BBBBBBBBBBBBBBBB: { data: { '회수': '{"요청ID":"old-b","스킨":["21-3"]}' } }
    }
  });
  const api = createProductCommandApi({ dataDir: dir, liveEnabled: true, environmentClients: { test: client } });

  const preview = (await api.handle({
    path: '/api/playfab/product-commands/preview',
    body: {
      environment: 'test', operation: 'revoke',
      playFabIds: ['AAAAAAAAAAAAAAAA', 'BBBBBBBBBBBBBBBB'],
      memo: 'UID별 병합 테스트',
      command: { skins: ['22-1'] }
    },
    authenticatedUser: 'tester', requestId: '1', ip: '127.0.0.1'
  })).payload;

  assert.equal(preview.existingCount, 2);
  assert.equal(preview.mergeFailureCount, 0);
  assert.equal(preview.items[0].existingCommand, '{"요청ID":"old-a","재화":{"젬":1000}}');
  assert.deepEqual(JSON.parse(preview.items[0].commandJson), {
    '요청ID': preview.items[0].requestId,
    '재화': { '젬': 1000 },
    '스킨': ['22-1']
  });
  assert.deepEqual(JSON.parse(preview.items[1].commandJson), {
    '요청ID': preview.items[1].requestId,
    '스킨': ['21-3', '22-1']
  });

  const executed = (await api.handle({
    path: '/api/playfab/product-commands/execute',
    body: {
      environment: 'test', previewToken: preview.previewToken, dryRun: false,
      mergePlayFabIds: ['AAAAAAAAAAAAAAAA', 'BBBBBBBBBBBBBBBB']
    },
    authenticatedUser: 'tester', requestId: '2', ip: '127.0.0.1'
  })).payload;
  assert.equal(executed.successCount, 2);

  const first = await client.getUserReadOnlyData({ playFabId: 'AAAAAAAAAAAAAAAA', keys: ['회수'] });
  const second = await client.getUserReadOnlyData({ playFabId: 'BBBBBBBBBBBBBBBB', keys: ['회수'] });
  assert.deepEqual(JSON.parse(first.data['회수'].value), JSON.parse(preview.items[0].commandJson));
  assert.deepEqual(JSON.parse(second.data['회수'].value), JSON.parse(preview.items[1].commandJson));
});

test('깨진 기존 명령은 미리보기에서 병합 불가로 표시하고 실행하지 않는다', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cs-merge-invalid-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const client = createMockProductPlayFabClient({
    seed: { AAAAAAAAAAAAAAAA: { data: { '지급': '{broken' } } }
  });
  const api = createProductCommandApi({ dataDir: dir, liveEnabled: true, environmentClients: { test: client } });

  const preview = (await api.handle({
    path: '/api/playfab/product-commands/preview',
    body: {
      environment: 'test', operation: 'grant', playFabIds: ['AAAAAAAAAAAAAAAA'],
      memo: '병합 오류 테스트', command: { currencies: { gem: 10 } }
    },
    authenticatedUser: 'tester', requestId: '1', ip: '127.0.0.1'
  })).payload;
  assert.equal(preview.mergeFailureCount, 1);
  assert.equal(preview.items[0].commandJson, null);
  assert.match(preview.items[0].mergeError, /병합할 수 없습니다/);

  const executed = (await api.handle({
    path: '/api/playfab/product-commands/execute',
    body: { environment: 'test', previewToken: preview.previewToken, dryRun: false, mergePlayFabIds: ['AAAAAAAAAAAAAAAA'] },
    authenticatedUser: 'tester', requestId: '2', ip: '127.0.0.1'
  })).payload;
  assert.equal(executed.failureCount, 1);
  const current = await client.getUserReadOnlyData({ playFabId: 'AAAAAAAAAAAAAAAA', keys: ['지급'] });
  assert.equal(current.data['지급'].value, '{broken');
});

test('실행 직전 DataVersion이 달라지면 작업을 중단한다', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cs-version-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const client = createMockProductPlayFabClient();
  const api = createProductCommandApi({ dataDir: dir, liveEnabled: true, environmentClients: { test: client } });

  const preview = (await api.handle({
    path: '/api/playfab/product-commands/preview',
    body: {
      environment: 'test',
      operation: 'grant',
      playFabIds: ['AAAAAAAAAAAAAAAA'],
      memo: '버전 충돌',
      command: { currencies: { gem: 10 } }
    },
    authenticatedUser: 'tester', requestId: '1', ip: '127.0.0.1'
  })).payload;

  await client.updateUserReadOnlyData({
    playFabId: 'AAAAAAAAAAAAAAAA',
    data: { '회수': '{"요청ID":"other"}' },
    requestId: 'other'
  });

  const executed = (await api.handle({
    path: '/api/playfab/product-commands/execute',
    body: { environment: 'test', previewToken: preview.previewToken, dryRun: false },
    authenticatedUser: 'tester', requestId: '2', ip: '127.0.0.1'
  })).payload;

  assert.equal(executed.results[0].status, 'skipped');
  assert.equal(executed.results[0].existingChanged, true);
});

test('실패 UID 재실행은 최초 요청 ID를 유지한다', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cs-retry-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const base = createMockProductPlayFabClient();
  let failWrite = true;
  const flaky = {
    mode: 'mock',
    getUserReadOnlyData: (args) => base.getUserReadOnlyData(args),
    updateUserReadOnlyData: async (args) => {
      if (failWrite) {
        failWrite = false;
        throw new ProductPlayFabApiError('일시 실패', { retryCount: 0 });
      }
      return base.updateUserReadOnlyData(args);
    }
  };
  const api = createProductCommandApi({ dataDir: dir, liveEnabled: true, environmentClients: { test: flaky } });

  const preview = (await api.handle({
    path: '/api/playfab/product-commands/preview',
    body: {
      environment: 'test',
      operation: 'grant',
      playFabIds: ['AAAAAAAAAAAAAAAA'],
      memo: '재실행 테스트',
      command: { currencies: { gem: 10 } }
    },
    authenticatedUser: 'tester', requestId: '1', ip: '127.0.0.1'
  })).payload;
  const originalRequestId = preview.items[0].requestId;

  const first = (await api.handle({
    path: '/api/playfab/product-commands/execute',
    body: { environment: 'test', previewToken: preview.previewToken, dryRun: false },
    authenticatedUser: 'tester', requestId: '2', ip: '127.0.0.1'
  })).payload;
  assert.equal(first.results[0].status, 'failed');
  assert.equal(first.results[0].requestId, originalRequestId);

  const second = (await api.handle({
    path: '/api/playfab/product-commands/execute',
    body: {
      environment: 'test',
      previewToken: preview.previewToken,
      dryRun: false,
      playFabIds: ['AAAAAAAAAAAAAAAA']
    },
    authenticatedUser: 'tester', requestId: '3', ip: '127.0.0.1'
  })).payload;
  assert.equal(second.results[0].requestId, originalRequestId);
  assert.equal(second.results[0].status, 'retry_success');
});

test('Dry Run은 PlayFab 쓰기 메서드를 호출하지 않는다', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cs-dry-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const base = createMockProductPlayFabClient();
  let writes = 0;
  const client = {
    mode: 'mock',
    getUserReadOnlyData: (args) => base.getUserReadOnlyData(args),
    updateUserReadOnlyData: async (args) => {
      writes += 1;
      return base.updateUserReadOnlyData(args);
    }
  };
  const api = createProductCommandApi({ dataDir: dir, liveEnabled: true, environmentClients: { test: client } });
  const preview = (await api.handle({
    path: '/api/playfab/product-commands/preview',
    body: {
      environment: 'test',
      operation: 'revoke',
      playFabIds: ['AAAAAAAAAAAAAAAA'],
      memo: '드라이런',
      command: { pets: [5] }
    },
    authenticatedUser: 'tester', requestId: '1', ip: '127.0.0.1'
  })).payload;

  await api.handle({
    path: '/api/playfab/product-commands/execute',
    body: { environment: 'test', previewToken: preview.previewToken, dryRun: true },
    authenticatedUser: 'tester', requestId: '2', ip: '127.0.0.1'
  });
  assert.equal(writes, 0);
});

test('수동 삭제는 조회 당시 값과 DataVersion이 같을 때 선택 키 하나만 삭제한다', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cs-delete-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const client = createMockProductPlayFabClient({
    seed: { AAAAAAAAAAAAAAAA: { data: { '지급': '{"요청ID":"g1"}', '회수': '{"요청ID":"r1"}' } } }
  });
  const api = createProductCommandApi({ dataDir: dir, liveEnabled: true, environmentClients: { test: client } });

  const lookup = (await api.handle({
    path: '/api/playfab/product-commands/lookup',
    body: { environment: 'test', playFabIds: ['AAAAAAAAAAAAAAAA'] },
    authenticatedUser: 'tester', requestId: '1', ip: '127.0.0.1'
  })).payload.results[0];

  const deleted = (await api.handle({
    path: '/api/playfab/product-commands/delete',
    body: {
      environment: 'test',
      playFabId: 'AAAAAAAAAAAAAAAA',
      operation: 'revoke',
      expectedValue: lookup.revoke.value,
      expectedDataVersion: lookup.dataVersion,
      memo: '수동 삭제'
    },
    authenticatedUser: 'tester', requestId: '2', ip: '127.0.0.1'
  })).payload;
  assert.equal(deleted.status, 'success');

  const current = await client.getUserReadOnlyData({ playFabId: 'AAAAAAAAAAAAAAAA', keys: ['지급', '회수'] });
  assert.equal(current.data['지급'].value, '{"요청ID":"g1"}');
  assert.equal(current.data['회수'], undefined);
});

test('Secret Key는 상품 API 응답과 감사 로그에 노출되지 않는다', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cs-secret-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const secret = 'TOP-SECRET-DO-NOT-LEAK';
  const oldSecret = process.env.PLAYFAB_TEST_SECRET_KEY;
  const oldTitle = process.env.PLAYFAB_TEST_TITLE_ID;
  const oldMock = process.env.PLAYFAB_PRODUCT_COMMANDS_MOCK_MODE;
  process.env.PLAYFAB_TEST_TITLE_ID = 'TEST1';
  process.env.PLAYFAB_TEST_SECRET_KEY = secret;
  process.env.PLAYFAB_PRODUCT_COMMANDS_MOCK_MODE = 'true';
  t.after(() => {
    restoreEnv('PLAYFAB_TEST_SECRET_KEY', oldSecret);
    restoreEnv('PLAYFAB_TEST_TITLE_ID', oldTitle);
    restoreEnv('PLAYFAB_PRODUCT_COMMANDS_MOCK_MODE', oldMock);
  });

  const api = createProductCommandApi({ dataDir: dir, liveEnabled: true });
  const config = (await api.handle({
    path: '/api/playfab/product-commands/config',
    body: {}, authenticatedUser: 'tester', requestId: '1', ip: '127.0.0.1'
  })).payload;
  assert.doesNotMatch(JSON.stringify(config), new RegExp(secret));

  const preview = (await api.handle({
    path: '/api/playfab/product-commands/preview',
    body: {
      environment: 'test',
      operation: 'grant',
      playFabIds: ['AAAAAAAAAAAAAAAA'],
      memo: '보안 테스트',
      command: { currencies: { gem: 1 } }
    },
    authenticatedUser: 'tester', requestId: '2', ip: '127.0.0.1'
  })).payload;
  await api.handle({
    path: '/api/playfab/product-commands/execute',
    body: { environment: 'test', previewToken: preview.previewToken, dryRun: true },
    authenticatedUser: 'tester', requestId: '3', ip: '127.0.0.1'
  });

  const log = await readFile(path.join(dir, 'playfab-product-command-audit.jsonl'), 'utf8');
  assert.doesNotMatch(log, new RegExp(secret));
  assert.match(log, /"environment":"test"/);
});

function restoreEnv(key, value) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
