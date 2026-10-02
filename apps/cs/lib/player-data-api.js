import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { companyUserAuditFields } from './company-user.js';
import { validatePlayFabId } from './product-command.js';
import {
  createMockProductPlayFabClient,
  createProductPlayFabClient
} from './product-playfab.js';

const ENVIRONMENT_IDS = Object.freeze(['live', 'test']);
const EDIT_TOKEN_TTL_MS = 15 * 60 * 1_000;
const MAX_EDIT_TOKENS = 300;
const MAX_VALUE_BYTES = 32 * 1_024 * 1_024;
const MAX_DECOMPRESSED_BYTES = 32 * 1_024 * 1_024;
const MAX_REASON_LENGTH = 500;
const DEFAULT_DATA_STORE = 'user';
const ALL_DATA_STORES = 'all';
const DATA_STORES = Object.freeze({
  user: Object.freeze({ id: 'user', label: '플레이어 데이터', playFabName: 'UserData', getter: 'getUserData', updater: 'updateUserData', saveCompression: true }),
  readonly: Object.freeze({ id: 'readonly', label: '읽기 전용 데이터', playFabName: 'UserReadOnlyData', getter: 'getUserReadOnlyData', updater: 'updateUserReadOnlyData', saveCompression: false }),
  internal: Object.freeze({ id: 'internal', label: '내부 데이터', playFabName: 'UserInternalData', getter: 'getUserInternalData', updater: 'updateUserInternalData', saveCompression: false })
});
const SAVE_DATA_KEY = 'SaveData';
const SAVE_COMPRESSION_KEY = 'SaveData-Compression';
const SAVE_COMPRESSION_PREFIX = 'gzip-v1:';

