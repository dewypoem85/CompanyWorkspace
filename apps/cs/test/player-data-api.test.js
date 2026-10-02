import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { createPlayerDataApi, decodeStoredValue, encodeStoredValue } from '../lib/player-data-api.js';
import { createMockProductPlayFabClient } from '../lib/product-playfab.js';

const PLAYER_ID = 'A2404D2EFA59A7EB';
const USER = { id: '17', name: '홍길동', email: 'cs@example.com' };

test('조회는 Keys 필터 없이 설정된 모든 UserData와 편집 토큰을 반환한다', async (t) => {
  const dir = await tempDir(t);
  const base = createMockProductPlayFabClient({
    seed: {
      [PLAYER_ID]: {
        userData: {
          SaveData: '{"gem":100}',
          AutoSaveData: '{}',
          LoginToken: 'NEVER-RETURN-THIS'
        }
      }
    }
  });
  let requestedKeys = null;
  const client = {
    mode: 'mock',
    getUserData: async (args) => {
      requestedKeys = args.keys;
      return base.getUserData(args);
    },
    updateUserData: (args) => base.updateUserData(args)
  };
  const api = createPlayerDataApi({ dataDir: dir, environmentClients: { test: client } });

  const lookup = await call(api, 'lookup', { environment: 'test', playFabId: PLAYER_ID });
  assert.equal(requestedKeys, undefined);
  assert.deepEqual(Object.keys(lookup.records), ['SaveData', 'AutoSaveData', 'LoginToken']);
  assert.equal(lookup.records.LoginToken.value, 'NEVER-RETURN-THIS');
  assert.match(lookup.editToken, /^[A-Za-z0-9_-]{20,}$/);
  assert.equal(lookup.records.SaveData.value, '{"gem":100}');
});

test('플레이어 데이터 저장은 UID 재입력 없이 최종 확인 체크만 요구한다', async (t) => {
  const dir = await tempDir(t);
  const client = createMockProductPlayFabClient({
    seed: { [PLAYER_ID]: { userData: { SaveData: '{"gem":100}' } } }
  });
  const api = createPlayerDataApi({ dataDir: dir, environmentClients: { test: client } });
  const lookup = await call(api, 'lookup', { environment: 'test', playFabId: PLAYER_ID });
  const body = saveBody(lookup, '{"gem":200}');
  assert.equal('confirmationPlayFabId' in body, false);
  await assert.rejects(
    () => call(api, 'save', { ...body, confirmed: false }),
    (error) => error.statusCode === 400 && /확인/.test(error.message)
  );
  const saved = await call(api, 'save', body);
  assert.equal(saved.key, 'SaveData-Compression');
});

test('저장 응답의 새 편집 토큰으로 재조회 없이 연속 수정한다', async (t) => {
  const dir = await tempDir(t);
  const client = createMockProductPlayFabClient({
    seed: { [PLAYER_ID]: { userData: { SaveData: '{"gem":100}' } } }
  });
  const api = createPlayerDataApi({ dataDir: dir, environmentClients: { test: client } });
  const lookup = await call(api, 'lookup', { environment: 'test', playFabId: PLAYER_ID });

  const first = await call(api, 'save', saveBody(lookup, '{"gem":200}'));
  assert.notEqual(first.editToken, lookup.editToken);
  assert.equal(first.record.value, '{"gem":200}');
  assert.deepEqual(first.removedKeys, ['SaveData']);

  const second = await call(api, 'save', {
    ...saveBody(lookup, '{"gem":300}'),
    editToken: first.editToken,
    key: first.key
  });
  assert.notEqual(second.editToken, first.editToken);
  assert.equal(second.record.value, '{"gem":300}');

  const current = await client.getUserData({ playFabId: PLAYER_ID });
  assert.equal(
    decodeStoredValue('SaveData-Compression', current.data['SaveData-Compression'].value).value,
    '{"gem":300}'
  );

  await client.updateUserData({
    playFabId: PLAYER_ID,
    data: { 'SaveData-Compression': encodeStoredValue('SaveData-Compression', '{"gem":999}') }
  });
  await assert.rejects(
    () => call(api, 'save', {
      ...saveBody(lookup, '{"gem":400}'),
      editToken: second.editToken,
      key: second.key
    }),
    (error) => error.statusCode === 409 && /변경되었습니다/.test(error.message)
  );
});

