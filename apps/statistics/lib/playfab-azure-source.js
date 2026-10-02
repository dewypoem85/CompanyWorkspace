import { normalizeAnalyticsEvent, parseBlobListXml } from './playfab-analytics.js';

const API_VERSION = '2023-11-03';
const COLUMNS = ['Timestamp', 'EventId', 'FullName_Name', 'EntityLineage_master_player_account', 'Entity_Id', 'EventData'];
const MAX_BLOBS = 1_000_000;
let hyparquetPromise;

export function createPlayFabAzureSource({
  storageAccount = process.env.AZURE_PLAYFAB_LOG_STORAGE_ACCOUNT,
  container = process.env.AZURE_PLAYFAB_LOG_CONTAINER || 'logs',
  prefix = process.env.AZURE_PLAYFAB_LOG_PREFIX || 'data',
  sasToken = process.env.AZURE_PLAYFAB_LOG_SAS_TOKEN,
  titleId = process.env.PLAYFAB_LIVE_TITLE_ID,
  fetchImpl = globalThis.fetch,
  parquetReader = null
} = {}) {
  const account = validateAccount(storageAccount);
  const safeContainer = validateContainer(container);
  const safePrefix = String(prefix || 'data').trim().replace(/^\/+|\/+$/g, '');
  const safeToken = String(sasToken || '').trim().replace(/^\?/, '');
  const safeTitle = String(titleId || '').trim();
  const configured = Boolean(account && safeContainer && safeToken && safeTitle);

  async function listAllParquetBlobs() {
    ensureConfigured();
    return listByPrefixes([`${safePrefix}/title=${safeTitle}/`]);
  }

  async function listParquetBlobsForDates(dateKeys) {
    ensureConfigured();
    const uniqueDates = [...new Set(dateKeys)].filter(value => /^\d{8}$/.test(String(value))).sort();
    return listByPrefixes(uniqueDates.map(dateKey => `${safePrefix}/title=${safeTitle}/date=${dateKey}/`));
  }

  async function listByPrefixes(sourcePrefixes) {
    const blobs = [];
    for (const sourcePrefix of sourcePrefixes) {
      let marker = '';
      do {
        const url = new URL(`https://${account}.blob.core.windows.net/${safeContainer}`);
        url.searchParams.set('restype', 'container');
        url.searchParams.set('comp', 'list');
        url.searchParams.set('prefix', sourcePrefix);
        url.searchParams.set('maxresults', '5000');
        url.searchParams.set('include', 'metadata');
        if (marker) url.searchParams.set('marker', marker);
        appendSas(url, safeToken);
        const response = await fetchImpl(url, { headers: { Accept: 'application/xml', 'x-ms-version': API_VERSION }, cache: 'no-store' });
        const body = await response.text();
        if (!response.ok) throw sourceError(response.status, body, '목록 조회');
        const page = parseBlobListXml(body);
        for (const blob of page.blobs) {
          if (!blob.name.toLowerCase().endsWith('.parquet')) continue;
          const dateKey = blob.name.match(/\/date=(\d{8})\//)?.[1] || '';
          if (dateKey) blobs.push({ ...blob, dateKey });
        }
        if (blobs.length > MAX_BLOBS) throw new Error(`PlayFab Parquet 파일이 ${MAX_BLOBS.toLocaleString()}개를 초과했습니다.`);
        marker = page.nextMarker;
      } while (marker);
    }
    return blobs.sort((left, right) => left.dateKey.localeCompare(right.dateKey) || left.name.localeCompare(right.name));
  }

  async function readEvents(blob) {
    ensureConfigured();
    const url = new URL(`https://${account}.blob.core.windows.net/${safeContainer}/${blob.name.split('/').map(encodeURIComponent).join('/')}`);
    appendSas(url, safeToken);
    let rows;
    if (parquetReader) rows = await parquetReader({ url: url.toString(), byteLength: blob.byteLength, columns: COLUMNS, blob });
    else {
      if (!hyparquetPromise) hyparquetPromise = import('hyparquet');
      const { asyncBufferFromUrl, parquetReadObjects } = await hyparquetPromise;
      const file = await asyncBufferFromUrl({
        url: url.toString(), byteLength: blob.byteLength || undefined,
        requestInit: { cache: 'no-store' }
      });
      rows = await parquetReadObjects({ file, columns: COLUMNS });
    }
    const events = [];
    for (let index = 0; index < rows.length; index += 1) {
      const event = normalizeAnalyticsEvent(rows[index], undefined, { sourceBlob: blob.name, rowIndex: index });
      if (event && isProductionVersion(event.version)) events.push(event);
    }
    return events;
  }

  function ensureConfigured() {
    if (!configured) throw new Error('PlayFab Azure 원본 저장소 설정이 필요합니다.');
  }

  return { configured, listAllParquetBlobs, listParquetBlobsForDates, readEvents };
}

function isProductionVersion(version) {
  return !String(version || '').trim() || /^\d+\.\d+\.\d+$/.test(String(version).trim());
}

function appendSas(url, token) {
  for (const [key, value] of new URLSearchParams(token)) url.searchParams.append(key, value);
}

function validateAccount(value) {
  const text = String(value || '').trim();
  if (text && !/^[a-z0-9]{3,24}$/.test(text)) throw new Error('Azure Storage 계정 형식이 올바르지 않습니다.');
  return text;
}

function validateContainer(value) {
  const text = String(value || '').trim();
  if (!/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/.test(text)) throw new Error('Azure 컨테이너 형식이 올바르지 않습니다.');
  return text;
}

function sourceError(status, body, operation) {
  const code = String(body || '').match(/<Code>([^<]+)<\/Code>/)?.[1] || '';
  const error = new Error(`Azure PlayFab ${operation}에 실패했습니다. (HTTP ${status}${code ? `, ${code}` : ''})`);
  error.statusCode = 424;
  return error;
}