export function createPlayerDataApi({
  dataDir,
  liveEnabled = false,
  mockMode = false,
  environmentClients = null,
  now = () => Date.now()
}) {
  const auditPath = path.join(dataDir, 'player-data-audit.jsonl');
  const environments = createEnvironmentMap({
    liveEnabled,
    mockMode,
    environmentClients
  });
  const editTokens = new Map();
  const saveLocks = new Set();

  async function lookupDataStore({ environment, playFabId, env, store, authenticatedUser }) {
    const result = await readDataStore(env.client, store, { playFabId });
    const keys = sortDataKeys(Object.keys(result.data || {}));
    const analyses = Object.fromEntries(
      keys.map((key) => [key, analyzeRecord(key, result.data[key], result.data, store.saveCompression)])
    );
    const snapshots = Object.fromEntries(keys.map((key) => [key, analyses[key].snapshot]));
    if (store.saveCompression) {
      for (const key of [SAVE_DATA_KEY, SAVE_COMPRESSION_KEY]) {
        if (!Object.hasOwn(snapshots, key)) snapshots[key] = makeRawSnapshot(null);
      }
    }
    const editToken = issueEditToken(editTokens, {
      environment,
      dataStore: store.id,
      playFabId,
      userId: companyUserAuditFields(authenticatedUser).userId,
      dataVersion: result.dataVersion,
      snapshots
    }, now);

    return {
      environment,
      environmentLabel: environmentLabel(environment),
      playFabId: result.playFabId || playFabId,
      dataStore: store.id,
      dataStoreLabel: store.label,
      dataStorePlayFabName: store.playFabName,
      dataVersion: result.dataVersion,
      editToken,
      editTokenExpiresAt: new Date(now() + EDIT_TOKEN_TTL_MS).toISOString(),
      writeEnabled: canWrite(env),
      keys,
      records: Object.fromEntries(keys.map((key) => [key, serializeRecord(result.data[key], analyses[key])]))
    };
  }

  async function handle({ path: requestPath, body, authenticatedUser, requestId, ip }) {
    if (requestPath === '/api/playfab/player-data/config') {
      return response(200, {
        dataStore: DATA_STORES[DEFAULT_DATA_STORE].playFabName,
        defaultDataStore: DEFAULT_DATA_STORE,
        dataStores: Object.values(DATA_STORES).map(({ id, label, playFabName, saveCompression }) => ({
          id, label, playFabName, saveCompression
        })),
        dynamicKeys: true,
        maxValueBytes: MAX_VALUE_BYTES,
        saveDataCompression: 'gzip-v1',
        editTokenTtlSeconds: EDIT_TOKEN_TTL_MS / 1_000,
        defaultEnvironment: environments.live.client ? 'live' : 'test',
        environments: Object.fromEntries(
          ENVIRONMENT_IDS.map((id) => [id, serializeEnvironment(id, environments[id])])
        )
      });
    }

    if (requestPath === '/api/playfab/player-data/lookup') {
      const { environment, playFabId, dataStore } = validateLookup(body);
      const env = requireConfiguredEnvironment(environments, environment);
      if (dataStore === ALL_DATA_STORES) {
        const stores = await Promise.all(Object.values(DATA_STORES).map((store) => lookupDataStore({
          environment, playFabId, env, store, authenticatedUser
        })));
        return response(200, {
          environment,
          environmentLabel: environmentLabel(environment),
          playFabId: stores[0]?.playFabId || playFabId,
          dataStore: ALL_DATA_STORES,
          writeEnabled: canWrite(env),
          totalKeys: stores.reduce((sum, store) => sum + store.keys.length, 0),
          stores
        });
      }

      return response(200, await lookupDataStore({
        environment, playFabId, env, store: DATA_STORES[dataStore], authenticatedUser
      }));
    }

    if (requestPath === '/api/playfab/player-data/save') {
      const request = validateSave(body);
      const token = consumeValidToken(editTokens, request.editToken, now);
      if (token.environment !== request.environment
          || token.dataStore !== request.dataStore
          || token.playFabId.toLowerCase() !== request.playFabId.toLowerCase()) {
        throw playerDataError('조회한 대상과 저장 대상이 일치하지 않습니다. 다시 조회해 주세요.', 409);
      }
      if (token.userId !== companyUserAuditFields(authenticatedUser).userId) {
        throw playerDataError('이 편집 세션을 만든 회사 계정과 현재 계정이 일치하지 않습니다.', 403);
      }
      if (!Object.hasOwn(token.snapshots, request.key)) {
        throw playerDataError('조회 당시 존재하지 않았던 데이터 키는 편집할 수 없습니다. 다시 조회해 주세요.', 409);
      }
      if (!token.snapshots[request.key].exists) {
        throw playerDataError('조회 당시 존재하지 않았던 데이터 키는 편집할 수 없습니다. 다시 조회해 주세요.', 409);
      }

      const env = requireConfiguredEnvironment(environments, request.environment);
      const store = DATA_STORES[request.dataStore];
      if (!canWrite(env)) {
        throw playerDataError(`${environmentLabel(request.environment)}의 ${store.label} 편집이 비활성화되어 있습니다.`, 403);
      }

      const saveDataEdit = store.saveCompression && isSaveDataKey(request.key);
      const targetKey = saveDataEdit ? SAVE_COMPRESSION_KEY : request.key;
      const guardedKeys = saveDataEdit ? [SAVE_COMPRESSION_KEY, SAVE_DATA_KEY] : [request.key];
      const lockKey = `${request.environment}:${request.dataStore}:${request.playFabId.toLowerCase()}:${targetKey}`;
      if (saveLocks.has(lockKey)) {
        throw playerDataError('같은 데이터에 대한 저장 요청이 이미 처리 중입니다.', 409);
      }

      saveLocks.add(lockKey);
      try {
        const current = await readDataStore(env.client, store, {
          playFabId: request.playFabId,
          keys: guardedKeys
        });
        for (const key of guardedKeys) {
          const currentSnapshot = makeRawSnapshot(current.data?.[key]);
          if (!sameSnapshot(currentSnapshot, token.snapshots[key])) {
            editTokens.delete(request.editToken);
            throw playerDataError('조회 후 데이터가 변경되었습니다. 최신 데이터를 다시 조회한 뒤 편집해 주세요.', 409);
          }
        }

        const normalizedValue = normalizeEditedValue(request.key, request.value, saveDataEdit);
        const storedValue = saveDataEdit
          ? encodeStoredValue(SAVE_COMPRESSION_KEY, normalizedValue)
          : normalizedValue;
        const afterHash = hashText(storedValue);
        const targetSnapshot = makeRawSnapshot(current.data?.[targetKey]);
        const legacyExists = Boolean(current.data?.[SAVE_DATA_KEY]);
        if (targetSnapshot.exists && targetSnapshot.hash === afterHash && (!saveDataEdit || !legacyExists)) {
          throw playerDataError('변경된 내용이 없습니다.', 400);
        }

        const auditBase = {
          timestamp: new Date(now()).toISOString(),
          requestId,
          action: 'player-data-save',
          environment: request.environment,
          dataStore: store.playFabName,
          playFabId: request.playFabId,
          key: request.key,
          storedKey: targetKey,
          removedKeys: saveDataEdit && legacyExists ? [SAVE_DATA_KEY] : [],
          reason: request.reason,
          beforeExists: targetSnapshot.exists,
          beforeHash: targetSnapshot.hash,
          beforeBytes: targetSnapshot.bytes,
          afterHash,
          afterBytes: Buffer.byteLength(storedValue, 'utf8'),
          afterDecodedBytes: Buffer.byteLength(normalizedValue, 'utf8'),
          compression: saveDataEdit ? 'gzip-v1' : 'plain',
          lookupDataVersion: token.dataVersion,
          currentDataVersion: current.dataVersion,
          ip,
          ...companyUserAuditFields(authenticatedUser)
        };

        await appendAudit(auditPath, { ...auditBase, result: 'attempted' });
        try {
          const update = await updateDataStore(env.client, store, {
            playFabId: request.playFabId,
            data: { [targetKey]: storedValue },
            keysToRemove: saveDataEdit && legacyExists ? [SAVE_DATA_KEY] : null,
            requestId
          });
          await appendAudit(auditPath, {
            ...auditBase,
            timestamp: new Date(now()).toISOString(),
            result: 'success',
            updatedDataVersion: update.dataVersion,
            retryCount: update.retryCount
          });

          const savedAt = new Date(now()).toISOString();
          const savedRecord = {
            value: storedValue,
            lastUpdated: savedAt,
            permission: current.data?.[targetKey]?.permission || 'Private'
          };
          const savedAnalysis = analyzeRecord(
            targetKey,
            savedRecord,
            { [targetKey]: savedRecord },
            store.saveCompression
          );
          const nextSnapshots = {
            ...token.snapshots,
            [targetKey]: savedAnalysis.snapshot
          };
          const removedKeys = saveDataEdit && legacyExists ? [SAVE_DATA_KEY] : [];
          for (const removedKey of removedKeys) nextSnapshots[removedKey] = makeRawSnapshot(null);

          editTokens.delete(request.editToken);
          const editToken = issueEditToken(editTokens, {
            ...token,
            dataVersion: update.dataVersion,
            snapshots: nextSnapshots
          }, now);
          return response(200, {
            message: `${targetKey} 저장을 완료했습니다.`,
            environment: request.environment,
            dataStore: request.dataStore,
            playFabId: request.playFabId,
            key: targetKey,
            removedKeys,
            dataVersion: update.dataVersion,
            editToken,
            editTokenExpiresAt: new Date(now() + EDIT_TOKEN_TTL_MS).toISOString(),
            record: serializeRecord(savedRecord, savedAnalysis),
            bytes: Buffer.byteLength(storedValue, 'utf8'),
            decodedBytes: Buffer.byteLength(normalizedValue, 'utf8'),
            compression: saveDataEdit ? 'gzip-v1' : 'plain'
          });
        } catch (error) {
          await appendAuditSafely(auditPath, {
            ...auditBase,
            timestamp: new Date(now()).toISOString(),
            result: 'failed',
            errorType: String(error?.name || 'Error').slice(0, 100),
            upstreamErrorCode: error?.errorCode ?? null
          });
          throw error;
        }
      } finally {
        saveLocks.delete(lockKey);
      }
    }

    if (requestPath === '/api/playfab/player-data/add') {
      const request = validateAdd(body);
      const token = requireMatchingEditToken(editTokens, request, authenticatedUser, now);
      const env = requireConfiguredEnvironment(environments, request.environment);
      const store = DATA_STORES[request.dataStore];
      if (!canWrite(env)) {
        throw playerDataError(`${environmentLabel(request.environment)}의 ${store.label} 편집이 비활성화되어 있습니다.`, 403);
      }

      const saveDataEdit = store.saveCompression && isSaveDataKey(request.key);
      const targetKey = saveDataEdit ? SAVE_COMPRESSION_KEY : request.key;
      const guardedKeys = saveDataEdit ? [SAVE_COMPRESSION_KEY, SAVE_DATA_KEY] : [targetKey];
      if (guardedKeys.some((key) => token.snapshots[key]?.exists)) {
        throw playerDataError('조회 당시 이미 존재했던 데이터 키입니다. 목록에서 해당 키를 편집해 주세요.', 409);
      }

      const lockKey = `${request.environment}:${request.dataStore}:${request.playFabId.toLowerCase()}:${targetKey}`;
      if (saveLocks.has(lockKey)) {
        throw playerDataError('같은 데이터에 대한 요청이 이미 처리 중입니다.', 409);
      }

      saveLocks.add(lockKey);
      try {
        const current = await readDataStore(env.client, store, { playFabId: request.playFabId, keys: guardedKeys });
        if (guardedKeys.some((key) => current.data?.[key])) {
          editTokens.delete(request.editToken);
          throw playerDataError('조회 후 같은 이름의 데이터 키가 생성되었습니다. 최신 데이터를 다시 조회해 주세요.', 409);
        }

        const normalizedValue = normalizeEditedValue(request.key, request.value, saveDataEdit);
        const storedValue = saveDataEdit
          ? encodeStoredValue(SAVE_COMPRESSION_KEY, normalizedValue)
          : normalizedValue;
        const auditBase = {
          timestamp: new Date(now()).toISOString(),
          requestId,
          action: 'player-data-add',
          environment: request.environment,
          dataStore: store.playFabName,
          playFabId: request.playFabId,
          key: request.key,
          storedKey: targetKey,
          reason: request.reason,
          afterHash: hashText(storedValue),
          afterBytes: Buffer.byteLength(storedValue, 'utf8'),
          afterDecodedBytes: Buffer.byteLength(normalizedValue, 'utf8'),
          compression: saveDataEdit ? 'gzip-v1' : 'plain',
          lookupDataVersion: token.dataVersion,
          currentDataVersion: current.dataVersion,
          ip,
          ...companyUserAuditFields(authenticatedUser)
        };

        await appendAudit(auditPath, { ...auditBase, result: 'attempted' });
        try {
          const update = await updateDataStore(env.client, store, {
            playFabId: request.playFabId,
            data: { [targetKey]: storedValue },
            requestId
          });
          await appendAudit(auditPath, {
            ...auditBase,
            timestamp: new Date(now()).toISOString(),
            result: 'success',
            updatedDataVersion: update.dataVersion,
            retryCount: update.retryCount
          });
          editTokens.delete(request.editToken);
          return response(200, {
            message: `${targetKey} 키를 추가했습니다.`,
            environment: request.environment,
            dataStore: request.dataStore,
            playFabId: request.playFabId,
            key: targetKey,
            dataVersion: update.dataVersion,
            bytes: Buffer.byteLength(storedValue, 'utf8'),
            decodedBytes: Buffer.byteLength(normalizedValue, 'utf8'),
            compression: saveDataEdit ? 'gzip-v1' : 'plain'
          });
        } catch (error) {
          await appendAuditSafely(auditPath, {
            ...auditBase,
            timestamp: new Date(now()).toISOString(),
            result: 'failed',
            errorType: String(error?.name || 'Error').slice(0, 100),
            upstreamErrorCode: error?.errorCode ?? null
          });
          throw error;
        }
      } finally {
        saveLocks.delete(lockKey);
      }
    }

    if (requestPath === '/api/playfab/player-data/delete') {
      const request = validateDelete(body);
      const token = requireMatchingEditToken(editTokens, request, authenticatedUser, now);
      const snapshot = token.snapshots[request.key];
      if (!snapshot?.exists) {
        throw playerDataError('조회 당시 존재하지 않았던 데이터 키는 삭제할 수 없습니다. 다시 조회해 주세요.', 409);
      }

      const env = requireConfiguredEnvironment(environments, request.environment);
      const store = DATA_STORES[request.dataStore];
      if (!canWrite(env)) {
        throw playerDataError(`${environmentLabel(request.environment)}의 ${store.label} 편집이 비활성화되어 있습니다.`, 403);
      }

      const lockKey = `${request.environment}:${request.dataStore}:${request.playFabId.toLowerCase()}:${request.key}`;
      if (saveLocks.has(lockKey)) {
        throw playerDataError('같은 데이터에 대한 요청이 이미 처리 중입니다.', 409);
      }

      saveLocks.add(lockKey);
      try {
        const current = await readDataStore(env.client, store, { playFabId: request.playFabId, keys: [request.key] });
        const currentSnapshot = makeRawSnapshot(current.data?.[request.key]);
        if (!sameSnapshot(currentSnapshot, snapshot)) {
          editTokens.delete(request.editToken);
          throw playerDataError('조회 후 데이터가 변경되었습니다. 최신 데이터를 다시 조회한 뒤 삭제해 주세요.', 409);
        }

        const auditBase = {
          timestamp: new Date(now()).toISOString(),
          requestId,
          action: 'player-data-delete',
          environment: request.environment,
          dataStore: store.playFabName,
          playFabId: request.playFabId,
          key: request.key,
          reason: request.reason,
          beforeHash: currentSnapshot.hash,
          beforeBytes: currentSnapshot.bytes,
          lookupDataVersion: token.dataVersion,
          currentDataVersion: current.dataVersion,
          ip,
          ...companyUserAuditFields(authenticatedUser)
        };

        await appendAudit(auditPath, { ...auditBase, result: 'attempted' });
        try {
          const update = await updateDataStore(env.client, store, {
            playFabId: request.playFabId,
            keysToRemove: [request.key],
            requestId
          });
          await appendAudit(auditPath, {
            ...auditBase,
            timestamp: new Date(now()).toISOString(),
            result: 'success',
            updatedDataVersion: update.dataVersion,
            retryCount: update.retryCount
          });
          editTokens.delete(request.editToken);
          return response(200, {
            message: `${request.key} 키를 삭제했습니다.`,
            environment: request.environment,
            dataStore: request.dataStore,
            playFabId: request.playFabId,
            key: request.key,
            dataVersion: update.dataVersion
          });
        } catch (error) {
          await appendAuditSafely(auditPath, {
            ...auditBase,
            timestamp: new Date(now()).toISOString(),
            result: 'failed',
            errorType: String(error?.name || 'Error').slice(0, 100),
            upstreamErrorCode: error?.errorCode ?? null
          });
          throw error;
        }
      } finally {
        saveLocks.delete(lockKey);
      }
    }

    throw playerDataError('플레이어 데이터 API 경로를 찾을 수 없습니다.', 404);
  }

  return { environments, handle };
}