test('레거시 SaveData 저장은 gzip-v1 키를 만들고 기존 키를 제거하며 원문을 감사 로그에 남기지 않는다', async (t) => {
  const dir = await tempDir(t);
  const client = createMockProductPlayFabClient({
    seed: { [PLAYER_ID]: { userData: { SaveData: '{"gem":100}', AutoSaveData: '{"stage":2}' } } }
  });
  const api = createPlayerDataApi({ dataDir: dir, environmentClients: { test: client } });
  const lookup = await call(api, 'lookup', { environment: 'test', playFabId: PLAYER_ID });

  const saved = await call(api, 'save', {
    editToken: lookup.editToken,
    environment: 'test',
    playFabId: PLAYER_ID,
    key: 'SaveData',
    json: '{\n  "gem": 777,\n  "privateMarker": "DO-NOT-AUDIT"\n}',
    reason: 'CS-20260818 데이터 복구',
    confirmed: true
  });
  assert.equal(saved.key, 'SaveData-Compression');

  const current = await client.getUserData({ playFabId: PLAYER_ID });
  assert.equal(current.data.SaveData, undefined);
  assert.equal(
    decodeStoredValue('SaveData-Compression', current.data['SaveData-Compression'].value).value,
    '{\n  "gem": 777,\n  "privateMarker": "DO-NOT-AUDIT"\n}'
  );
  assert.equal(current.data.AutoSaveData.value, '{"stage":2}');

  const audit = await readFile(path.join(dir, 'player-data-audit.jsonl'), 'utf8');
  assert.match(audit, /"userId":"17"/);
  assert.match(audit, /"userName":"홍길동"/);
  assert.match(audit, /"result":"attempted"/);
  assert.match(audit, /"result":"success"/);
  assert.doesNotMatch(audit, /DO-NOT-AUDIT|privateMarker|"gem":777/);
});

test('조회 이후 외부 변경이 생기면 저장을 중단한다', async (t) => {
  const dir = await tempDir(t);
  const client = createMockProductPlayFabClient({
    seed: { [PLAYER_ID]: { userData: { SaveData: '{"gem":100}' } } }
  });
  const api = createPlayerDataApi({ dataDir: dir, environmentClients: { test: client } });
  const lookup = await call(api, 'lookup', { environment: 'test', playFabId: PLAYER_ID });
  await client.updateUserData({ playFabId: PLAYER_ID, data: { SaveData: '{"gem":200}' } });

  await assert.rejects(
    () => call(api, 'save', saveBody(lookup, '{"gem":300}')),
    (error) => error.statusCode === 409 && /변경되었습니다/.test(error.message)
  );
  const current = await client.getUserData({ playFabId: PLAYER_ID, keys: ['SaveData'] });
  assert.equal(current.data.SaveData.value, '{"gem":200}');
});

test('SaveData의 잘못된 JSON과 조회 당시 없던 키는 저장하지 않는다', async (t) => {
  const dir = await tempDir(t);
  const client = createMockProductPlayFabClient({
    seed: { [PLAYER_ID]: { userData: { SaveData: '{}' } } }
  });
  const api = createPlayerDataApi({ dataDir: dir, environmentClients: { test: client } });
  const lookup = await call(api, 'lookup', { environment: 'test', playFabId: PLAYER_ID });

  await assert.rejects(
    () => call(api, 'save', saveBody(lookup, '{invalid')),
    (error) => error.statusCode === 400 && /JSON/.test(error.message)
  );
  await assert.rejects(
    () => call(api, 'save', { ...saveBody(lookup, '{}'), key: 'LoginToken' }),
    (error) => error.statusCode === 409 && /존재하지 않았던/.test(error.message)
  );
});

