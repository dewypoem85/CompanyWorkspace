import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  PRODUCT_COMMAND_KEYS,
  buildProductCommandValue,
  createProductRequestId,
  mergeProductCommandValue,
  summarizeProductCommand,
  validateOperation,
  validatePlayFabId,
  validatePlayFabIds,
  validateProductCommandLookupRequest,
  validateProductCommandMemo,
  validateProductCommandPreviewRequest
} from './product-command.js';
import {
  createMockProductPlayFabClient,
  createProductPlayFabClient,
  ProductPlayFabApiError
} from './product-playfab.js';
import { companyUserAuditFields } from './company-user.js';

const PLAN_TTL_MS = 15 * 60_000;
const MAX_STORED_PLANS = 200;
const COMMAND_KEYS = ['지급', '회수'];
const DATA_STORE = 'UserReadOnlyData';
const ENVIRONMENT_IDS = ['live', 'test'];

export function createProductCommandApi({
  dataDir,
  titleId,
  secretKey,
  liveEnabled = false,
  mockMode = false,
  concurrency = 4,
  playFabClient = null,
  environmentClients = null,
  now = () => Date.now()
}) {
  const auditPath = path.join(dataDir, 'playfab-product-command-audit.jsonl');
  const plans = new Map();
  const locks = new Set();
  const rateLimits = new Map();
  const safeConcurrency = clampInteger(concurrency, 1, 10, 4);

  const environments = createEnvironmentMap({
    titleId,
    secretKey,
    liveEnabled,
    mockMode,
    playFabClient,
    environmentClients
  });

  const firstClient = environments.test.client || environments.live.client || null;

  async function handle({ path: requestPath, body, authenticatedUser, requestId, ip }) {
    cleanupPlans();
    enforceRateLimit(requestPath, ip);

    if (requestPath === '/api/playfab/product-commands/config') {
      return response(200, serializeConfig());
    }

    if (requestPath === '/api/playfab/product-commands/preview') {
      const environment = resolveEnvironment(body?.environment);
      ensureEnvironmentConfigured(environment);
      const input = validateProductCommandPreviewRequest(body);
      return response(200, await createPreview(environment, input));
    }

    if (requestPath === '/api/playfab/product-commands/execute') {
      const token = validatePlanToken(body?.previewToken);
      const plan = getPlan(token);
      if (body?.environment !== undefined && resolveEnvironment(body.environment) !== plan.environment) {
        const error = validationError('미리보기와 실행 대상 PlayFab 서버가 다릅니다. 새로 미리보기해 주세요.');
        error.statusCode = 409;
        throw error;
      }
      return response(200, await executePlan(plan, body, { authenticatedUser, requestId, ip }));
    }

    if (requestPath === '/api/playfab/product-commands/lookup') {
      const environment = resolveEnvironment(body?.environment);
      ensureEnvironmentConfigured(environment);
      const input = validateProductCommandLookupRequest(body);
      return response(200, await lookupCommands(environment, input.playFabIds));
    }

    if (requestPath === '/api/playfab/product-commands/delete') {
      const environment = resolveEnvironment(body?.environment);
      ensureEnvironmentConfigured(environment);
      ensureWriteAllowed(environment);
      return response(200, await deleteCommand(environment, body, { authenticatedUser, requestId, ip }));
    }

    return response(404, { error: '상품 지급·회수 API 경로를 찾을 수 없습니다.' });
  }

  function serializeConfig() {
    const environmentItems = ENVIRONMENT_IDS.map((id) => serializeEnvironmentConfig(id, environments[id]));
    const defaultEnvironment = environments.live.client ? 'live' : (environments.test.client ? 'test' : 'live');
    const defaultConfig = environments[defaultEnvironment];
    return {
      configured: environmentItems.some((item) => item.configured),
      defaultEnvironment,
      dataStore: DATA_STORE,
      concurrency: safeConcurrency,
      planTtlSeconds: Math.floor(PLAN_TTL_MS / 1000),
      environments: environmentItems,
      mode: defaultConfig.client?.mode || 'disabled',
      liveEnabled: Boolean(defaultConfig.liveEnabled),
      writeEnabled: Boolean(defaultConfig.client && (defaultConfig.client.mode === 'mock' || defaultConfig.liveEnabled))
    };
  }

  async function createPreview(environment, input) {
    const env = environments[environment];
    const token = crypto.randomUUID();
    const createdAt = now();
    const key = PRODUCT_COMMAND_KEYS[input.operation];
    const lookupResults = await mapWithConcurrency(input.playFabIds, safeConcurrency, async (playFabId) => {
      try {
        const current = await env.client.getUserReadOnlyData({ playFabId, keys: COMMAND_KEYS });
        return { playFabId, current, error: null };
      } catch (error) {
        return { playFabId, current: null, error: safePlayFabError(error) };
      }
    });

    const items = lookupResults.map(({ playFabId, current, error }) => {
      const productRequestId = createProductRequestId(input.operation);
      const requestedRecord = current?.data?.[key] || null;
      const oppositeKey = input.operation === 'grant' ? PRODUCT_COMMAND_KEYS.revoke : PRODUCT_COMMAND_KEYS.grant;
      const oppositeRecord = current?.data?.[oppositeKey] || null;
      let commandJson = null;
      let mergeError = null;
      try {
        commandJson = requestedRecord
          ? mergeProductCommandValue(requestedRecord.value, input.command, productRequestId)
          : buildProductCommandValue(input.command, productRequestId);
      } catch (error) {
        mergeError = error?.message || '기존 명령을 병합하지 못했습니다.';
      }
      return {
        playFabId,
        requestId: productRequestId,
        commandJson,
        mergeError,
        previewLookupError: error,
        snapshotExists: Boolean(requestedRecord),
        snapshotValue: requestedRecord?.value ?? null,
        snapshotLastUpdated: requestedRecord?.lastUpdated ?? '',
        oppositeValue: oppositeRecord?.value ?? null,
        oppositeLastUpdated: oppositeRecord?.lastUpdated ?? '',
        dataVersion: current?.dataVersion ?? null,
        attemptCount: 0
      };
    });

    const plan = {
      token,
      environment,
      createdAt,
      expiresAt: createdAt + PLAN_TTL_MS,
      operation: input.operation,
      key,
      memo: input.memo,
      command: input.command,
      summary: summarizeProductCommand(input.command, input.playFabIds.length),
      items
    };
    plans.set(token, plan);
    trimPlans();
    return serializePlan(plan);
  }

  async function executePlan(plan, body, context) {
    const dryRun = body?.dryRun !== false;
    if (!dryRun) ensureWriteAllowed(plan.environment);

    const mergeSet = validatePlanSubset(body?.mergePlayFabIds, plan, { allowEmpty: true });
    const requestedSubset = validatePlanSubset(body?.playFabIds, plan, { allowEmpty: true, defaultAll: true });
    const selectedItems = plan.items.filter((item) => requestedSubset.has(item.playFabId.toLowerCase()));

    const results = await mapWithConcurrency(selectedItems, safeConcurrency, async (item) => {
      return executeItem(plan, item, {
        dryRun,
        mergeApproved: mergeSet.has(item.playFabId.toLowerCase()),
        ...context
      });
    });

    return {
      previewToken: plan.token,
      environment: plan.environment,
      environmentLabel: environmentLabel(plan.environment),
      operation: plan.operation,
      key: plan.key,
      dataStore: DATA_STORE,
      dryRun,
      ...summarizeResults(results),
      results
    };
  }

  async function executeItem(plan, item, context) {
    const env = environments[plan.environment];
    const lockKey = `${plan.environment}:${item.playFabId.toLowerCase()}:${plan.key}`;
    if (locks.has(lockKey)) {
      return result(item, 'skipped', { error: '같은 UID의 동일 명령 키가 이미 처리 중입니다.' });
    }

    locks.add(lockKey);
    const repeatedExecution = item.attemptCount > 0;
    item.attemptCount += 1;
    try {
      if (item.previewLookupError) {
        return result(item, 'failed', {
          error: '미리보기에서 기존 명령 조회에 실패했습니다. 다시 미리보기를 실행해 주세요.',
          playFabErrorCode: item.previewLookupError.errorCode,
          playFabError: item.previewLookupError.errorName
        });
      }

      if (item.mergeError || !item.commandJson) {
        return result(item, 'failed', {
          error: item.mergeError || '병합 후 명령을 만들지 못했습니다. 새로 미리보기해 주세요.'
        });
      }

      let current;
      try {
        current = await env.client.getUserReadOnlyData({ playFabId: item.playFabId, keys: COMMAND_KEYS });
      } catch (error) {
        const safe = safePlayFabError(error);
        return result(item, 'failed', {
          error: safe.message,
          playFabErrorCode: safe.errorCode,
          playFabError: safe.errorName,
          retryCount: safe.retryCount
        });
      }

      const currentRecord = current.data?.[plan.key] || null;
      const currentExists = Boolean(currentRecord);
      const currentValue = currentRecord?.value ?? null;
      const currentVersion = current.dataVersion ?? null;
      const readRetryCount = current.retryCount ?? 0;

      if (repeatedExecution && currentExists && currentValue === item.commandJson) {
        await appendAuditSafe({
          ...auditBase(plan, item, context, currentValue, currentVersion),
          action: item.snapshotExists ? 'merge' : 'create',
          result: 'success',
          detail: 'already_applied_same_request',
          retryCount: readRetryCount
        });
        return result(item, 'retry_success', {
          dataVersion: currentVersion,
          retryCount: readRetryCount,
          detail: '같은 요청 ID의 명령이 이미 저장되어 있어 추가 쓰기 없이 성공 처리했습니다.'
        });
      }

      if (snapshotChanged(item, currentExists, currentValue, currentVersion)) {
        await appendAuditSafe({
          ...auditBase(plan, item, context, currentValue, currentVersion),
          action: item.snapshotExists ? 'merge' : 'create',
          result: 'skipped',
          detail: 'preview_snapshot_changed',
          retryCount: readRetryCount
        });
        return result(item, 'skipped', {
          existingCommand: currentValue,
          dataVersion: currentVersion,
          retryCount: readRetryCount,
          error: '미리보기 이후 UserReadOnlyData의 키 존재 여부, 값 또는 DataVersion이 변경되었습니다. 새로 미리보기한 뒤 다시 실행해 주세요.',
          existingChanged: true
        });
      }

      if (currentExists && !context.mergeApproved) {
        await appendAuditSafe({
          ...auditBase(plan, item, context, currentValue, currentVersion),
          action: 'merge',
          result: 'skipped',
          detail: 'merge_without_approval',
          retryCount: readRetryCount
        });
        return result(item, 'existing', {
          existingCommand: currentValue,
          dataVersion: currentVersion,
          retryCount: readRetryCount,
          error: '기존 동일 키 명령이 있어 병합 승인 없이 처리하지 않았습니다.'
        });
      }

      const action = currentExists ? 'merge' : 'create';
      if (context.dryRun) {
        await appendAuditSafe({
          ...auditBase(plan, item, context, currentValue, currentVersion),
          action,
          result: 'dry_run',
          detail: currentExists ? 'merge_approved' : 'new_command',
          retryCount: readRetryCount
        });
        return result(item, 'success', {
          dryRun: true,
          existingCommand: currentValue,
          dataVersion: currentVersion,
          retryCount: readRetryCount,
          detail: 'Dry Run: UserReadOnlyData를 변경하지 않았습니다.'
        });
      }

      const attemptedAudit = await appendAuditSafe({
        ...auditBase(plan, item, context, currentValue, currentVersion),
        action,
        result: 'attempted',
        mergeApproved: context.mergeApproved,
        retryCount: readRetryCount
      });
      if (!attemptedAudit) {
        return result(item, 'failed', {
          error: '감사 로그 기록에 실패하여 PlayFab 변경을 실행하지 않았습니다.'
        });
      }

      try {
        const update = await env.client.updateUserReadOnlyData({
          playFabId: item.playFabId,
          data: { [plan.key]: item.commandJson },
          requestId: item.requestId
        });
        const retryCount = readRetryCount + (update.retryCount ?? 0);
        const retried = repeatedExecution || retryCount > 0;
        const auditRecorded = await appendAuditSafe({
          ...auditBase(plan, item, context, currentValue, currentVersion),
          action,
          result: 'success',
          retryCount,
          dataVersion: update.dataVersion
        });
        return result(item, retried ? 'retry_success' : 'success', {
          dataVersion: update.dataVersion,
          retryCount,
          auditRecorded
        });
      } catch (error) {
        const safe = safePlayFabError(error);
        const retryCount = readRetryCount + safe.retryCount;
        await appendAuditSafe({
          ...auditBase(plan, item, context, currentValue, currentVersion),
          action,
          result: 'failed',
          playFabErrorCode: safe.errorCode,
          playFabError: safe.errorName,
          errorMessage: safe.message,
          retryCount
        });
        return result(item, 'failed', {
          error: safe.message,
          playFabErrorCode: safe.errorCode,
          playFabError: safe.errorName,
          retryCount
        });
      }
    } finally {
      locks.delete(lockKey);
    }
  }

  async function lookupCommands(environment, playFabIds) {
    const env = environments[environment];
    const results = await mapWithConcurrency(playFabIds, safeConcurrency, async (playFabId) => {
      try {
        const current = await env.client.getUserReadOnlyData({ playFabId, keys: COMMAND_KEYS });
        return {
          playFabId,
          success: true,
          environment,
          dataStore: DATA_STORE,
          dataVersion: current.dataVersion,
          retryCount: current.retryCount ?? 0,
          grant: serializeRecord(current.data?.[PRODUCT_COMMAND_KEYS.grant]),
          revoke: serializeRecord(current.data?.[PRODUCT_COMMAND_KEYS.revoke])
        };
      } catch (error) {
        const safe = safePlayFabError(error);
        return {
          playFabId,
          success: false,
          environment,
          dataStore: DATA_STORE,
          grant: null,
          revoke: null,
          error: safe.message,
          playFabErrorCode: safe.errorCode,
          playFabError: safe.errorName,
          retryCount: safe.retryCount
        };
      }
    });
    return {
      environment,
      environmentLabel: environmentLabel(environment),
      dataStore: DATA_STORE,
      totalCount: results.length,
      successCount: results.filter((item) => item.success).length,
      results
    };
  }

  async function deleteCommand(environment, body, context) {
    const env = environments[environment];
    const playFabId = validatePlayFabId(body?.playFabId);
    const operation = validateOperation(body?.operation);
    const memo = validateProductCommandMemo(body?.memo);
    const key = PRODUCT_COMMAND_KEYS[operation];
    const expectedValue = body?.expectedValue === null || body?.expectedValue === undefined
      ? null
      : String(body.expectedValue);
    const expectedDataVersion = validateExpectedDataVersion(body?.expectedDataVersion);
    const lockKey = `${environment}:${playFabId.toLowerCase()}:${key}`;
    if (locks.has(lockKey)) {
      return { status: 'skipped', environment, playFabId, key, error: '같은 UID의 동일 명령 키가 이미 처리 중입니다.' };
    }

    locks.add(lockKey);
    try {
      const current = await env.client.getUserReadOnlyData({ playFabId, keys: COMMAND_KEYS });
      const currentRecord = current.data?.[key] || null;
      const currentValue = currentRecord?.value ?? null;
      const currentVersion = current.dataVersion ?? null;
      const readRetryCount = current.retryCount ?? 0;

      if (currentValue === null) {
        return { status: 'skipped', environment, playFabId, key, dataVersion: currentVersion, detail: '삭제할 대기 명령이 없습니다.' };
      }
      if (expectedValue !== currentValue || expectedDataVersion !== currentVersion) {
        const error = validationError('조회 이후 UserReadOnlyData의 명령 값 또는 DataVersion이 변경되었습니다. 현재 명령을 다시 조회한 뒤 삭제해 주세요.');
        error.statusCode = 409;
        throw error;
      }

      const auditRequestId = `delete-${crypto.randomUUID()}`;
      const commandRequestId = extractCommandRequestId(currentValue) || auditRequestId;
      const auditBaseEntry = {
        timestamp: new Date().toISOString(),
        executionMode: executionMode(environment, false),
        environment,
        user: context.authenticatedUser,
        ip: context.ip,
        titleId: env.titleId,
        dataStore: DATA_STORE,
        playFabId,
        operation,
        key,
        requestId: commandRequestId,
        auditRequestId,
        memo,
        action: 'delete',
        beforeExists: true,
        beforeValueHash: hashValue(currentValue),
        beforeDataVersion: currentVersion
      };

      const attemptedAudit = await appendAuditSafe({
        ...auditBaseEntry,
        result: 'attempted',
        retryCount: readRetryCount
      });
      if (!attemptedAudit) {
        return { status: 'failed', environment, playFabId, key, error: '감사 로그 기록에 실패하여 삭제하지 않았습니다.' };
      }

      try {
        const update = await env.client.updateUserReadOnlyData({
          playFabId,
          keysToRemove: [key],
          requestId: auditRequestId
        });
        const retryCount = readRetryCount + (update.retryCount ?? 0);
        const auditRecorded = await appendAuditSafe({
          ...auditBaseEntry,
          result: 'success',
          dataVersion: update.dataVersion,
          retryCount
        });
        return {
          status: retryCount > 0 ? 'retry_success' : 'success',
          environment,
          playFabId,
          key,
          requestId: commandRequestId,
          dataVersion: update.dataVersion,
          retryCount,
          auditRecorded
        };
      } catch (error) {
        const safe = safePlayFabError(error);
        const retryCount = readRetryCount + safe.retryCount;
        await appendAuditSafe({
          ...auditBaseEntry,
          result: 'failed',
          playFabErrorCode: safe.errorCode,
          playFabError: safe.errorName,
          errorMessage: safe.message,
          retryCount
        });
        return {
          status: 'failed',
          environment,
          playFabId,
          key,
          requestId: commandRequestId,
          error: safe.message,
          playFabErrorCode: safe.errorCode,
          playFabError: safe.errorName,
          retryCount
        };
      }
    } finally {
      locks.delete(lockKey);
    }
  }

  function auditBase(plan, item, context, beforeValue, beforeDataVersion) {
    const env = environments[plan.environment];
    return {
      timestamp: new Date().toISOString(),
      executionMode: executionMode(plan.environment, context.dryRun),
      environment: plan.environment,
      user: context.authenticatedUser,
      ip: context.ip,
      titleId: env.titleId,
      dataStore: DATA_STORE,
      playFabId: item.playFabId,
      operation: plan.operation,
      key: plan.key,
      requestId: item.requestId,
      memo: plan.memo,
      commandJson: item.commandJson,
      beforeExists: beforeValue !== null,
      beforeValueHash: hashValue(beforeValue),
      previewDataVersion: item.dataVersion,
      beforeDataVersion
    };
  }

  function executionMode(environment, dryRun) {
    if (dryRun) return 'dry_run';
    return environments[environment].client?.mode === 'mock' ? 'mock' : 'live';
  }

  async function appendAuditSafe(entry) {
    try {
      const { user, ...details } = entry;
      const record = { ...details, ...companyUserAuditFields(user) };
      await fs.appendFile(auditPath, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 });
      return true;
    } catch (error) {
      console.error(`[audit] product_command_write_failed requestId=${entry.requestId || '-'} result=${entry.result || '-'} type=${error?.name || 'Error'}`);
      return false;
    }
  }

  function ensureEnvironmentConfigured(environment) {
    if (!environments[environment].client) {
      const error = new Error(`${environmentLabel(environment)} PlayFab Title ID 또는 Secret Key가 설정되지 않았습니다.`);
      error.statusCode = 503;
      throw error;
    }
  }

  function ensureWriteAllowed(environment) {
    ensureEnvironmentConfigured(environment);
    const env = environments[environment];
    if (env.client.mode !== 'mock' && !env.liveEnabled) {
      const error = new Error(`${environmentLabel(environment)} 상품 명령 LIVE 쓰기가 서버 설정에서 비활성화되어 있습니다.`);
      error.statusCode = 403;
      throw error;
    }
  }

  function getPlan(token) {
    const plan = plans.get(token);
    if (!plan) {
      const error = validationError('미리보기가 없거나 만료되었습니다. 새 미리보기를 생성해 주세요.');
      error.statusCode = 410;
      throw error;
    }
    if (plan.expiresAt <= now()) {
      plans.delete(token);
      const error = validationError('미리보기가 만료되었습니다. 새 미리보기를 생성해 주세요.');
      error.statusCode = 410;
      throw error;
    }
    return plan;
  }

  function cleanupPlans() {
    const current = now();
    for (const [token, plan] of plans) {
      if (plan.expiresAt <= current) plans.delete(token);
    }
  }

  function trimPlans() {
    if (plans.size <= MAX_STORED_PLANS) return;
    const ordered = [...plans.values()].sort((a, b) => a.createdAt - b.createdAt);
    for (const plan of ordered.slice(0, plans.size - MAX_STORED_PLANS)) plans.delete(plan.token);
  }

  function enforceRateLimit(requestPath, ip) {
    const current = now();
    const key = `${requestPath}:${ip || 'unknown'}`;
    const windowMs = 60_000;
    const limit = requestPath.endsWith('/execute') || requestPath.endsWith('/delete') ? 30 : 120;
    const item = rateLimits.get(key);
    if (!item || item.resetAt <= current) {
      rateLimits.set(key, { count: 1, resetAt: current + windowMs });
      return;
    }
    item.count += 1;
    if (item.count > limit) {
      const error = validationError('상품 명령 요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.');
      error.statusCode = 429;
      throw error;
    }
    if (rateLimits.size > 2_000) {
      for (const [entryKey, value] of rateLimits) {
        if (value.resetAt <= current) rateLimits.delete(entryKey);
      }
    }
  }

  return {
    client: firstClient,
    environments,
    handle
  };
}