function createEnvironmentMap({ liveEnabled, mockMode, environmentClients }) {
  const explicitCredentials = Boolean(
    String(process.env.PLAYFAB_LIVE_SECRET_KEY || '').trim()
      || String(process.env.PLAYFAB_TEST_SECRET_KEY || '').trim()
  );
  const explicitMock = process.env.PLAYFAB_PLAYER_DATA_MOCK_MODE;
  const effectiveMock = explicitMock === undefined
    ? (explicitCredentials ? false : Boolean(mockMode))
    : parseBooleanSetting(explicitMock, Boolean(mockMode));

  return {
    live: createEnvironment({
      id: 'live',
      titleId: String(process.env.PLAYFAB_LIVE_TITLE_ID || '').trim(),
      secretKey: String(process.env.PLAYFAB_LIVE_SECRET_KEY || '').trim(),
      providedClient: environmentClients?.live || null,
      mockMode: effectiveMock,
      writeEnabled: parseBooleanSetting(process.env.PLAYFAB_PLAYER_DATA_LIVE_ENABLED, liveEnabled)
    }),
    test: createEnvironment({
      id: 'test',
      titleId: String(process.env.PLAYFAB_TEST_TITLE_ID || '').trim(),
      secretKey: String(process.env.PLAYFAB_TEST_SECRET_KEY || '').trim(),
      providedClient: environmentClients?.test || null,
      mockMode: effectiveMock,
      writeEnabled: parseBooleanSetting(process.env.PLAYFAB_PLAYER_DATA_TEST_ENABLED, liveEnabled)
    })
  };
}