test('일반 문자열 UserData 키도 조회하고 편집한다', async (t) => {
  const dir = await tempDir(t);
  const client = createMockProductPlayFabClient({
    seed: { [PLAYER_ID]: { userData: { AccountLinkGoogleEmail: 'old@example.com' } } }
  });
  const api = createPlayerDataApi({ dataDir: dir, environmentClients: { test: client } });
  const lookup = await call(api, 'lookup', { environment: 'test', playFabId: PLAYER_ID });
  assert.equal(lookup.records.AccountLinkGoogleEmail.valueType, 'text');

  await call(api, 'save', {
    ...saveBody(lookup, 'new@example.com'),
    key: 'AccountLinkGoogleEmail'
  });
  const current = await client.getUserData({ playFabId: PLAYER_ID });
  assert.equal(current.data.AccountLinkGoogleEmail.value, 'new@example.com');
});

test('읽기 전용 데이터와 내부 데이터를 저장소별로 조회·추가·수정·삭제한다', async (t) => {
  const dir = await tempDir(t);
  const client = createMockProductPlayFabClient({
    seed: {
      [PLAYER_ID]: {
        data: { ReadOnlyJson: '{"value":1}', SaveData: 'plain-readonly-value' },
        internalData: { InternalSecret: 'before', KeepInternal: 'keep' }
      }
    }
  });
  const api = createPlayerDataApi({ dataDir: dir, environmentClients: { test: client } });

  let lookup = await call(api, 'lookup', { environment: 'test', dataStore: 'readonly', playFabId: PLAYER_ID });
  assert.equal(lookup.dataStore, 'readonly');
  assert.equal(lookup.dataStorePlayFabName, 'UserReadOnlyData');
  assert.deepEqual(lookup.keys, ['SaveData', 'ReadOnlyJson']);
  assert.equal(lookup.records.SaveData.value, 'plain-readonly-value');

  await call(api, 'save', {
    ...confirmedMutation(lookup, 'SaveData'),
    value: 'still-plain-not-json'
  });
  lookup = await call(api, 'lookup', { environment: 'test', dataStore: 'readonly', playFabId: PLAYER_ID });
  await call(api, 'add', { ...confirmedMutation(lookup, 'AddedReadOnly'), value: '{"ok":true}' });
  let readOnly = await client.getUserReadOnlyData({ playFabId: PLAYER_ID });
  assert.equal(readOnly.data.SaveData.value, 'still-plain-not-json');
  assert.equal(readOnly.data.AddedReadOnly.value, '{"ok":true}');

  lookup = await call(api, 'lookup', { environment: 'test', dataStore: 'internal', playFabId: PLAYER_ID });
  assert.equal(lookup.dataStorePlayFabName, 'UserInternalData');
  await call(api, 'save', { ...confirmedMutation(lookup, 'InternalSecret'), value: 'after' });
  lookup = await call(api, 'lookup', { environment: 'test', dataStore: 'internal', playFabId: PLAYER_ID });
  await call(api, 'delete', confirmedMutation(lookup, 'InternalSecret'));
  const internal = await client.getUserInternalData({ playFabId: PLAYER_ID });
  assert.equal(internal.data.InternalSecret, undefined);
  assert.equal(internal.data.KeepInternal.value, 'keep');

  const audit = await readFile(path.join(dir, 'player-data-audit.jsonl'), 'utf8');
  assert.match(audit, /"dataStore":"UserReadOnlyData"/);
  assert.match(audit, /"dataStore":"UserInternalData"/);
  assert.doesNotMatch(audit, /still-plain-not-json|InternalSecret":"after/);
});