function createEnvironmentMap({
  titleId,
  secretKey,
  liveEnabled,
  mockMode,
  playFabClient,
  environmentClients
}) {
  const explicitCredentials = Boolean(
    String(process.env.PLAYFAB_LIVE_SECRET_KEY || '').trim()
    || String(process.env.PLAYFAB_TEST_SECRET_KEY || '').trim()
  );
  const explicitMockSetting = process.env.PLAYFAB_PRODUCT_COMMANDS_MOCK_MODE;
  const effectiveMockMode = explicitMockSetting === undefined
    ? (explicitCredentials ? false : Boolean(mockMode))
    : parseBooleanSetting(explicitMockSetting, Boolean(mockMode));

  const globalWriteEnabled = Boolean(liveEnabled);
  const liveTitleId = String(process.env.PLAYFAB_LIVE_TITLE_ID || titleId || '').trim();
  const liveSecretKey = String(process.env.PLAYFAB_LIVE_SECRET_KEY || secretKey || '').trim();
  const testTitleId = String(process.env.PLAYFAB_TEST_TITLE_ID || '').trim();
  const testSecretKey = String(process.env.PLAYFAB_TEST_SECRET_KEY || '').trim();

  const providedLiveClient = environmentClients?.live || playFabClient || null;
  const providedTestClient = environmentClients?.test || null;

  return {
    live: createEnvironment({
      id: 'live',
      titleId: liveTitleId,
      secretKey: liveSecretKey,
      effectiveMockMode,
      providedClient: providedLiveClient,
      writeEnabled: parseBooleanSetting(process.env.PLAYFAB_PRODUCT_COMMANDS_LIVE_ENABLED, globalWriteEnabled)
    }),
    test: createEnvironment({
      id: 'test',
      titleId: testTitleId,
      secretKey: testSecretKey,
      effectiveMockMode,
      providedClient: providedTestClient,
      writeEnabled: parseBooleanSetting(process.env.PLAYFAB_PRODUCT_COMMANDS_TEST_ENABLED, globalWriteEnabled)
    })
  };
}

