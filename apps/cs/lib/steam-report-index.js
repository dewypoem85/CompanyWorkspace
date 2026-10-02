import { promises as fs } from 'node:fs';
import path from 'node:path';

const CACHE_VERSION = 1;
const DEFAULT_START_TIME = '2010-01-01T00:00:00Z';
const DEFAULT_PAGE_SIZE = 10_000;
const DEFAULT_MAX_PAGES = 100;

export function createSteamReportIndex({
  steamClient,
  filePath,
  namespace,
  startTime = DEFAULT_START_TIME,
  pageSize = DEFAULT_PAGE_SIZE,
  maxPages = DEFAULT_MAX_PAGES
}) {
  if (!steamClient || typeof steamClient.getTransactionReport !== 'function') {
    throw new Error('Steam 거래 보고서 클라이언트가 필요합니다.');
  }
  if (!filePath || !namespace) throw new Error('Steam 거래 색인 경로와 범위가 필요합니다.');
  const normalizedStartTime = normalizeReportTime(startTime, '거래 보고서 시작 시각');
  let loaded = false;
  let cursor = normalizedStartTime;
  let updatedAt = '';
  let transactions = new Map();
  let syncPromise = null;

  async function load() {
    if (loaded) return;
    loaded = true;
    let cached;
    try {
      cached = JSON.parse(await fs.readFile(filePath, 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT' || error instanceof SyntaxError) return;
      throw error;
    }
    if (!cached || cached.version !== CACHE_VERSION || cached.namespace !== namespace
      || cached.startTime !== normalizedStartTime || !Array.isArray(cached.transactions)) return;
    try {
      cursor = normalizeReportTime(cached.cursor, '저장된 거래 보고서 시각');
      updatedAt = typeof cached.updatedAt === 'string' ? cached.updatedAt : '';
      transactions = new Map(cached.transactions.map(transaction => [transactionKey(transaction), transaction]));
    } catch {
      cursor = normalizedStartTime;
      updatedAt = '';
      transactions = new Map();
    }
  }

  async function persist() {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    const payload = JSON.stringify({
      version: CACHE_VERSION,
      namespace,
      startTime: normalizedStartTime,
      cursor,
      updatedAt,
      transactions: [...transactions.values()]
    });
    await fs.writeFile(temporaryPath, payload, { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temporaryPath, filePath);
  }

  async function synchronize() {
    await load();
    let complete = false;
    for (let page = 0; page < maxPages; page += 1) {
      const batch = await steamClient.getTransactionReport(cursor, pageSize);
      if (!Array.isArray(batch) || batch.length === 0) { complete = true; break; }
      let latestTime = cursor;
      let newTransactions = 0;
      for (const transaction of batch) {
        const key = transactionKey(transaction);
        const previous = transactions.get(key);
        if (!previous) newTransactions += 1;
        if (!previous || JSON.stringify(previous) !== JSON.stringify(transaction)) {
          transactions.set(key, transaction);
        }
        const transactionTime = reportCursorTime(transaction);
        if (transactionTime > latestTime) latestTime = transactionTime;
      }
      if (latestTime > cursor) {
        cursor = latestTime;
        continue;
      }
      if (newTransactions === 0) { complete = true; break; }
    }
    if (!complete) throw new Error('Steam 거래 보고서가 안전한 한 번의 갱신 범위를 초과했습니다. 시작 시각 또는 동기화 구성을 확인해 주세요.');
    updatedAt = new Date().toISOString();
    await persist();
  }

  async function refresh() {
    if (!syncPromise) syncPromise = synchronize().finally(() => { syncPromise = null; });
    await syncPromise;
  }

  return {
    async findBySteamId(steamId) {
      await refresh();
      return {
        transactions: [...transactions.values()]
          .filter(transaction => transaction.steamId === steamId)
          .sort((left, right) => reportCursorTime(right).localeCompare(reportCursorTime(left))),
        indexedFrom: normalizedStartTime,
        updatedAt
      };
    }
  };
}

function transactionKey(transaction) {
  const transactionId = String(transaction?.transactionId ?? '').trim();
  const orderId = String(transaction?.orderId ?? '').trim();
  if (/^\d+$/.test(transactionId) && transactionId !== '0') return `transaction:${transactionId}`;
  if (/^\d+$/.test(orderId) && orderId !== '0') return `order:${orderId}`;
  throw new Error('Steam 거래 보고서에 식별 가능한 거래 번호가 없습니다.');
}

function reportCursorTime(transaction) {
  return normalizeReportTime(transaction?.time, 'Steam 거래 시각');
}

function normalizeReportTime(value, label) {
  const text = String(value ?? '').trim();
  const date = new Date(text);
  if (!text || Number.isNaN(date.getTime())) throw new Error(`${label}이 올바르지 않습니다.`);
  return date.toISOString().replace('.000Z', 'Z');
}

export const STEAM_REPORT_DEFAULT_START_TIME = DEFAULT_START_TIME;