test('통합 조회는 세 저장소를 한 요청에서 순서대로 반환하고 편집 토큰을 분리한다', async (t) => {
  const dir = await tempDir(t);
  const client = createMockProductPlayFabClient({
    seed: {
      [PLAYER_ID]: {
        userData: { SaveData: '{"gem":100}', LoginToken: 'token' },
        data: { 지급: '{"요청ID":"grant-1"}' },
        internalData: { InternalFlag: 'enabled' }
      }
    }
  });
  const api = createPlayerDataApi({ dataDir: dir, environmentClients: { test: client } });

  const lookup = await call(api, 'lookup', {
    environment: 'test', dataStore: 'all', playFabId: PLAYER_ID
  });

  assert.equal(lookup.dataStore, 'all');
  assert.equal(lookup.totalKeys, 4);
  assert.deepEqual(lookup.stores.map((store) => store.dataStore), ['user', 'readonly', 'internal']);
  assert.deepEqual(lookup.stores.map((store) => store.dataStorePlayFabName), ['UserData', 'UserReadOnlyData', 'UserInternalData']);
  assert.deepEqual(lookup.stores.map((store) => store.keys.length), [2, 1, 1]);
  assert.equal(new Set(lookup.stores.map((store) => store.editToken)).size, 3);
  assert.ok(lookup.stores.every((store) => store.playFabId === PLAYER_ID));
});

test('새 UserData 키를 추가하고 값 원문은 감사 로그에 남기지 않는다', async (t) => {
  const dir = await tempDir(t);
  const client = createMockProductPlayFabClient({
    seed: { [PLAYER_ID]: { userData: { Existing: 'keep' } } }
  });
  const api = createPlayerDataApi({ dataDir: dir, environmentClients: { test: client } });
  const lookup = await call(api, 'lookup', { environment: 'test', playFabId: PLAYER_ID });

  const added = await call(api, 'add', {
    ...confirmedMutation(lookup, 'NewKey'),
    value: '{"privateMarker":"DO-NOT-AUDIT","id":9223372036854775807}'
  });
  assert.equal(added.key, 'NewKey');
  const current = await client.getUserData({ playFabId: PLAYER_ID });
  assert.equal(current.data.NewKey.value, '{"privateMarker":"DO-NOT-AUDIT","id":9223372036854775807}');
  assert.equal(current.data.Existing.value, 'keep');

  const audit = await readFile(path.join(dir, 'player-data-audit.jsonl'), 'utf8');
  assert.match(audit, /"action":"player-data-add"/);
  assert.doesNotMatch(audit, /DO-NOT-AUDIT|privateMarker|9223372036854775807/);
});

test('SaveData 신규 추가는 gzip-v1 압축 키로 저장한다', async (t) => {
  const dir = await tempDir(t);
  const client = createMockProductPlayFabClient({ seed: { [PLAYER_ID]: { userData: {} } } });
  const api = createPlayerDataApi({ dataDir: dir, environmentClients: { test: client } });
  const lookup = await call(api, 'lookup', { environment: 'test', playFabId: PLAYER_ID });
  const json = '{"id":9223372036854775807}';

  const added = await call(api, 'add', {
    ...confirmedMutation(lookup, 'SaveData'),
    value: json
  });
  assert.equal(added.key, 'SaveData-Compression');
  const current = await client.getUserData({ playFabId: PLAYER_ID });
  assert.equal(current.data.SaveData, undefined);
  assert.equal(decodeStoredValue('SaveData-Compression', current.data['SaveData-Compression'].value).value, json);
});

test('기존 키와 조회 후 생성된 키는 중복 추가하지 않는다', async (t) => {
  const dir = await tempDir(t);
  const client = createMockProductPlayFabClient({
    seed: { [PLAYER_ID]: { userData: { Existing: 'keep' } } }
  });
  const api = createPlayerDataApi({ dataDir: dir, environmentClients: { test: client } });
  const lookup = await call(api, 'lookup', { environment: 'test', playFabId: PLAYER_ID });

  await assert.rejects(
    () => call(api, 'add', { ...confirmedMutation(lookup, 'Existing'), value: 'replace' }),
    (error) => error.statusCode === 409 && /이미 존재/.test(error.message)
  );
  await client.updateUserData({ playFabId: PLAYER_ID, data: { LateKey: 'external' } });
  await assert.rejects(
    () => call(api, 'add', { ...confirmedMutation(lookup, 'LateKey'), value: 'ours' }),
    (error) => error.statusCode === 409 && /조회 후/.test(error.message)
  );
  const current = await client.getUserData({ playFabId: PLAYER_ID });
  assert.equal(current.data.LateKey.value, 'external');
});