function createEnvironment({
  id,
  titleId,
  secretKey,
  effectiveMockMode,
  providedClient,
  writeEnabled
}) {
  let client = providedClient;
  if (!client) {
    if (effectiveMockMode) {
      client = createMockProductPlayFabClient();
    } else if (titleId && secretKey) {
      client = createProductPlayFabClient({ titleId, secretKey });
    }
  }

  return {
    id,
    label: environmentLabel(id),
    titleId,
    client,
    liveEnabled: Boolean(writeEnabled)
  };
}

function serializeEnvironmentConfig(id, env) {
  return {
    id,
    label: environmentLabel(id),
    configured: Boolean(env.client),
    titleId: env.titleId,
    mode: env.client?.mode || 'disabled',
    liveEnabled: Boolean(env.liveEnabled),
    writeEnabled: Boolean(env.client && (env.client.mode === 'mock' || env.liveEnabled)),
    dataStore: DATA_STORE
  };
}

function resolveEnvironment(value) {
  const normalized = String(value ?? 'live').trim().toLowerCase();
  if (!ENVIRONMENT_IDS.includes(normalized)) {
    throw validationError('PlayFab 서버는 live 또는 test 중 하나여야 합니다.');
  }
  return normalized;
}

function environmentLabel(environment) {
  return environment === 'test' ? '테스트 서버' : '라이브 서버';
}

