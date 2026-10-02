const UPSTREAM_ERROR_STATUS = 424;
const DEFAULT_RETRIES = 2;

export class ProductPlayFabApiError extends Error {
  constructor(message, {
    errorCode = null,
    errorName = '',
    statusCode = UPSTREAM_ERROR_STATUS,
    upstreamStatus = null,
    retryable = false,
    retryCount = 0
  } = {}) {
    super(message);
    this.name = 'ProductPlayFabApiError';
    this.errorCode = errorCode;
    this.errorName = errorName;
    this.statusCode = statusCode;
    this.upstreamStatus = upstreamStatus;
    this.retryable = retryable;
    this.retryCount = retryCount;
  }
}

export function createProductPlayFabClient({
  titleId,
  secretKey,
  timeoutMs = 12_000,
  maxRetries = DEFAULT_RETRIES,
  fetchImpl = globalThis.fetch,
  sleepImpl = sleep
}) {
  const normalizedTitleId = String(titleId ?? '').trim();
  const normalizedSecretKey = String(secretKey ?? '').trim();
  if (!normalizedTitleId || !normalizedSecretKey) {
    throw new Error('실제 PlayFab 클라이언트에는 Title ID와 Secret Key가 필요합니다.');
  }
  const baseUrl = `https://${normalizedTitleId}.playfabapi.com`;

  async function request(path, body) {
    let retryCount = 0;
    for (;;) {
      let response;
      try {
        response = await fetchImpl(`${baseUrl}${path}`, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json; charset=UTF-8',
            'X-SecretKey': normalizedSecretKey
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs)
        });
      } catch (error) {
        const retryable = isRetryableNetworkError(error);
        if (retryable && retryCount < maxRetries) {
          retryCount += 1;
          await sleepImpl(backoffMs(retryCount));
          continue;
        }
        const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
        throw new ProductPlayFabApiError(
          timedOut
            ? 'PlayFab API 응답 시간이 초과되었습니다.'
            : 'PlayFab API에 연결하지 못했습니다.',
          { retryable, retryCount }
        );
      }

      const payload = await parsePayload(response);
      const ok = response.ok && payload?.code === 200 && payload?.status === 'OK';
      if (ok) return { data: payload.data ?? {}, retryCount };

      const retryable = isRetryableHttpStatus(response.status);
      if (retryable && retryCount < maxRetries) {
        retryCount += 1;
        await sleepImpl(retryDelayMs(response, retryCount));
        continue;
      }

      const details = formatErrorDetails(payload?.errorDetails);
      const safeBase = payload?.errorMessage || payload?.error || `PlayFab API HTTP 오류가 발생했습니다. (HTTP ${response.status})`;
      const message = details ? `${safeBase} (${details})` : safeBase;
      throw new ProductPlayFabApiError(message, {
        errorCode: payload?.errorCode ?? null,
        errorName: String(payload?.error || ''),
        upstreamStatus: response.status,
        retryable,
        retryCount
      });
    }
  }

  return {
    mode: 'live',

    async getTitleInternalData({ keys = [] } = {}) {
      const body = {};
      if (Array.isArray(keys) && keys.length) body.Keys = keys;
      const { data, retryCount } = await request('/Admin/GetTitleInternalData', body);
      const values = {};
      if (data.Data && typeof data.Data === 'object') {
        for (const [key, value] of Object.entries(data.Data)) if (typeof value === 'string') values[key] = value;
      }
      return { data: values, retryCount };
    },

    async getUserData({ playFabId, keys = [] }) {
      const body = { PlayFabId: playFabId };
      if (Array.isArray(keys) && keys.length) body.Keys = keys;
      const { data, retryCount } = await request('/Server/GetUserData', body);
      return {
        playFabId: String(data.PlayFabId || playFabId),
        dataVersion: Number.isInteger(data.DataVersion) ? data.DataVersion : null,
        data: normalizeUserData(data.Data),
        retryCount
      };
    },

    async updateUserData({ playFabId, data = null, keysToRemove = null, requestId }) {
      const body = {
        PlayFabId: playFabId,
        Permission: 'Private',
        CustomTags: {
          source: 'company-cs-player-data',
          requestId: String(requestId || '').slice(0, 120)
        }
      };
      if (data && Object.keys(data).length) body.Data = data;
      if (Array.isArray(keysToRemove) && keysToRemove.length) body.KeysToRemove = keysToRemove;

      const result = await request('/Server/UpdateUserData', body);
      return {
        dataVersion: Number.isInteger(result.data.DataVersion) ? result.data.DataVersion : null,
        retryCount: result.retryCount
      };
    },

    async getUserReadOnlyData({ playFabId, keys = [] }) {
      const body = { PlayFabId: playFabId };
      if (Array.isArray(keys) && keys.length) body.Keys = keys;
      const { data, retryCount } = await request('/Server/GetUserReadOnlyData', body);
      return {
        playFabId: String(data.PlayFabId || playFabId),
        dataVersion: Number.isInteger(data.DataVersion) ? data.DataVersion : null,
        data: normalizeReadOnlyData(data.Data),
        retryCount
      };
    },

    async updateUserReadOnlyData({ playFabId, data = null, keysToRemove = null, requestId }) {
      const body = {
        PlayFabId: playFabId,
        Permission: 'Private',
        CustomTags: {
          source: 'company-cs-product-command',
          requestId: String(requestId || '').slice(0, 120)
        }
      };
      if (data && Object.keys(data).length) body.Data = data;
      if (Array.isArray(keysToRemove) && keysToRemove.length) body.KeysToRemove = keysToRemove;

      const result = await request('/Server/UpdateUserReadOnlyData', body);
      return {
        dataVersion: Number.isInteger(result.data.DataVersion) ? result.data.DataVersion : null,
        retryCount: result.retryCount
      };
    },

    async getUserInternalData({ playFabId, keys = [] }) {
      const body = { PlayFabId: playFabId };
      if (Array.isArray(keys) && keys.length) body.Keys = keys;
      const { data, retryCount } = await request('/Admin/GetUserInternalData', body);
      return {
        playFabId: String(data.PlayFabId || playFabId),
        dataVersion: Number.isInteger(data.DataVersion) ? data.DataVersion : null,
        data: normalizeUserData(data.Data),
        retryCount
      };
    },

    async updateUserInternalData({ playFabId, data = null, keysToRemove = null, requestId }) {
      const body = {
        PlayFabId: playFabId,
        CustomTags: {
          source: 'company-cs-player-data',
          requestId: String(requestId || '').slice(0, 120)
        }
      };
      if (data && Object.keys(data).length) body.Data = data;
      if (Array.isArray(keysToRemove) && keysToRemove.length) body.KeysToRemove = keysToRemove;

      const result = await request('/Server/UpdateUserInternalData', body);
      return {
        dataVersion: Number.isInteger(result.data.DataVersion) ? result.data.DataVersion : null,
        retryCount: result.retryCount
      };
    }
  };
}