test('기존 UserData 키를 삭제하고 조회 후 변경되면 삭제를 중단한다', async (t) => {
  const dir = await tempDir(t);
  const client = createMockProductPlayFabClient({
    seed: { [PLAYER_ID]: { userData: { RemoveMe: 'secret-value', Changed: 'before', KeepMe: 'keep' } } }
  });
  const api = createPlayerDataApi({ dataDir: dir, environmentClients: { test: client } });
  const lookup = await call(api, 'lookup', { environment: 'test', playFabId: PLAYER_ID });

  const removed = await call(api, 'delete', confirmedMutation(lookup, 'RemoveMe'));
  assert.equal(removed.key, 'RemoveMe');
  let current = await client.getUserData({ playFabId: PLAYER_ID });
  assert.equal(current.data.RemoveMe, undefined);
  assert.equal(current.data.KeepMe.value, 'keep');
  const audit = await readFile(path.join(dir, 'player-data-audit.jsonl'), 'utf8');
  assert.match(audit, /"action":"player-data-delete"/);
  assert.doesNotMatch(audit, /secret-value/);

  const freshLookup = await call(api, 'lookup', { environment: 'test', playFabId: PLAYER_ID });
  await client.updateUserData({ playFabId: PLAYER_ID, data: { Changed: 'after' } });
  await assert.rejects(
    () => call(api, 'delete', confirmedMutation(freshLookup, 'Changed')),
    (error) => error.statusCode === 409 && /변경되었습니다/.test(error.message)
  );
  current = await client.getUserData({ playFabId: PLAYER_ID });
  assert.equal(current.data.Changed.value, 'after');
});

test('gzip-v1 SaveData-Compression은 길이를 검증해 풀고 같은 명세로 다시 압축한다', async (t) => {
  const dir = await tempDir(t);
  const originalJson = '{"gem":100,"items":[1,2]}';
  const compressed = encodeStoredValue('SaveData-Compression', originalJson);
  const client = createMockProductPlayFabClient({
    seed: { [PLAYER_ID]: { userData: { 'SaveData-Compression': compressed } } }
  });
  const api = createPlayerDataApi({ dataDir: dir, environmentClients: { test: client } });
  const lookup = await call(api, 'lookup', { environment: 'test', playFabId: PLAYER_ID });

  assert.equal(lookup.records['SaveData-Compression'].compression, 'gzip-v1');
  assert.equal(lookup.records['SaveData-Compression'].compressionLabel, 'gzip-v1 · GZip + Base64');
  assert.equal(lookup.records['SaveData-Compression'].value, originalJson);
  assert.ok(lookup.records['SaveData-Compression'].decodedBytes > 0);

  await call(api, 'save', {
    ...saveBody(lookup, '{"gem":777,"items":[1,2,3]}'),
    key: 'SaveData-Compression'
  });
  const current = await client.getUserData({ playFabId: PLAYER_ID });
  assert.match(current.data['SaveData-Compression'].value, /^gzip-v1:27:H4sI/);
  assert.equal(
    decodeStoredValue('SaveData-Compression', current.data['SaveData-Compression'].value).value,
    '{"gem":777,"items":[1,2,3]}'
  );
});

test('gzip-v1은 UTF-8 바이트 길이를 기록하고 64비트 정수 원문을 그대로 보존한다', () => {
  const json = '{"이름":"용사","id":9223372036854775807}';
  const encoded = encodeStoredValue('SaveData-Compression', json);
  assert.match(encoded, new RegExp(`^gzip-v1:${Buffer.byteLength(json, 'utf8')}:H4sI`));
  assert.equal(decodeStoredValue('SaveData-Compression', encoded).value, json);
});

