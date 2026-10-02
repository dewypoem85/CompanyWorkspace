const API_VERSION = '2023-11-03';
const DEFAULT_CONTAINER = 'statistics';
const DEFAULT_PREFIX = 'playfab-analytics/v2';

export function createAzureProcessedStore({
  storageAccount, container = DEFAULT_CONTAINER, sasToken, prefix = DEFAULT_PREFIX,
  titleId, fetchImpl = globalThis.fetch
} = {}) {
  const account = validateStorageAccount(storageAccount);
  const safeContainer = validateContainer(container);
  const safeSas = normalizeSasToken(sasToken);
  const safePrefix = normalizePrefix(prefix);
  const safeTitle = safePathSegment(titleId, 'PlayFab Title ID');
  const configured = Boolean(account && safeContainer && safeSas && safeTitle);

  const dayBase = dateKey => `${safePrefix}/title=${safeTitle}/date=${validateDateKey(dateKey)}`;
  const snapshotBase = () => `${safePrefix}/title=${safeTitle}/snapshots`;

  async function readDayManifest(dateKey) {
    return readJson(`${dayBase(dateKey)}/manifest.json`);
  }

  async function writeDayManifest(dateKey, manifest) {
    return putJson(`${dayBase(dateKey)}/manifest.json`, manifest);
  }

  async function readDayChunk(dateKey, chunkName) {
    const safeChunk = validateChunkName(chunkName);
    return getText(`${dayBase(dateKey)}/events/${safeChunk}`);
  }

  async function writeDayChunk(dateKey, chunkName, body) {
    const safeChunk = validateChunkName(chunkName);
    return putText(`${dayBase(dateKey)}/events/${safeChunk}`, body, 'application/x-ndjson; charset=utf-8', true);
  }

  async function readSnapshot(key) {
    return readJson(`${snapshotBase()}/${validateSnapshotKey(key)}.json`);
  }

  async function writeSnapshot(key, value) {
    return putJson(`${snapshotBase()}/${validateSnapshotKey(key)}.json`, value);
  }

  async function readJson(blobName) {
    const body = await getText(blobName);
    if (body === null) return null;
    try { return JSON.parse(body); } catch { throw storageError(424, `통계 저장소 JSON이 손상되었습니다: ${blobName}`); }
  }

  async function getText(blobName) {
    ensureConfigured();
    const response = await fetchImpl(buildBlobUrl(account, safeContainer, safeSas, blobName), {
      method: 'GET', headers: { Accept: 'application/json, application/x-ndjson, text/plain' }, cache: 'no-store'
    });
    if (response.status === 404) return null;
    if (!response.ok) throw await responseError(response, '읽기');
    return response.text();
  }

  async function putJson(blobName, value) {
    return putText(blobName, JSON.stringify(value), 'application/json; charset=utf-8');
  }

  async function putText(blobName, body, contentType, createOnly = false) {
    ensureConfigured();
    const headers = {
      'Content-Type': contentType,
      'x-ms-blob-type': 'BlockBlob',
      'x-ms-version': API_VERSION,
      'x-ms-date': new Date().toUTCString()
    };
    if (createOnly) headers['If-None-Match'] = '*';
    const response = await fetchImpl(buildBlobUrl(account, safeContainer, safeSas, blobName), { method: 'PUT', headers, body });
    if (createOnly && (response.status === 409 || response.status === 412)) return { created: false };
    if (!response.ok) throw await responseError(response, '쓰기');
    return { created: true };
  }

  function ensureConfigured() {
    if (!configured) throw storageError(503, 'Azure 통계 전용 저장소 설정이 필요합니다.');
  }

  return {
    configured, account, container: safeContainer, prefix: safePrefix,
    readDayManifest, writeDayManifest, readDayChunk, writeDayChunk,
    readSnapshot, writeSnapshot
  };
}

function buildBlobUrl(account, container, sasToken, blobName) {
  const encodedBlob = String(blobName).split('/').map(encodeURIComponent).join('/');
  const url = new URL(`https://${account}.blob.core.windows.net/${encodeURIComponent(container)}/${encodedBlob}`);
  for (const [key, value] of new URLSearchParams(sasToken)) url.searchParams.append(key, value);
  return url.toString();
}

async function responseError(response, operation) {
  const body = await response.text().catch(() => '');
  const code = body.match(/<Code>([^<]+)<\/Code>/)?.[1] || '';
  const suffix = code ? `: ${code}` : '';
  return storageError(424, `Azure 통계 저장소 ${operation}에 실패했습니다${suffix} (HTTP ${response.status}).`);
}

function validateStorageAccount(value) {
  const text = String(value || '').trim();
  if (text && !/^[a-z0-9]{3,24}$/.test(text)) throw new Error('AZURE_STATISTICS_STORAGE_ACCOUNT 형식이 올바르지 않습니다.');
  return text;
}

function validateContainer(value) {
  const text = String(value || DEFAULT_CONTAINER).trim();
  if (!/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/.test(text)) throw new Error('AZURE_STATISTICS_CONTAINER 형식이 올바르지 않습니다.');
  return text;
}

function normalizeSasToken(value) { return String(value || '').trim().replace(/^\?/, ''); }
function normalizePrefix(value) { return String(value || DEFAULT_PREFIX).trim().replace(/^\/+|\/+$/g, '') || DEFAULT_PREFIX; }

function safePathSegment(value, label) {
  const text = String(value || '').trim();
  if (text && !/^[A-Za-z0-9_-]{1,100}$/.test(text)) throw new Error(`${label} 형식이 올바르지 않습니다.`);
  return text;
}

function validateDateKey(value) {
  const text = String(value || '');
  if (!/^\d{8}$/.test(text)) throw new Error('통계 저장소 날짜 키가 올바르지 않습니다.');
  return text;
}

function validateChunkName(value) {
  const text = String(value || '');
  if (!/^(?:chunk|bootstrap)-[a-f0-9]{16,64}\.ndjson$/.test(text)) throw new Error('통계 이벤트 청크 이름이 올바르지 않습니다.');
  return text;
}

function validateSnapshotKey(value) {
  const text = String(value || '');
  if (!/^[a-zA-Z0-9-]{1,100}$/.test(text)) throw new Error('통계 스냅샷 키가 올바르지 않습니다.');
  return text;
}

function storageError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