export function createMockProductPlayFabClient({ seed = {} } = {}) {
  const players = new Map();

  for (const [playFabId, record] of Object.entries(seed)) {
    const data = {};
    for (const [key, rawValue] of Object.entries(record?.data || record || {})) {
      const value = typeof rawValue === 'object' && rawValue !== null && ('Value' in rawValue || 'value' in rawValue)
        ? String(rawValue.Value ?? rawValue.value ?? '')
        : String(rawValue ?? '');
      data[key] = makeRecord(value, rawValue?.LastUpdated ?? rawValue?.lastUpdated);
    }
    const userData = {};
    for (const [key, rawValue] of Object.entries(record?.userData || {})) {
      const value = typeof rawValue === 'object' && rawValue !== null && ('Value' in rawValue || 'value' in rawValue)
        ? String(rawValue.Value ?? rawValue.value ?? '')
        : String(rawValue ?? '');
      userData[key] = makeRecord(value, rawValue?.LastUpdated ?? rawValue?.lastUpdated);
    }
    const internalData = {};
    for (const [key, rawValue] of Object.entries(record?.internalData || {})) {
      const value = typeof rawValue === 'object' && rawValue !== null && ('Value' in rawValue || 'value' in rawValue)
        ? String(rawValue.Value ?? rawValue.value ?? '')
        : String(rawValue ?? '');
      internalData[key] = makeRecord(value, rawValue?.LastUpdated ?? rawValue?.lastUpdated);
    }
    players.set(playFabId, {
      version: Number(record?.version ?? record?.dataVersion ?? 1),
      userDataVersion: Number(record?.userDataVersion ?? 1),
      internalDataVersion: Number(record?.internalDataVersion ?? 1),
      data,
      userData,
      internalData
    });
  }

  function ensurePlayer(playFabId) {
    if (!players.has(playFabId)) players.set(playFabId, {
      version: 0, userDataVersion: 0, internalDataVersion: 0, data: {}, userData: {}, internalData: {}
    });
    return players.get(playFabId);
  }

  return {
    mode: 'mock',

    async getTitleInternalData() { return { data: {}, retryCount: 0 }; },

    async getUserData({ playFabId, keys = [] }) {
      const player = ensurePlayer(playFabId);
      const wantedKeys = Array.isArray(keys) && keys.length ? keys : Object.keys(player.userData);
      const data = {};
      for (const key of wantedKeys) {
        if (player.userData[key]) data[key] = { ...player.userData[key] };
      }
      return { playFabId, dataVersion: player.userDataVersion, data, retryCount: 0 };
    },

    async updateUserData({ playFabId, data = null, keysToRemove = null }) {
      const player = ensurePlayer(playFabId);
      let changed = false;
      if (data && typeof data === 'object') {
        for (const [key, value] of Object.entries(data)) {
          player.userData[key] = makeRecord(String(value ?? ''));
          changed = true;
        }
      }
      for (const key of Array.isArray(keysToRemove) ? keysToRemove : []) {
        if (Object.hasOwn(player.userData, key)) {
          delete player.userData[key];
          changed = true;
        }
      }
      if (changed) player.userDataVersion += 1;
      return { dataVersion: player.userDataVersion, retryCount: 0 };
    },

    async getUserReadOnlyData({ playFabId, keys = [] }) {
      const player = ensurePlayer(playFabId);
      const wantedKeys = Array.isArray(keys) && keys.length ? keys : Object.keys(player.data);
      const data = {};
      for (const key of wantedKeys) {
        if (player.data[key]) data[key] = { ...player.data[key] };
      }
      return { playFabId, dataVersion: player.version, data, retryCount: 0 };
    },

    async updateUserReadOnlyData({ playFabId, data = null, keysToRemove = null }) {
      const player = ensurePlayer(playFabId);
      let changed = false;
      if (data && typeof data === 'object') {
        for (const [key, value] of Object.entries(data)) {
          player.data[key] = makeRecord(String(value ?? ''));
          changed = true;
        }
      }
      for (const key of Array.isArray(keysToRemove) ? keysToRemove : []) {
        if (Object.hasOwn(player.data, key)) {
          delete player.data[key];
          changed = true;
        }
      }
      if (changed) player.version += 1;
      return { dataVersion: player.version, retryCount: 0 };
    },

    async getUserInternalData({ playFabId, keys = [] }) {
      const player = ensurePlayer(playFabId);
      const wantedKeys = Array.isArray(keys) && keys.length ? keys : Object.keys(player.internalData);
      const data = {};
      for (const key of wantedKeys) {
        if (player.internalData[key]) data[key] = { ...player.internalData[key] };
      }
      return { playFabId, dataVersion: player.internalDataVersion, data, retryCount: 0 };
    },

    async updateUserInternalData({ playFabId, data = null, keysToRemove = null }) {
      const player = ensurePlayer(playFabId);
      let changed = false;
      if (data && typeof data === 'object') {
        for (const [key, value] of Object.entries(data)) {
          player.internalData[key] = makeRecord(String(value ?? ''));
          changed = true;
        }
      }
      for (const key of Array.isArray(keysToRemove) ? keysToRemove : []) {
        if (Object.hasOwn(player.internalData, key)) {
          delete player.internalData[key];
          changed = true;
        }
      }
      if (changed) player.internalDataVersion += 1;
      return { dataVersion: player.internalDataVersion, retryCount: 0 };
    },

    snapshot() {
      return Object.fromEntries(
        [...players.entries()].map(([playFabId, player]) => [playFabId, {
          version: player.version,
          userDataVersion: player.userDataVersion,
          internalDataVersion: player.internalDataVersion,
          data: structuredClone(player.data),
          userData: structuredClone(player.userData),
          internalData: structuredClone(player.internalData)
        }])
      );
    }
  };
}

