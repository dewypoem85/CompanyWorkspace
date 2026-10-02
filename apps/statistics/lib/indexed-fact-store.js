import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { DatabaseSync } from 'node:sqlite';

const STORE_REVISION = 1;

export function createIndexedFactStore({ dataDir, now = () => Date.now() }) {
  const file = path.join(dataDir, `analytics-index-v${STORE_REVISION}.sqlite`);
  let writerDatabase = null;
  let readerDatabase = null;

  function openWriter() {
    if (writerDatabase) return writerDatabase;
    writerDatabase = new DatabaseSync(file);
    writerDatabase.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA temp_store = MEMORY;
      PRAGMA cache_size = -262144;
      CREATE TABLE IF NOT EXISTS source_days (
        date_key TEXT PRIMARY KEY,
        source_signature TEXT NOT NULL,
        row_count INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        store_revision INTEGER NOT NULL
      ) WITHOUT ROWID;
      CREATE TABLE IF NOT EXISTS analytics_events (
        event_key TEXT PRIMARY KEY,
        date_key TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        type TEXT NOT NULL,
        version TEXT NOT NULL,
        platform TEXT NOT NULL,
        mode TEXT NOT NULL,
        mode_level INTEGER,
        production INTEGER NOT NULL,
        after_first_middle INTEGER NOT NULL,
        payload TEXT NOT NULL
      ) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS analytics_events_time ON analytics_events(timestamp);
      CREATE INDEX IF NOT EXISTS analytics_events_version_time ON analytics_events(version, timestamp);
      CREATE INDEX IF NOT EXISTS analytics_events_mode_level_time ON analytics_events(mode, mode_level, timestamp);
      CREATE INDEX IF NOT EXISTS analytics_events_platform_time ON analytics_events(platform, timestamp);
    `);
    return writerDatabase;
  }

  function openReader() {
    openWriter();
    if (readerDatabase) return readerDatabase;
    readerDatabase = new DatabaseSync(file, { readOnly: true });
    readerDatabase.exec('PRAGMA query_only = ON; PRAGMA cache_size = -262144;');
    return readerDatabase;
  }

  async function replaceDay(dateKey, sourceSignature, factFile = '') {
    await fs.mkdir(dataDir, { recursive: true });
    const db = openWriter();
    const existing = db.prepare('SELECT source_signature, store_revision FROM source_days WHERE date_key = ?').get(dateKey);
    if (existing?.source_signature === sourceSignature && Number(existing?.store_revision) === STORE_REVISION) return false;

    // event_key는 항상 `${dateKey}:${event.id}` 형식이다. date_key 보조 인덱스가
    // 없는 2천만 건 테이블을 매번 전체 스캔하지 않고 기본키 범위로 해당 날짜만 제거한다.
    const remove = db.prepare('DELETE FROM analytics_events WHERE event_key >= ? AND event_key < ?');
    const insert = db.prepare(`
      INSERT OR REPLACE INTO analytics_events (
        event_key, date_key, timestamp, type, version, platform, mode, mode_level,
        production, after_first_middle, payload
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const saveDay = db.prepare(`
      INSERT OR REPLACE INTO source_days (date_key, source_signature, row_count, updated_at, store_revision)
      VALUES (?, ?, ?, ?, ?)
    `);
    let rows = 0;
    db.exec('BEGIN IMMEDIATE');
    try {
      remove.run(`${dateKey}:`, `${dateKey};`);
      if (factFile) {
        const lines = readline.createInterface({ input: createReadStream(factFile, { encoding: 'utf8' }), crlfDelay: Infinity });
        for await (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);
            const timestamp = Number(event.timestamp);
            if (!event.id || !Number.isFinite(timestamp)) continue;
            const version = String(event.version || '');
            insert.run(
              `${dateKey}:${event.id}`, dateKey, Math.trunc(timestamp), String(event.type || ''), version,
              String(event.platform || ''), String(event.mode || ''), integerOrNull(event.modeLevel),
              isProductionVersionOrEmpty(version) ? 1 : 0,
              event.type !== 'battleResult' || event.reachedFirstMiddleBoss === true || reachedFirstMiddleBoss(event.stage) ? 1 : 0,
              line
            );
            rows += 1;
            // node:sqlite의 동기 INSERT를 장시간 연속 실행하면 같은 프로세스의
            // HTTP 서버와 헬스체크가 멈춘다. WAL 트랜잭션은 유지하되 주기적으로
            // 이벤트 루프를 양보해 집계 중에도 마지막 완료본을 계속 제공한다.
            if (rows % 1_000 === 0) await yieldToEventLoop();
          } catch { /* 손상된 단일 팩트 행은 제외한다. */ }
        }
      }
      saveDay.run(dateKey, sourceSignature, rows, new Date(now()).toISOString(), STORE_REVISION);
      db.exec('COMMIT');
      return true;
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch { /* 이미 롤백된 경우 */ }
      throw error;
    }
  }

  function hasCoverage(dateKeys) {
    if (!dateKeys.length) return true;
    const db = openReader();
    const placeholders = dateKeys.map(() => '?').join(',');
    const row = db.prepare(`SELECT COUNT(*) AS count FROM source_days WHERE date_key IN (${placeholders}) AND store_revision = ?`).get(...dateKeys, STORE_REVISION);
    return Number(row?.count) === dateKeys.length;
  }

  async function scan(input, visit) {
    openWriter();
    const db = new DatabaseSync(file, { readOnly: true });
    db.exec('PRAGMA query_only = ON; PRAGMA cache_size = -262144; BEGIN;');
    const baseWhere = ['timestamp >= ?', 'timestamp < ?', 'production = 1'];
    const baseParams = [new Date(input.from).getTime(), new Date(input.to).getTime()];
    if (input.version) {
      if (/^\d+\.\d+\.x$/i.test(input.version)) {
        baseWhere.push('version LIKE ?');
        baseParams.push(`${input.version.slice(0, -1)}%`);
      } else {
        baseWhere.push('version = ?');
        baseParams.push(input.version);
      }
    }
    if (input.platform) { baseWhere.push('platform = ?'); baseParams.push(input.platform); }
    if (input.mode) { baseWhere.push('mode = ?'); baseParams.push(input.mode); }
    if (input.minModeLevel !== null && input.minModeLevel !== undefined) { baseWhere.push('mode_level >= ?'); baseParams.push(input.minModeLevel); }
    if (input.afterFirstMiddleBoss) baseWhere.push("(type <> 'battleResult' OR after_first_middle = 1)");
    let processed = 0;
    try {
      // 테이블의 기본키가 `${UTC 날짜}:${이벤트 ID}` 순서이므로 날짜별 범위는
      // payload까지 디스크에서 순차적으로 읽을 수 있다. timestamp 보조 인덱스로
      // 수백만 행의 본문을 무작위 조회하던 기존 방식보다 Docker 볼륨에서 훨씬 빠르다.
      for (const dateKey of utcDateKeys(input.from, input.to)) {
        let cursorEventKey = '';
        while (true) {
          const where = ['event_key >= ?', 'event_key < ?', ...baseWhere];
          const params = [`${dateKey}:`, `${dateKey};`, ...baseParams];
          if (cursorEventKey) {
            where.push('event_key > ?');
            params.push(cursorEventKey);
          }
          const rows = db.prepare(`
            SELECT event_key, payload FROM analytics_events
            WHERE ${where.join(' AND ')} ORDER BY event_key LIMIT 5000
          `).all(...params);
          for (const row of rows) {
            try { visit(JSON.parse(row.payload)); } catch { /* 손상된 단일 저장 행은 제외한다. */ }
            processed += 1;
          }
          if (rows.length < 5_000) break;
          cursorEventKey = String(rows.at(-1).event_key);
          await new Promise(resolve => setImmediate(resolve));
        }
      }
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch { /* 이미 종료된 읽기 트랜잭션 */ }
      throw error;
    } finally {
      db.close();
    }
    return processed;
  }

  function state() {
    const db = openReader();
    const row = db.prepare(`
      SELECT COUNT(*) AS days, COALESCE(SUM(row_count), 0) AS rows,
             MIN(date_key) AS from_date, MAX(date_key) AS to_date, MAX(updated_at) AS updated_at
      FROM source_days WHERE store_revision = ?
    `).get(STORE_REVISION);
    return {
      revision: STORE_REVISION,
      days: Number(row?.days || 0), rows: Number(row?.rows || 0),
      fromDate: row?.from_date || '', toDate: row?.to_date || '', updatedAt: row?.updated_at || '', file
    };
  }

  function close() {
    readerDatabase?.close();
    writerDatabase?.close();
    readerDatabase = null;
    writerDatabase = null;
  }

  return { file, replaceDay, hasCoverage, scan, state, close };
}