function createEnvironment({ id, titleId, secretKey, providedClient, mockMode, writeEnabled }) {
  let client = providedClient;
  if (!client && mockMode) client = createMockProductPlayFabClient();
  if (!client && titleId && secretKey) client = createProductPlayFabClient({ titleId, secretKey });
  return { id, titleId, client, writeEnabled: Boolean(writeEnabled) };
}

function serializeEnvironment(id, env) {
  return {
    id,
    label: environmentLabel(id),
    titleId: env.titleId,
    configured: Boolean(env.client),
    mode: env.client?.mode || 'disabled',
    writeEnabled: canWrite(env),
    dataStores: Object.values(DATA_STORES).map((store) => store.id)
  };
}

function validateLookup(body) {
  ensureObject(body);
  return {
    environment: resolveEnvironment(body.environment),
    dataStore: resolveLookupDataStore(body.dataStore),
    playFabId: validatePlayFabId(body.playFabId)
  };
}

function validateSave(body) {
  ensureObject(body);
  const environment = resolveEnvironment(body.environment);
  const dataStore = resolveDataStore(body.dataStore);
  const playFabId = validatePlayFabId(body.playFabId);
  if (body.confirmed !== true) {
    throw playerDataError('저장 대상과 변경 내용을 확인해 주세요.', 400);
  }

  const key = validateDataKey(body.key);
  const reason = String(body.reason || '').trim();
  if (reason.length < 3) throw playerDataError('처리 사유를 3자 이상 입력해 주세요.', 400);
  if (reason.length > MAX_REASON_LENGTH) {
    throw playerDataError(`처리 사유는 ${MAX_REASON_LENGTH}자 이하로 입력해 주세요.`, 400);
  }

  const value = String(body.value ?? body.json ?? '');
  if (Buffer.byteLength(value, 'utf8') > MAX_VALUE_BYTES) {
    throw playerDataError(`편집 데이터는 ${formatBytes(MAX_VALUE_BYTES)} 이하여야 합니다.`, 413);
  }

  const editToken = String(body.editToken || '').trim();
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(editToken)) {
    throw playerDataError('편집 세션이 올바르지 않습니다. 다시 조회해 주세요.', 400);
  }
  return { environment, dataStore, playFabId, key, reason, editToken, value };
}