function normalizeReadOnlyData(value) {
  return normalizeUserData(value);
}

function normalizeUserData(value) {
  if (!value || typeof value !== 'object') return {};
  const result = {};
  for (const [key, record] of Object.entries(value)) {
    if (!record || typeof record !== 'object') continue;
    result[key] = {
      value: String(record.Value ?? ''),
      lastUpdated: String(record.LastUpdated ?? ''),
      permission: String(record.Permission ?? '')
    };
  }
  return result;
}

function makeRecord(value, lastUpdated = '') {
  return {
    value,
    lastUpdated: lastUpdated || new Date().toISOString(),
    permission: 'Private'
  };
}

async function parsePayload(response) {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isRetryableNetworkError(error) {
  if (!error) return true;
  if (error?.name === 'TypeError') return true;
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return true;
  return ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ENOTFOUND', 'ECONNREFUSED'].includes(error?.code);
}

function isRetryableHttpStatus(status) {
  return status === 429 || (status >= 500 && status <= 599);
}

function retryDelayMs(response, retryCount) {
  const raw = response.headers?.get?.('retry-after');
  if (raw) {
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(5_000, Math.round(seconds * 1_000));
    const date = Date.parse(raw);
    if (Number.isFinite(date)) return Math.min(5_000, Math.max(0, date - Date.now()));
  }
  return backoffMs(retryCount);
}

function backoffMs(retryCount) {
  return Math.min(2_000, 250 * (2 ** (retryCount - 1)));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatErrorDetails(errorDetails) {
  if (!errorDetails || typeof errorDetails !== 'object') return '';
  return Object.entries(errorDetails)
    .flatMap(([key, values]) => (Array.isArray(values) ? values : [values]).map((value) => `${key}: ${value}`))
    .join(', ')
    .slice(0, 500);
}
