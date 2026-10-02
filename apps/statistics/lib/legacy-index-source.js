import { access } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

export async function createLegacyIndexSource({ file = process.env.STATISTICS_LEGACY_INDEX_PATH || '/app/legacy-data/analytics-index-v1.sqlite', batchSize = 10_000 } = {}) {
  let configured = false;
  try { await access(file); configured = true; } catch { /* 새 설치에서는 기존 캐시가 없을 수 있다. */ }

  function state() {
    if (!configured) return { configured: false, days: [], rows: 0, fromDate: '', toDate: '' };
    const db = open();
    try {
      const days = db.prepare('SELECT date_key, row_count FROM source_days WHERE store_revision = 1 ORDER BY date_key').all();
      const dayRows = days.map(row => ({ dateKey: String(row.date_key), rowCount: Number(row.row_count || 0) }));
      return { configured: true, days: dayRows.map(row => row.dateKey), dayRows, rows: dayRows.reduce((sum, row) => sum + row.rowCount, 0), fromDate: String(days[0]?.date_key || ''), toDate: String(days.at(-1)?.date_key || '') };
    } finally { db.close(); }
  }

  async function scanBatches(visit, { days: selectedDays = null, concurrency = 1 } = {}) {
    if (!configured) return { rows: 0, batches: 0 };
    const db = open(); let rows = 0; let batches = 0;
    const active = new Set();
    let firstError = null;
    try {
      const days = db.prepare('SELECT date_key FROM source_days WHERE store_revision = 1 ORDER BY date_key').all().filter(row => !selectedDays || selectedDays.includes(String(row.date_key)));
      const statement = db.prepare(`SELECT event_key, payload FROM analytics_events WHERE event_key >= ? AND event_key < ? AND production = 1 AND event_key > ? ORDER BY event_key LIMIT ?`);
      for (const { date_key: rawDateKey } of days) {
        const dateKey = String(rawDateKey); let cursor = `${dateKey}:`;
        while (true) {
          const page = statement.all(`${dateKey}:`, `${dateKey};`, cursor, batchSize);
          if (!page.length) break;
          const events = page.map(row => { try { return JSON.parse(row.payload); } catch { return null; } }).filter(Boolean);
          const batch = { dateKey, batchIndex: batches, events, byteLength: page.reduce((sum, row) => sum + Buffer.byteLength(String(row.payload || '')), 0) };
          const task = Promise.resolve().then(() => visit(batch)).catch(error => { firstError ||= error; }).finally(() => active.delete(task));
          active.add(task);
          rows += events.length; batches += 1; cursor = String(page.at(-1).event_key);
          if (active.size >= Math.max(1, concurrency)) await Promise.race(active);
          if (firstError) { await Promise.all(active); throw firstError; }
          if (page.length < batchSize) break;
          await new Promise(resolve => setImmediate(resolve));
        }
      }
      await Promise.all(active);
      if (firstError) throw firstError;
      return { rows, batches };
    } finally { db.close(); }
  }

  function open() { const db = new DatabaseSync(file, { readOnly: true }); db.exec('PRAGMA query_only = ON; PRAGMA cache_size = -131072;'); return db; }
  return { configured, file, state, scanBatches };
}