function validateAdd(body) {
  const request = validateConfirmedMutation(body);
  const value = String(body.value ?? '');
  if (Buffer.byteLength(value, 'utf8') > MAX_VALUE_BYTES) {
    throw playerDataError(`추가할 데이터는 ${formatBytes(MAX_VALUE_BYTES)} 이하여야 합니다.`, 413);
  }
  return { ...request, value };
}

function validateDelete(body) {
  return validateConfirmedMutation(body);
}

function validateConfirmedMutation(body) {
  ensureObject(body);
  const environment = resolveEnvironment(body.environment);
  const dataStore = resolveDataStore(body.dataStore);
  const playFabId = validatePlayFabId(body.playFabId);
  if (body.confirmed !== true) {
    throw playerDataError('대상과 작업 내용을 확인해 주세요.', 400);
  }
  const key = validateDataKey(body.key);
  const reason = String(body.reason || '').trim();
  if (reason.length < 3) throw playerDataError('처리 사유를 3자 이상 입력해 주세요.', 400);
  if (reason.length > MAX_REASON_LENGTH) {
    throw playerDataError(`처리 사유는 ${MAX_REASON_LENGTH}자 이하로 입력해 주세요.`, 400);
  }
  const editToken = String(body.editToken || '').trim();
  if (!/^[A-Za-z0-9_-]{20,200}$/.test(editToken)) {
    throw playerDataError('편집 세션이 올바르지 않습니다. 다시 조회해 주세요.', 400);
  }
  return { environment, dataStore, playFabId, key, reason, editToken };
}