test('손상된 압축 데이터는 SaveData로 폴백하고 저장하면 정상 gzip-v1로 교체한다', async (t) => {
  const dir = await tempDir(t);
  const fallback = '{"id":9223372036854775807}';
  const client = createMockProductPlayFabClient({
    seed: { [PLAYER_ID]: { userData: { 'SaveData-Compression': 'gzip-v1:10:broken', SaveData: fallback } } }
  });
  const api = createPlayerDataApi({ dataDir: dir, environmentClients: { test: client } });
  const lookup = await call(api, 'lookup', { environment: 'test', playFabId: PLAYER_ID });
  const record = lookup.records['SaveData-Compression'];
  assert.equal(record.fallbackUsed, true);
  assert.equal(record.value, fallback);
  assert.match(record.compressionError, /Base64|GZip/);

  await call(api, 'save', { ...saveBody(lookup, fallback), key: 'SaveData-Compression' });
  const current = await client.getUserData({ playFabId: PLAYER_ID });
  assert.equal(current.data.SaveData, undefined);
  assert.equal(decodeStoredValue('SaveData-Compression', current.data['SaveData-Compression'].value).value, fallback);
});

test('gzip-v1 원본 길이 불일치와 잘못된 UTF-8을 거부한다', () => {
  const valid = encodeStoredValue('SaveData-Compression', '{"ok":true}');
  assert.throws(
    () => decodeStoredValue('SaveData-Compression', valid.replace(/^gzip-v1:\d+:/, 'gzip-v1:999:')),
    /원본 크기가 일치하지 않습니다/
  );
  const invalidUtf8 = gzipSync(Buffer.from([0xff])).toString('base64');
  assert.throws(
    () => decodeStoredValue('SaveData-Compression', `gzip-v1:1:${invalidUtf8}`),
    /UTF-8/
  );
  assert.throws(
    () => encodeStoredValue('SaveData-Compression', '\ud800'),
    /UTF-8로 변환할 수 없습니다/
  );
});

test('실제 클라이언트는 별도 쓰기 플래그가 꺼져 있으면 조회만 허용한다', async (t) => {
  const dir = await tempDir(t);
  let writes = 0;
  const client = {
    mode: 'live',
    getUserData: async ({ playFabId }) => ({
      playFabId,
      dataVersion: 1,
      data: { SaveData: { value: '{}', lastUpdated: '', permission: 'Private' } },
      retryCount: 0
    }),
    updateUserData: async () => {
      writes += 1;
      return { dataVersion: 2, retryCount: 0 };
    }
  };
  const api = createPlayerDataApi({ dataDir: dir, environmentClients: { test: client } });
  const lookup = await call(api, 'lookup', { environment: 'test', playFabId: PLAYER_ID });
  assert.equal(lookup.writeEnabled, false);
  await assert.rejects(
    () => call(api, 'save', saveBody(lookup, '{"gem":1}')),
    (error) => error.statusCode === 403 && /비활성화/.test(error.message)
  );
  assert.equal(writes, 0);
});

function saveBody(lookup, json) {
  return {
    editToken: lookup.editToken,
    environment: lookup.environment,
    dataStore: lookup.dataStore,
    playFabId: lookup.playFabId,
    key: 'SaveData',
    json,
    reason: '테스트 변경 사유',
    confirmed: true
  };
}

function confirmedMutation(lookup, key) {
  return {
    editToken: lookup.editToken,
    environment: lookup.environment,
    dataStore: lookup.dataStore,
    playFabId: lookup.playFabId,
    key,
    reason: '테스트 작업 사유',
    confirmed: true
  };
}

async function call(api, action, body) {
  const result = await api.handle({
    path: `/api/playfab/player-data/${action}`,
    body,
    authenticatedUser: USER,
    requestId: `request-${action}`,
    ip: '127.0.0.1'
  });
  return result.payload;
}

async function tempDir(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cs-player-data-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