function utcDateKeys(from, to) {
  const result = [];
  const cursor = new Date(from);
  cursor.setUTCHours(0, 0, 0, 0);
  while (cursor < to) {
    result.push(`${cursor.getUTCFullYear()}${String(cursor.getUTCMonth() + 1).padStart(2, '0')}${String(cursor.getUTCDate()).padStart(2, '0')}`);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

function integerOrNull(value) { const number = Number(value); return Number.isInteger(number) ? number : null; }
function yieldToEventLoop() { return new Promise(resolve => setImmediate(resolve)); }
function isProductionVersionOrEmpty(version) { return !version || /^\d+\.\d+\.\d+$/.test(version); }
function reachedFirstMiddleBoss(stage) {
  const value = String(stage || '').trim().toLocaleLowerCase('ko-KR').replace(/[_–—]/g, '-').replace(/\s+/g, ' ');
  if (!value) return false;
  if (/middle\s*-?\s*boss|중간\s*보스/.test(value)) return true;
  if (/(?:^|[-\s])boss$|보스$/.test(value)) return true;
  if (/독성\s*늪지|toxic\s*swamp|니플헤임|niflheim|철혈의\s*요새|fortress|붉은\s*태양의\s*사막|red\s*sun|고대\s*도시\s*그랑펠|granfel/.test(value)) return true;
  const progression = value.match(/(\d+)\s*-\s*(\d+)\s*$/);
  return Boolean(progression && Number(progression[1]) > 1);
}

export const INDEXED_FACT_STORE_REVISION = STORE_REVISION;
