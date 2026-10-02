import http from 'node:http';
import https from 'node:https';

const DEFAULT_URL = 'http://statistics-clickhouse:8123';

export function createClickHouseClient({
  url = process.env.CLICKHOUSE_URL || DEFAULT_URL,
  database = process.env.CLICKHOUSE_DATABASE || 'statistics',
  username = process.env.CLICKHOUSE_USER || 'statistics',
  password = process.env.CLICKHOUSE_PASSWORD || '',
  fetchImpl = null,
  timeoutMs = 30_000
} = {}) {
  const endpoint = normalizeUrl(url);
  const safeDatabase = identifier(database, 'ClickHouse 데이터베이스');
  const headers = {
    'X-ClickHouse-User': String(username || 'statistics'),
    'X-ClickHouse-Key': String(password || '')
  };

  async function request(query, { params = {}, format = '', body = '', timeout = timeoutMs, useDatabase = true } = {}) {
    const target = new URL(endpoint);
    if (useDatabase) target.searchParams.set('database', safeDatabase);
    if (format) target.searchParams.set('default_format', format);
    for (const [key, value] of Object.entries(params)) {
      if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key)) throw new Error(`ClickHouse 쿼리 매개변수가 올바르지 않습니다: ${key}`);
      target.searchParams.set(`param_${key}`, String(value ?? ''));
    }
    const payload = body ? `${query}\n${body}` : query;
    if (fetchImpl) {
      const response = await fetchImpl(target, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' }, body: payload,
        signal: AbortSignal.timeout(timeout)
      });
      const text = await response.text();
      if (!response.ok) throw clickHouseError(response.status, text);
      return text;
    }
    return nodeRequest(target, payload, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' }, timeout);
  }

  async function command(query, options) {
    await request(query, options);
  }

  async function rows(query, { params = {}, timeout = timeoutMs } = {}) {
    const text = await retryTransient(() => request(`${stripFormat(query)} FORMAT JSON`, { params, timeout }));
    const parsed = JSON.parse(text || '{"data":[]}');
    return Array.isArray(parsed.data) ? parsed.data : [];
  }

  async function insertRows(table, values, { chunkSize = 5_000, timeout = 120_000 } = {}) {
    const safeTable = identifier(table, 'ClickHouse 테이블');
    for (let offset = 0; offset < values.length; offset += chunkSize) {
      const chunk = values.slice(offset, offset + chunkSize);
      const body = chunk.map(value => JSON.stringify(value)).join('\n');
      await retryTransient(() => request(`INSERT INTO ${safeTable} FORMAT JSONEachRow`, { body, timeout }));
    }
  }

  async function ping() {
    return (await retryTransient(() => request('SELECT 1', { useDatabase: false }))).trim() === '1';
  }

  return { database: safeDatabase, command, rows, insertRows, ping, request };
}

function nodeRequest(target, body, headers, timeout) {
  return new Promise((resolve, reject) => {
    const transport = target.protocol === 'https:' ? https : http;
    const request = transport.request(target, {
      method: 'POST', headers: { ...headers, 'Content-Length': Buffer.byteLength(body) }
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if ((response.statusCode || 500) >= 400) reject(clickHouseError(response.statusCode || 500, text));
        else resolve(text);
      });
      response.on('error', reject);
    });
    request.setTimeout(timeout, () => request.destroy(Object.assign(new Error(`ClickHouse 요청 시간이 ${timeout}ms를 초과했습니다.`), { code: 'ETIMEDOUT' })));
    request.on('error', reject);
    request.end(body);
  });
}

async function retryTransient(operation, attempts = 4) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { return await operation(); } catch (error) {
      lastError = error;
      if (attempt + 1 >= attempts || (Number(error?.clickHouseStatus || 0) > 0 && Number(error.clickHouseStatus) < 500)) throw error;
      await new Promise(resolve => setTimeout(resolve, 250 * (2 ** attempt)));
    }
  }
  throw lastError;
}

function normalizeUrl(value) {
  const parsed = new URL(String(value || DEFAULT_URL));
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('CLICKHOUSE_URL은 HTTP(S) 주소여야 합니다.');
  return parsed.toString();
}

function identifier(value, label) {
  const text = String(value || '').trim();
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(text)) throw new Error(`${label} 이름이 올바르지 않습니다.`);
  return text;
}

function stripFormat(query) {
  return String(query || '').replace(/\s+FORMAT\s+[a-zA-Z0-9_]+\s*$/i, '').trim();
}

function clickHouseError(statusCode, body) {
  const message = String(body || '').replace(/\s+/g, ' ').trim().slice(0, 1000);
  const error = new Error(`ClickHouse 요청에 실패했습니다. (HTTP ${statusCode})${message ? ` ${message}` : ''}`);
  error.statusCode = statusCode >= 500 ? 503 : 500;
  error.clickHouseStatus = statusCode;
  return error;
}