function validateDataKey(value) {
  const key = String(value ?? '').trim();
  if (!key || key.length > 200 || /[\u0000-\u001f]/.test(key)) {
    throw playerDataError('데이터 키 형식이 올바르지 않습니다.', 400);
  }
  return key;
}

function ensureObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw playerDataError('요청 형식이 올바르지 않습니다.', 400);
  }
}

function issueEditToken(tokens, value, now) {
  cleanupTokens(tokens, now());
  if (tokens.size >= MAX_EDIT_TOKENS) {
    const oldest = tokens.keys().next().value;
    if (oldest) tokens.delete(oldest);
  }
  const token = crypto.randomBytes(32).toString('base64url');
  tokens.set(token, { ...value, expiresAt: now() + EDIT_TOKEN_TTL_MS });
  return token;
}

function consumeValidToken(tokens, value, now) {
  cleanupTokens(tokens, now());
  const token = tokens.get(value);
  if (!token) throw playerDataError('편집 세션이 만료되었습니다. 다시 조회해 주세요.', 409);
  return token;
}

function requireMatchingEditToken(tokens, request, authenticatedUser, now) {
  const token = consumeValidToken(tokens, request.editToken, now);
  if (token.environment !== request.environment
      || token.dataStore !== request.dataStore
      || token.playFabId.toLowerCase() !== request.playFabId.toLowerCase()) {
    throw playerDataError('조회한 대상과 작업 대상이 일치하지 않습니다. 다시 조회해 주세요.', 409);
  }
  if (token.userId !== companyUserAuditFields(authenticatedUser).userId) {
    throw playerDataError('이 편집 세션을 만든 회사 계정과 현재 계정이 일치하지 않습니다.', 403);
  }
  return token;
}

function cleanupTokens(tokens, timestamp) {
  for (const [key, token] of tokens) {
    if (token.expiresAt <= timestamp) tokens.delete(key);
  }
}

function serializeRecord(record, analysis) {
  return {
    exists: analysis.snapshot.exists,
    value: analysis.displayValue,
    jsonValid: analysis.jsonValid,
    valueType: analysis.jsonValid ? 'json' : 'text',
    bytes: analysis.snapshot.bytes,
    decodedBytes: analysis.snapshot.decodedBytes,
    compression: analysis.snapshot.encoding,
    compressionLabel: compressionLabel(analysis.snapshot.encoding),
    fallbackUsed: analysis.fallbackUsed,
    compressionError: analysis.compressionError,
    lastUpdated: String(record?.lastUpdated || ''),
    permission: String(record?.permission || '')
  };
}