function serializePlan(plan) {
  return {
    previewToken: plan.token,
    environment: plan.environment,
    environmentLabel: environmentLabel(plan.environment),
    dataStore: DATA_STORE,
    createdAt: new Date(plan.createdAt).toISOString(),
    expiresAt: new Date(plan.expiresAt).toISOString(),
    operation: plan.operation,
    key: plan.key,
    memo: plan.memo,
    summary: plan.summary,
    existingCount: plan.items.filter((item) => item.snapshotExists).length,
    lookupFailureCount: plan.items.filter((item) => item.previewLookupError).length,
    mergeFailureCount: plan.items.filter((item) => item.mergeError).length,
    items: plan.items.map((item) => ({
      playFabId: item.playFabId,
      requestId: item.requestId,
      commandJson: item.commandJson,
      mergeError: item.mergeError,
      existingCommand: item.snapshotValue,
      existingLastUpdated: item.snapshotLastUpdated,
      oppositeCommand: item.oppositeValue,
      oppositeLastUpdated: item.oppositeLastUpdated,
      dataVersion: item.dataVersion,
      lookupError: item.previewLookupError?.message || null,
      playFabErrorCode: item.previewLookupError?.errorCode ?? null,
      playFabError: item.previewLookupError?.errorName || ''
    }))
  };
}