function validateJson(value) {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

function analyzeRecord(key, record, allData = {}, saveCompression = true) {
  const exists = Boolean(record && typeof record === 'object');
  const storedValue = exists ? String(record.value ?? '') : '';
  let decoded;
  let fallbackUsed = false;
  let compressionError = '';
  try {
    decoded = saveCompression ? decodeStoredValue(key, storedValue) : { value: storedValue, encoding: 'plain' };
  } catch (error) {
    const fallback = saveCompression && key === SAVE_COMPRESSION_KEY ? allData?.[SAVE_DATA_KEY] : null;
    if (!fallback) throw error;
    decoded = { value: String(fallback.value ?? ''), encoding: 'legacy-fallback' };
    fallbackUsed = true;
    compressionError = error.message;
  }
  return {
    snapshot: {
      ...makeRawSnapshot(record),
      decodedBytes: Buffer.byteLength(decoded.value, 'utf8'),
      encoding: decoded.encoding
    },
    displayValue: decoded.value,
    jsonValid: validateJson(decoded.value),
    fallbackUsed,
    compressionError
  };
}

export function decodeStoredValue(key, storedValue) {
  const value = String(storedValue ?? '');
  if (key !== SAVE_COMPRESSION_KEY) {
    return { value, encoding: key === SAVE_DATA_KEY ? 'legacy-plain' : 'plain' };
  }
  if (!value.startsWith(SAVE_COMPRESSION_PREFIX)) {
    throw playerDataError('SaveData-Compression이 gzip-v1 형식이 아닙니다.', 422);
  }

  const body = value.slice(SAVE_COMPRESSION_PREFIX.length);
  const separator = body.indexOf(':');
  if (separator < 0) throw playerDataError('SaveData-Compression에 원본 크기 정보가 없습니다.', 422);
  const lengthText = body.slice(0, separator);
  if (!/^(0|[1-9]\d*)$/.test(lengthText)) {
    throw playerDataError('SaveData-Compression의 원본 크기 형식이 올바르지 않습니다.', 422);
  }
  const expectedLength = Number(lengthText);
  if (!Number.isSafeInteger(expectedLength) || expectedLength < 0 || expectedLength > MAX_DECOMPRESSED_BYTES) {
    throw playerDataError('SaveData-Compression의 원본 크기가 허용 범위를 벗어났습니다.', 422);
  }

  const compressed = decodeBase64Strict(body.slice(separator + 1));
  if (!compressed) throw playerDataError('SaveData-Compression의 표준 Base64 형식이 올바르지 않습니다.', 422);
  let output;
  try {
    output = gunzipSync(compressed, { maxOutputLength: MAX_DECOMPRESSED_BYTES });
  } catch {
    throw playerDataError('SaveData-Compression의 GZip 데이터가 손상되었거나 크기 제한을 초과했습니다.', 422);
  }
  if (output.length !== expectedLength) {
    throw playerDataError(`SaveData-Compression 원본 크기가 일치하지 않습니다. expected=${expectedLength}, actual=${output.length}`, 422);
  }

  let decoded;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(output);
  } catch {
    throw playerDataError('SaveData-Compression을 올바른 UTF-8 문자열로 변환하지 못했습니다.', 422);
  }
  return { value: decoded, encoding: 'gzip-v1' };
}

export function encodeStoredValue(key, editedValue) {
  const value = String(editedValue ?? '');
  if (key !== SAVE_COMPRESSION_KEY) return value;
  if (value.startsWith('\uFEFF')) {
    throw playerDataError('SaveData JSON 앞의 UTF-8 BOM 문자를 제거해 주세요.', 400);
  }
  if (hasUnpairedSurrogate(value)) {
    throw playerDataError('SaveData에 올바르지 않은 UTF-16 문자가 있어 UTF-8로 변환할 수 없습니다.', 400);
  }
  const raw = Buffer.from(value, 'utf8');
  if (raw.length > MAX_DECOMPRESSED_BYTES) {
    throw playerDataError('원본 SaveData가 32MB를 초과했습니다.', 413);
  }
  const compressed = gzipSync(raw).toString('base64');
  return `${SAVE_COMPRESSION_PREFIX}${raw.length}:${compressed}`;
}

function decodeBase64Strict(value) {
  const raw = String(value ?? '');
  const normalized = raw.trim();
  if (raw !== normalized) return null;
  if (!normalized || normalized.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) return null;
  try {
    const buffer = Buffer.from(normalized, 'base64');
    if (buffer.toString('base64') !== normalized) return null;
    return buffer;
  } catch {
    return null;
  }
}