function result(item, status, extra = {}) {
  return {
    playFabId: item.playFabId,
    requestId: item.requestId,
    status,
    dryRun: false,
    retryCount: 0,
    ...extra
  };
}

function summarizeResults(results) {
  const count = (status) => results.filter((item) => item.status === status).length;
  return {
    totalCount: results.length,
    successCount: count('success'),
    retrySuccessCount: count('retry_success'),
    failureCount: count('failed'),
    skippedCount: count('skipped'),
    existingCount: count('existing')
  };
}

function snapshotChanged(item, currentExists, currentValue, currentVersion) {
  return item.snapshotExists !== currentExists
    || item.snapshotValue !== currentValue
    || item.dataVersion !== currentVersion;
}

function serializeRecord(record) {
  if (!record) return null;
  return {
    value: record.value,
    lastUpdated: record.lastUpdated,
    permission: record.permission
  };
}

function validatePlanToken(value) {
  const token = String(value ?? '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(token)) throw validationError('미리보기 토큰이 올바르지 않습니다.');
  return token;
}

function validatePlanSubset(value, plan, { allowEmpty = false, defaultAll = false } = {}) {
  if (value === undefined || value === null) {
    if (defaultAll) return new Set(plan.items.map((item) => item.playFabId.toLowerCase()));
    return new Set();
  }
  if (!Array.isArray(value)) throw validationError('UID 선택 목록 형식이 올바르지 않습니다.');
  if (!value.length && !allowEmpty) throw validationError('UID 선택 목록이 비어 있습니다.');

  const allowed = new Map(plan.items.map((item) => [item.playFabId.toLowerCase(), item.playFabId]));
  const normalized = validatePlayFabIds(value.length ? value : plan.items.map((item) => item.playFabId)).map((id) => id.toLowerCase());
  const result = new Set();
  for (const id of normalized) {
    if (!allowed.has(id)) throw validationError(`미리보기에 없는 UID가 포함되어 있습니다: ${id}`);
    result.add(id);
  }
  if (!value.length && allowEmpty) return new Set();
  return result;
}

function validateExpectedDataVersion(value) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < 0) throw validationError('DataVersion이 올바르지 않습니다. 다시 조회해 주세요.');
  return numeric;
}

function extractCommandRequestId(value) {
  try {
    const parsed = JSON.parse(String(value || ''));
    return typeof parsed?.['요청ID'] === 'string' ? parsed['요청ID'].slice(0, 120) : '';
  } catch {
    return '';
  }
}

function hashValue(value) {
  if (value === null || value === undefined) return null;
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function safePlayFabError(error) {
  if (error instanceof ProductPlayFabApiError) {
    return {
      message: error.message,
      errorCode: error.errorCode,
      errorName: error.errorName,
      retryCount: error.retryCount ?? 0
    };
  }
  return {
    message: 'PlayFab 요청 처리 중 오류가 발생했습니다.',
    errorCode: null,
    errorName: '',
    retryCount: 0
  };
}

function response(statusCode, payload) {
  return { statusCode, payload };
}

function validationError(message) {
  const error = new Error(message);
  error.name = 'ValidationError';
  error.statusCode = 400;
  return error;
}

function clampInteger(rawValue, minimum, maximum, fallback) {
  const parsed = Number.parseInt(rawValue ?? '', 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function parseBooleanSetting(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

async function mapWithConcurrency(items, concurrency, worker) {
  if (!items.length) return [];
  const results = new Array(items.length);
  let nextIndex = 0;
  async function run() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}