function hasUnpairedSurrogate(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function normalizeEditedValue(key, value, requireSaveJson = isSaveDataKey(key)) {
  const text = String(value ?? '');
  if (Buffer.byteLength(text, 'utf8') > MAX_VALUE_BYTES) {
    throw playerDataError('편집 데이터가 32MB를 초과했습니다.', 413);
  }
  try {
    JSON.parse(text);
  } catch {
    if (requireSaveJson) throw playerDataError('SaveData는 올바른 JSON 또는 ES3 데이터여야 합니다.', 400);
    return text;
  }
  return text;
}

function sortDataKeys(keys) {
  const priority = new Map([[SAVE_COMPRESSION_KEY, 0], [SAVE_DATA_KEY, 1], ['AutoSaveData', 2]]);
  return [...keys].sort((left, right) => {
    const leftPriority = priority.get(left) ?? 3;
    const rightPriority = priority.get(right) ?? 3;
    return leftPriority - rightPriority || left.localeCompare(right, 'en');
  });
}

function compressionLabel(value) {
  if (value === 'gzip-v1') return 'gzip-v1 · GZip + Base64';
  if (value === 'legacy-fallback') return '압축 오류 · SaveData 폴백';
  if (value === 'legacy-plain') return '레거시 SaveData · 저장 시 gzip-v1 전환';
  return '압축 없음';
}

function makeRawSnapshot(record) {
  const exists = Boolean(record && typeof record === 'object');
  const value = exists ? String(record.value ?? '') : '';
  return {
    exists,
    hash: hashText(exists ? value : '__missing__'),
    bytes: exists ? Buffer.byteLength(value, 'utf8') : 0,
    decodedBytes: exists ? Buffer.byteLength(value, 'utf8') : 0,
    encoding: 'plain'
  };
}

function isSaveDataKey(key) {
  return key === SAVE_DATA_KEY || key === SAVE_COMPRESSION_KEY;
}

function sameSnapshot(left, right) {
  return Boolean(right) && left.exists === right.exists && left.hash === right.hash;
}

async function readDataStore(client, store, request) {
  const method = client?.[store.getter];
  if (typeof method !== 'function') {
    throw playerDataError(`${store.label} 조회 API가 설정되지 않았습니다.`, 503);
  }
  return await method.call(client, request);
}

async function updateDataStore(client, store, request) {
  const method = client?.[store.updater];
  if (typeof method !== 'function') {
    throw playerDataError(`${store.label} 수정 API가 설정되지 않았습니다.`, 503);
  }
  return await method.call(client, request);
}

function hashText(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function requireConfiguredEnvironment(environments, id) {
  const env = environments[id];
  if (!env?.client) throw playerDataError(`${environmentLabel(id)} PlayFab 연결이 설정되지 않았습니다.`, 503);
  return env;
}

function canWrite(env) {
  return Boolean(env.client && (env.client.mode === 'mock' || env.writeEnabled));
}

function resolveEnvironment(value) {
  const normalized = String(value ?? 'live').trim().toLowerCase();
  if (!ENVIRONMENT_IDS.includes(normalized)) {
    throw playerDataError('PlayFab 서버는 live 또는 test 중 하나여야 합니다.', 400);
  }
  return normalized;
}

function resolveDataStore(value) {
  const raw = String(value ?? DEFAULT_DATA_STORE).trim().toLowerCase();
  const aliases = {
    user: 'user', userdata: 'user',
    readonly: 'readonly', userreadonlydata: 'readonly',
    internal: 'internal', userinternaldata: 'internal'
  };
  const id = aliases[raw];
  if (!id || !DATA_STORES[id]) {
    throw playerDataError('데이터 저장소는 user, readonly 또는 internal 중 하나여야 합니다.', 400);
  }
  return id;
}

function resolveLookupDataStore(value) {
  const normalized = String(value ?? DEFAULT_DATA_STORE).trim().toLowerCase();
  return normalized === ALL_DATA_STORES ? ALL_DATA_STORES : resolveDataStore(normalized);
}

function environmentLabel(id) {
  return id === 'test' ? '테스트 서버' : '라이브 서버';
}

async function appendAudit(filePath, record) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 });
}

async function appendAuditSafely(filePath, record) {
  try {
    await appendAudit(filePath, record);
  } catch (error) {
    console.error(`[player-data-audit] ${error?.message || error}`);
  }
}

function parseBooleanSetting(value, fallback = false) {
  if (value === undefined || value === null || value === '') return Boolean(fallback);
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function playerDataError(message, statusCode) {
  const error = new Error(message);
  error.name = 'PlayerDataError';
  error.statusCode = statusCode;
  return error;
}

function response(statusCode, payload) {
  return { statusCode, payload };
}

function formatBytes(bytes) {
  return `${Math.round(bytes / 1_024)}KB`;
}
